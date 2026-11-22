# ruff: noqa: E501  (fixture rows mirror the live API on one readable line)
"""National Accounts (quarterly GDP/GVA) adapter. Row shapes copied from the live API; values are made up."""

from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
import psycopg
import pytest
from mospi_mock import client, no_sleep, paged

from pipeline.ingest import nas
from pipeline.ingest.common import ValidationError
from pipeline.ingest.nas import (
    INDICATORS,
    INDUSTRIES,
    NasRecord,
    quarter_start,
    series_code,
    validate_records,
)

NOW = datetime(2026, 11, 22, tzinfo=UTC)
GDP_LEVEL, GDP_GROWTH, GVA_LEVEL, GVA_GROWTH = INDICATORS


def row(ind, year="2025-26", q="Q1", value="100", industry=None, **over):
    r = {"base_year": "2022-23", "series": "Current", "year": year, "indicator": ind.label, "frequency": "Quarterly",
         "revision": None, "quarter": q, "industry": industry, "subindustry": None,
         "current_price": "999", "constant_price": value, "unit": ind.unit}  # fmt: skip
    r.update(over)
    return r


def gva_rows(ind, year="2025-26", q="Q1"):
    return [row(ind, year, q, "5.0", industry=label) for label in INDUSTRIES]


def test_fiscal_quarters_map_to_first_month():
    assert quarter_start("2025-26", "Q1") == date(2025, 4, 1)
    assert quarter_start("2025-26", "Q2") == date(2025, 7, 1)
    assert quarter_start("2025-26", "Q3") == date(2025, 10, 1)
    assert quarter_start("2025-26", "Q4") == date(2026, 1, 1)  # Jan-Mar of the NEXT calendar year
    for bad in (("2025-27", "Q1"), ("2025", "Q1"), ("2025-26", "Q5"), ("2025-26", None)):
        with pytest.raises(ValidationError):
            quarter_start(*bad)


def test_constant_price_is_stored_and_percent_stripped():
    [r] = validate_records([row(GDP_GROWTH, value="7.8%")], GDP_GROWTH)
    assert r == NasRecord(series_code(GDP_GROWTH, None), date(2025, 4, 1), Decimal("7.8"))
    [lvl] = validate_records([row(GDP_LEVEL, value="8136153")], GDP_LEVEL)
    assert lvl.value == Decimal("8136153") and lvl.code.endswith(".gdp.real.level")


def test_missing_value_is_none_never_zero():
    [r] = validate_records([row(GDP_LEVEL, value=None)], GDP_LEVEL)
    assert r.value is None


@pytest.mark.parametrize(
    "over",
    [{"base_year": "2011-12"}, {"series": "Back"}, {"frequency": "Annual"}, {"indicator": "GVA Growth Rate"},
     {"unit": "%"}, {"subindustry": "Crops"}, {"industry": "Manufacturing"}, {"constant_price": "n/a"}],
)  # fmt: skip
def test_wrong_metadata_rejected(over):
    with pytest.raises(ValidationError):
        validate_records([row(GDP_LEVEL, **over)], GDP_LEVEL)


def test_duplicate_quarter_rejected():
    with pytest.raises(ValidationError, match="duplicate"):
        validate_records([row(GDP_LEVEL), row(GDP_LEVEL)], GDP_LEVEL)


def test_gva_needs_every_official_industry_and_rejects_unknown_ones():
    recs = validate_records(gva_rows(GVA_GROWTH), GVA_GROWTH)
    assert len(recs) == 9 and {r.code for r in recs} == {
        series_code(GVA_GROWTH, k) for k in INDUSTRIES.values()
    }
    with pytest.raises(ValidationError, match="industries"):
        validate_records(gva_rows(GVA_GROWTH)[:8], GVA_GROWTH)
    with pytest.raises(ValidationError, match="unexpected"):
        validate_records([row(GVA_GROWTH, industry="Services")], GVA_GROWTH)


def test_specs_are_quarterly_and_carry_base_year():
    sp = nas.specs()
    assert len(sp) == 2 + 2 * len(INDUSTRIES)
    assert {s.frequency for s in sp.values()} == {"quarterly"} and {s.base_year for s in sp.values()} == {
        "2022-23"
    }


def api():
    rows = {GDP_LEVEL.code: [row(GDP_LEVEL, q=q, value="8000000") for q in ("Q1", "Q2")],
            GDP_GROWTH.code: [row(GDP_GROWTH, q=q, value="7.1") for q in ("Q1", "Q2")],
            GVA_LEVEL.code: gva_rows(GVA_LEVEL) + gva_rows(GVA_LEVEL, q="Q2"),
            GVA_GROWTH.code: gva_rows(GVA_GROWTH) + gva_rows(GVA_GROWTH, q="Q2")}  # fmt: skip
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(dict(req.url.params))
        return paged(rows[int(req.url.params["indicator_code"])], req.url.params)

    return handler, seen


def test_cli_dry_run_fetches_four_indicators_with_fixed_filters(capsys, monkeypatch):
    monkeypatch.delenv("ARTHASENSE_DATABASE_URL", raising=False)
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, seen = api()
    assert nas.main(["--dry-run", "--delay", "0"], client=client(handler)) == 0
    out = capsys.readouterr().out
    assert (
        "SUCCESS (dry run)" in out
        and "mospi.nas.2022-23.india.gdp.real.level: 2 values, 2025-04 .. 2025-07" in out
    )
    assert {p["indicator_code"] for p in seen} == {"1", "5", "21", "22"}
    assert all(
        p["base_year"] == "2022-23" and p["series"] == "Current" and p["frequency_code"] == "Quarterly"
        for p in seen
    )


def test_cli_refuses_remote_database(monkeypatch, capsys):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:p@db.example.supabase.co:5432/postgres")
    assert nas.main([]) == 2
    assert "refus" in capsys.readouterr().err.lower()


def test_cli_fails_on_invalid_source_data(capsys, monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)
    assert (
        nas.main(
            ["--dry-run"], client=client(lambda r: paged([row(GDP_LEVEL, base_year="2011-12")], r.url.params))
        )
        == 1
    )
    assert "FAILED" in capsys.readouterr().err


# ---- database (needs ARTHASENSE_TEST_DATABASE_URL) ----------------------------------------------


def recs(v="7.8"):
    code = series_code(GDP_GROWTH, None)
    return [NasRecord(code, date(2025, 4, 1), Decimal(v)), NasRecord(code, date(2026, 1, 1), None)]


@pytest.mark.integration
def test_store_is_idempotent_quarterly_and_snapshots_revisions(migrated_db_url):
    with psycopg.connect(migrated_db_url) as conn:
        s1 = nas.store_nas(conn, recs(), NOW)
        s2 = nas.store_nas(conn, recs(), NOW)
        s3 = nas.store_nas(conn, recs("7.9"), NOW)  # a revision arrives as a new release, nothing overwritten
        freq = conn.execute("SELECT DISTINCT frequency FROM series").fetchall()
        n = conn.execute("SELECT count(*), count(*) FILTER (WHERE value = 0) FROM observations").fetchone()
    assert (s1.inserted, s1.skipped_missing, s1.release_created) == (1, 1, True)
    assert (s2.inserted, s2.release_created) == (0, False)
    assert s3.release_created and s3.inserted == 1
    assert freq == [("quarterly",)] and n == (2, 0)
