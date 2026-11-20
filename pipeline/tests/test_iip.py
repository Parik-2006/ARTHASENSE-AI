from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
import psycopg
import pytest
from mospi_mock import client, iip_row, no_sleep, paged, with_

from pipeline.ingest import iip
from pipeline.ingest.common import ValidationError
from pipeline.ingest.iip_records import IIP_BASES, categories, series_codes, validate_records

NOW = datetime(2026, 1, 5, tzinfo=UTC)
ALL = categories("2022-23")
MINING = "Mining & Quarrying"


def month_rows(m, mining_total="90.0"):
    return [
        iip_row(2025, m),
        iip_row(2025, m, MINING, "Fuel Minerals", "95.0", "1.0"),
        iip_row(2025, m, MINING, "", mining_total, "2.0"),
    ]


def test_totals_kept_sub_categories_skipped_and_index_vs_growth_separate():
    recs = validate_records(
        month_rows(1), 2025, 2025, "2022-23", categories("2022-23", ["general", "mining"])
    )
    assert [(r.category, r.index, r.growth) for r in recs] == [
        ("general", Decimal("120.0"), Decimal("5.0")),
        ("mining", Decimal("90.0"), Decimal("2.0")),
    ]
    idx, growth = series_codes("2022-23", "mining")
    assert idx != growth and idx.endswith(".index") and growth.endswith(".growth_yoy")


def test_missing_growth_is_none():
    [rec] = validate_records(
        [iip_row(2025, 1, growth=None)], 2025, 2025, "2022-23", categories("2022-23", ["general"])
    )
    assert rec.growth is None and rec.index == Decimal("120.0")


@pytest.mark.parametrize(
    "over",
    [
        {"base_year": "2011-12"}, {"category": "Basic Goods"}, {"type": "Sectoral"}, {"year": 2031},
        {"month": "Janu"}, {"index": "x"}, {"growth_rate": "inf"}, {"sub_category": "Fuel"},
    ],
)  # fmt: skip
def test_invalid_general_records_rejected(over):
    with pytest.raises(ValidationError):
        validate_records(
            [with_(iip_row(2025, 1), **over)], 2025, 2025, "2022-23", categories("2022-23", ["general"])
        )


def test_duplicate_category_total_rejected():
    rows = month_rows(1) + [iip_row(2025, 1, MINING, "", "91.0")]
    with pytest.raises(ValidationError, match="duplicate period"):
        validate_records(rows, 2025, 2025, "2022-23", categories("2022-23", ["general", "mining"]))


def test_requested_category_without_total_rejected():
    with pytest.raises(ValidationError, match="no category-total rows"):
        validate_records(
            [iip_row(2025, 1)], 2025, 2025, "2022-23", categories("2022-23", ["general", "mining"])
        )


def test_unknown_sector_and_bases():
    with pytest.raises(ValueError):
        categories("2022-23", ["steel"])
    assert {"2022-23", "2011-12"} <= set(IIP_BASES)


def fake_api():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        p = req.url.params
        seen.append(dict(p))
        rows = []
        for m in range(1, 13):
            if p["type"] == "General":
                rows.append(iip_row(2025, m, index=f"{100 + m}.0"))
            elif p.get("category_code") == "12":
                rows += [
                    iip_row(2025, m, MINING, "Fuel Minerals"),
                    iip_row(2025, m, MINING, "", f"{90 + m}.0"),
                ]
            else:
                empty = {"page": 1, "totalRecords": 0, "totalPages": 1, "recordPerPage": int(p["limit"])}
                body = {"data": [], "msg": "No Data Found", "statusCode": True, "meta_data": empty}
                return httpx.Response(200, json=body)
        return paged(rows, p)

    return handler, seen


