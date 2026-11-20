from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
import psycopg
import pytest
from mospi_mock import client, no_sleep, paged, with_, wpi_row

from pipeline.ingest import wpi
from pipeline.ingest.common import FetchError, ValidationError
from pipeline.ingest.wpi_records import WpiRecord, series_code, validate_records

NOW = datetime(2026, 1, 5, tzinfo=UTC)


def test_valid_records_sorted_with_decimal_values():
    recs = validate_records([wpi_row(2025, 2, "101.5"), wpi_row(2025, 1, "100.0")], 2025, 2025)
    assert [r.period for r in recs] == [date(2025, 1, 1), date(2025, 2, 1)]
    assert recs[1].index == Decimal("101.5")


def test_missing_value_stays_none_not_zero():
    [rec] = validate_records([wpi_row(2025, 1, None)], 2025, 2025)
    assert rec.index is None


@pytest.mark.parametrize(
    "over",
    [
        {"base_year": "2011-12"}, {"major_group": "Primary Articles"}, {"item": "Paddy"},
        {"group": "Food Articles"}, {"year": 2030}, {"year": "abc"}, {"month": "Janu"},
        {"index_value": "n/a"}, {"index_value": "NaN"},
    ],
)  # fmt: skip
def test_invalid_records_rejected(over):
    with pytest.raises(ValidationError):
        validate_records([with_(wpi_row(2025, 1), **over)], 2025, 2025)


def test_duplicate_period_rejected():
    with pytest.raises(ValidationError, match="duplicate period 2025-01-01"):
        validate_records([wpi_row(2025, 1), wpi_row(2025, 1)], 2025, 2025)


def test_base_year_must_be_registered_and_series_code_includes_it():
    assert series_code("2022-23") != series_code("2011-12")
    with pytest.raises(SystemExit):
        wpi.main(["--year", "2025", "--base-year", "1999-00", "--dry-run"])


def make_api(rows_by_year):
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(dict(req.url.params))
        return paged(rows_by_year.get(int(req.url.params["year"]), []), req.url.params)

    return handler, seen


def test_cli_dry_run_requests_only_the_headline_and_paginates(capsys, monkeypatch):
    monkeypatch.delenv("ARTHASENSE_DATABASE_URL", raising=False)
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, seen = make_api({2025: [wpi_row(2025, m) for m in range(1, 13)]})
    code = wpi.main(["--year", "2025", "--dry-run", "--delay", "0"], client=client(handler))
    out = capsys.readouterr().out
    assert code == 0 and "Fetched records: 12" in out and "Database: not touched" in out
    assert "Inflation: not provided by the API" in out
    assert all(p["major_group_code"] == "1000000000" and p["base_year"] == "2022-23" for p in seen)
    assert all(int(p["limit"]) <= 200 for p in seen)


def test_cli_fails_on_api_error_and_invalid_data(capsys, monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)
    assert wpi.main(["--year", "2025", "--dry-run"], client=client(lambda r: httpx.Response(400))) == 1
    bad, _ = make_api({2025: [wpi_row(2025, 1, major_group="Fuel & Power")]})
    assert wpi.main(["--year", "2025", "--dry-run"], client=client(bad)) == 1
    assert "FAILED" in capsys.readouterr().err


def test_empty_year_is_an_error_not_a_silent_success(capsys, monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, _ = make_api({})
    assert wpi.main(["--year", "2025", "--dry-run"], client=client(handler)) == 1


def test_repeated_page_detected(monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)
    rows = [wpi_row(2025, m) for m in range(1, 13)]

    def handler(req):
        r = paged(rows[:10] + rows[:10], req.url.params)  # every page = same first rows
        return r

    from pipeline.ingest.common import fetch_paginated

    with pytest.raises(FetchError):
        fetch_paginated(client(handler), "wpi", {"year": 2025}, key_fn=lambda r: (r["year"], r["month"]),
                        page_size=10, sleep=no_sleep)  # fmt: skip


def test_year_range_is_bounded(capsys):
    assert wpi.main(["--year", "2001", "--dry-run"]) == 2
    assert wpi.main(["--start-year", "2023", "--end-year", "2040", "--dry-run"]) == 2
    assert wpi.main(["--start-year", "2012", "--end-year", "2026", "--dry-run"]) == 2  # > 5 years
    assert wpi.main(["--dry-run"]) == 2


# ---- database (needs ARTHASENSE_TEST_DATABASE_URL) ----------------------------------------------


def recs(v="100.5"):
    return [WpiRecord(date(2025, 1, 1), Decimal(v)), WpiRecord(date(2025, 2, 1), None)]


def run(url, records, **kw):
    with psycopg.connect(url) as conn:
        return wpi.store_wpi(conn, records, start_year=2025, end_year=2025, retrieved_at=NOW, **kw)


def count(url, sql):
    with psycopg.connect(url) as conn:
        return conn.execute(sql).fetchone()[0]


@pytest.mark.integration
def test_store_is_idempotent_and_keeps_snapshots(migrated_db_url):
    s1 = run(migrated_db_url, recs())
    assert (s1.inserted, s1.skipped_missing, s1.release_created) == (1, 1, True)
    s2 = run(migrated_db_url, recs())
    assert (s2.inserted, s2.unchanged, s2.release_created) == (0, 1, False)
    s3 = run(migrated_db_url, recs("100.7"))
    assert s3.release_created and s3.inserted == 1
    assert count(migrated_db_url, "SELECT count(*) FROM releases") == 2
    assert count(migrated_db_url, "SELECT count(*) FROM observations") == 2
    assert count(migrated_db_url, "SELECT count(*) FROM observations WHERE value = 0") == 0
    with psycopg.connect(migrated_db_url) as conn:
        pub, base, unit = conn.execute(
            "SELECT (SELECT published_at FROM releases LIMIT 1), base_year, unit FROM series"
        ).fetchone()
    assert pub is None and base == "2022-23" and "2022-23" in unit


@pytest.mark.integration
def test_rollback_on_failure(migrated_db_url, monkeypatch):
    import pipeline.ingest.store_common as store

    monkeypatch.setattr(
        store, "_upsert_observation", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x"))
    )
    with pytest.raises(RuntimeError):
        run(migrated_db_url, recs())
    for table in ("sources", "series", "releases", "observations"):
        assert count(migrated_db_url, f"SELECT count(*) FROM {table}") == 0
