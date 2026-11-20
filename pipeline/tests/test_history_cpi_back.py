from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
import psycopg
import pytest
from mospi_mock import MONTHS, client, no_sleep, paged, wpi_row

from pipeline.ingest import cpi, history
from pipeline.ingest.cpi_records import ValidationError, series_codes, validate_records
from pipeline.ingest.cpi_store import release_key, store_cpi

NOW = datetime(2026, 1, 5, tzinfo=UTC)


def cpi_row(year, month, series="Back", index="90.0", inflation=None):
    return {
        "base_year": "2024", "series": series, "year": str(year), "month": MONTHS[month - 1],
        "state": "All India", "sector": "Combined", "division": "CPI (General)",
        "index": index, "inflation": inflation,
    }  # fmt: skip


def test_back_and_current_are_distinct_series_and_cannot_be_confused():
    assert series_codes("Back") != series_codes("Current")
    assert ".back." in series_codes("Back")[0]
    with pytest.raises(ValueError):
        series_codes("Linked")
    # a record from the Back series is rejected when Current was requested, and vice versa
    with pytest.raises(ValidationError):
        validate_records([cpi_row(2014, 1, "Back")], 2014, 2014, "Current")
    assert validate_records([cpi_row(2014, 1, "Back")], 2014, 2014, "Back")[0].index == Decimal("90.0")
    assert release_key(2014, 2014, "ab" * 32, "Back") != release_key(2014, 2014, "ab" * 32, "Current")


def test_cpi_cli_back_series_bounds_and_dry_run(capsys, monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)
    rows = [cpi_row(2014, m, inflation="5.0") for m in range(1, 13)]

    def handler(req):
        assert req.url.params["series"] == "Back"
        return paged(rows, req.url.params)

    assert (
        cpi.main(["--series", "Back", "--year", "2014", "--dry-run", "--delay", "0"], client=client(handler))
        == 0
    )
    assert "CPI series: Back" in capsys.readouterr().out
    assert cpi.main(["--series", "Back", "--year", "2005", "--dry-run"]) == 2  # before the verified start
    assert cpi.main(["--series", "Current", "--year", "2014", "--dry-run"]) == 2


# ---- history runner ----------------------------------------------------------------------------


def wpi_api(years_with_data):
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        y = int(req.url.params["year"])
        calls.append(y)
        rows = [wpi_row(y, m) for m in range(1, 13)] if y in years_with_data else []
        return paged(rows, req.url.params)

    return handler, calls


def test_history_dry_run_processes_each_year_separately(capsys, monkeypatch):
    monkeypatch.delenv("ARTHASENSE_DATABASE_URL", raising=False)
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, calls = wpi_api({2024, 2025})
    code = history.run(
        ["wpi", "--start-year", "2024", "--end-year", "2025", "--dry-run"], client=client(handler)
    )
    out = capsys.readouterr().out
    assert code == 0 and "2024: fetched 12, validated 12 (dry run)" in out and "Years processed: 2" in out
    assert sorted(set(calls)) == [2024, 2025]


def test_history_stops_with_a_clear_message_on_failure(capsys, monkeypatch):
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, _ = wpi_api({2024})  # 2025 returns nothing
    code = history.run(
        ["wpi", "--start-year", "2024", "--end-year", "2025", "--dry-run"], client=client(handler)
    )
    err = capsys.readouterr().err
    assert code == 1 and "2025: FAILED" in err and "--resume" in err


def test_history_rejects_unbounded_or_invalid_ranges(capsys):
    assert history.run(["wpi", "--start-year", "2010", "--end-year", "2025", "--dry-run"]) == 2
    assert history.run(["wpi", "--start-year", "2025", "--end-year", "2024", "--dry-run"]) == 2
    with pytest.raises(SystemExit):
        history.run(["wpi", "--dry-run"])  # a range is mandatory: nothing is downloaded by default


@pytest.mark.integration
def test_history_resume_skips_stored_years(migrated_db_url, monkeypatch, capsys):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.setattr("time.sleep", no_sleep)
    handler, calls = wpi_api({2024, 2025})
    args = ["wpi", "--start-year", "2024", "--end-year", "2025", "--resume", "--delay", "0"]
    assert history.run(args[:1] + ["--start-year", "2024", "--end-year", "2024"], client=client(handler)) == 0
    calls.clear()
    assert history.run(args, client=client(handler)) == 0
    out = capsys.readouterr().out
    assert "2024: skipped (already stored)" in out and set(calls) == {2025}
    with psycopg.connect(migrated_db_url) as conn:
        assert conn.execute("SELECT count(*) FROM releases").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM observations").fetchone()[0] == 24
    # a third run does nothing and is still successful
    calls.clear()
    assert history.run(args, client=client(handler)) == 0 and calls == []


@pytest.mark.integration
def test_cpi_back_and_current_store_side_by_side(migrated_db_url):
    from pipeline.ingest.cpi_records import CpiRecord

    with psycopg.connect(migrated_db_url) as conn:
        for name, year in (("Back", 2024), ("Current", 2025)):
            store_cpi(conn, [CpiRecord(date(year, 12, 1), Decimal("100"), None)], start_year=year,
                      end_year=year, retrieved_at=NOW, series_name=name)  # fmt: skip
        codes = [r[0] for r in conn.execute("SELECT code FROM series ORDER BY code")]
    assert len(codes) == 2 and ".back." in codes[0] and ".current." in codes[1]