def test_cli_dry_run_uses_one_query_per_category(capsys, monkeypatch):
    monkeypatch.delenv("ARTHASENSE_DATABASE_URL", raising=False)
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, seen = fake_api()
    code = iip.main(["--year", "2025", "--sectors", "general,mining", "--dry-run", "--delay", "0"],
                    client=client(handler))  # fmt: skip
    out = capsys.readouterr().out
    assert code == 0 and "Validated records: 24" in out and "Categories: general, mining" in out
    assert {(p["type"], p.get("category_code")) for p in seen} == {("General", None), ("Sectoral", "12")}
    assert all(p["frequency"] == "Monthly" and int(p["limit"]) <= 200 for p in seen)


def test_cli_fails_when_a_category_returns_nothing(capsys, monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, _ = fake_api()
    assert (
        iip.main(
            ["--year", "2025", "--sectors", "general,manufacturing", "--dry-run"], client=client(handler)
        )
        == 1
    )


def test_cli_bounds(capsys):
    assert iip.main(["--dry-run"]) == 2
    assert iip.main(["--year", "2010", "--dry-run"]) == 2


# ---- database ----------------------------------------------------------------------------------


def stored_records(growth="5.0"):
    return validate_records(
        month_rows(1) + month_rows(2)[:1] + [iip_row(2025, 2, MINING, "", "91.0", None)],
        2025, 2025, "2022-23", categories("2022-23", ["general", "mining"]),
    )  # fmt: skip


def run(url, records):
    with psycopg.connect(url) as conn:
        return iip.store_iip(
            conn, records, start_year=2025, end_year=2025, retrieved_at=NOW,
            cats=categories("2022-23", ["general", "mining"]),
        )  # fmt: skip


@pytest.mark.integration
def test_store_separate_series_idempotent_and_missing_skipped(migrated_db_url):
    first = run(migrated_db_url, stored_records())
    # 4 index values + 3 growth values (mining Feb growth missing)
    assert (first.inserted, first.skipped_missing) == (7, 1)
    again = run(migrated_db_url, stored_records())
    assert (again.inserted, again.unchanged, again.release_created) == (0, 7, False)
    with psycopg.connect(migrated_db_url) as conn:
        codes = [r[0] for r in conn.execute("SELECT code FROM series ORDER BY code")]
        n_rel = conn.execute("SELECT count(*) FROM releases").fetchone()[0]
    assert len(codes) == 4 and n_rel == 1
    assert "mospi.iip.2022-23.india.mining.growth_yoy" in codes
    assert not any(c.endswith(".index") and c.endswith(".growth_yoy") for c in codes)
    assert date(2025, 1, 1)


def test_base_year_relative_growth_is_withheld_but_yoy_is_kept():
    """Live finding: for the first 12 served months MoSPI's growth_rate is index - 100, not YoY."""
    rows = [
        iip_row(2024, 3, index="119.0", growth="19.0"),  # last base-relative month (Mar 2024)
        iip_row(2024, 4, index="107.5", growth="7.1"),  # first genuine year-on-year month
        iip_row(2023, 4, index="100.4", growth="0.4"),
    ]
    recs = validate_records(rows, 2023, 2024, "2022-23", categories("2022-23", ["general"]))
    by = {r.period: r for r in recs}
    assert by[date(2023, 4, 1)].growth is None and by[date(2024, 3, 1)].growth is None
    assert by[date(2024, 4, 1)].growth == Decimal("7.1")
    assert by[date(2024, 3, 1)].index == Decimal("119.0")  # the index itself is always kept


def test_cli_reports_how_many_growth_values_were_withheld(capsys, monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)

    def handler(req):
        rows = [iip_row(2024, m, index=f"{100 + m}.0", growth=f"{m}.0") for m in range(1, 13)]
        return paged(rows, req.url.params)

    code = iip.main(["--year", "2024", "--sectors", "general", "--dry-run"], client=client(handler))
    out = capsys.readouterr().out
    assert code == 0 and "Missing growth values: 3" in out and "withheld" in out and "before 2024-04" in out
