import json
from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
import psycopg
import pytest
from mospi_mock import client, no_sleep, paged, wpi_row

from pipeline.ingest import monitor
from pipeline.ingest.common import ValidationError
from pipeline.ingest.monitor import expected_latest_period, freshness, quality_checks
from pipeline.ingest.preview import diff_series
from pipeline.ingest.store_common import ConflictingObservation, _upsert_observation
from pipeline.ingest.wpi_records import validate_records

TODAY = date(2026, 2, 15)


# ---- pure logic ------------------------------------------------------------------------------


def test_expected_latest_period_applies_lag_and_grace():
    assert expected_latest_period(date(2026, 11, 21), 1, 20) == date(2026, 10, 1)
    assert expected_latest_period(date(2026, 11, 21), 2, 20) == date(2026, 9, 1)
    # before the grace period has passed, last month's data is not yet "late"
    assert expected_latest_period(date(2026, 11, 5), 1, 20) == date(2026, 9, 1)
    assert expected_latest_period(date(2026, 1, 25), 1, 20) == date(2025, 12, 1)  # year boundary


def test_freshness_states():
    assert freshness(date(2026, 10, 1), date(2026, 11, 21), 1, 20)["status"] == "current"
    stale = freshness(date(2026, 7, 1), date(2026, 11, 21), 1, 20)
    assert (stale["status"], stale["months_behind"]) == ("stale", 3)
    assert freshness(None, date(2026, 11, 21), 1, 20)["status"] == "no_data"
    assert freshness(date(2027, 1, 1), date(2026, 11, 21), 1, 20)["months_behind"] == 0  # never negative


def _sp(code, fetched, stored=None):
    return diff_series(code, "2022-23", fetched, stored or {})


def _by_name(code, fetched):
    return {c["name"]: c for c in quality_checks(_sp(code, fetched), dict(fetched))}


def test_quality_checks_flag_gaps_duplicates_and_big_index_moves():
    fetched = [
        (date(2025, 1, 1), Decimal("100")),
        (date(2025, 2, 1), Decimal("110")),
        (date(2025, 4, 1), Decimal("111")),
    ]
    checks = _by_name("mospi.wpi.2022-23.x.index", fetched)
    assert checks["no_missing_months_in_span"]["status"] == "warn"
    assert "2025-03" in checks["no_missing_months_in_span"]["message"]
    assert checks["no_extreme_monthly_moves"]["status"] == "warn"
    dup = [*fetched, (date(2025, 1, 1), Decimal("100"))]
    assert _by_name("a.2022-23.index", dup)["no_duplicate_periods"]["status"] == "fail"


def test_big_moves_are_not_flagged_for_rate_series():
    fetched = [(date(2025, 1, 1), Decimal("1.0")), (date(2025, 2, 1), Decimal("4.0"))]
    assert _by_name("mospi.cpi.x.inflation_yoy", fetched)["no_extreme_monthly_moves"]["status"] == "pass"


def test_wpi_2011_12_alternate_field_names_are_accepted_but_other_groups_are_not():
    row = {
        "base_year": "2011-12", "year": 2019, "month": "December", "majorgroup": "Wholesale price index",
        "group": None, "subgroup": None, "sub_subgroup": None, "item": None, "index_value": "123",
    }  # fmt: skip
    [rec] = validate_records([row], 2019, 2019, "2011-12")
    assert (rec.period, rec.index) == (date(2019, 12, 1), Decimal("123"))
    for bad in ({"majorgroup": "Primary articles"}, {"subgroup": "Food grains"}, {"item": "Paddy"}):
        with pytest.raises(ValidationError):
            validate_records([{**row, **bad}], 2019, 2019, "2011-12")


# ---- database integration (throwaway test database) -----------------------------------------

integration = pytest.mark.integration


@pytest.fixture
def db(migrated_db_url, monkeypatch):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.setattr("time.sleep", no_sleep)
    return migrated_db_url


def api(values: dict[int, str], fail: bool = False):
    def handler(req: httpx.Request) -> httpx.Response:
        if fail:
            return httpx.Response(500)
        rows = [wpi_row(2026, m, v) for m, v in values.items()] if int(req.url.params["year"]) == 2026 else []
        return paged(rows, req.url.params)

    return client(handler)


def counts(url):
    with psycopg.connect(url) as c:
        return {
            t: c.execute(f"SELECT count(*) FROM {t}").fetchone()[0]  # noqa: S608 - fixed table names
            for t in ("observations", "releases", "ingestion_runs", "quality_checks")
        }


def run(argv, values, fail=False):
    base = ["--only", "wpi:2022-23", "--years-back", "0", "--delay", "0"]
    return monitor.run([*base, *argv], api(values, fail), TODAY)


VALUES = {1: "100.0", 2: "100.5", 3: "101.0"}


@integration
def test_dry_run_writes_nothing(db, capsys):
    assert run([], VALUES) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["mode"] == "dry_run" and report["targets"][0]["new"] == 3
    assert counts(db) == {"observations": 0, "releases": 0, "ingestion_runs": 0, "quality_checks": 0}


@integration
def test_apply_is_idempotent_and_logged(db, capsys):
    assert run(["--apply"], VALUES) == 0
    first = counts(db)
    assert first["observations"] == 3 and first["releases"] == 1 and first["ingestion_runs"] == 1
    assert first["quality_checks"] > 0
    capsys.readouterr()
    assert run(["--apply"], VALUES) == 0
    again = counts(db)
    assert again["observations"] == 3 and again["releases"] == 1  # nothing duplicated
    assert again["ingestion_runs"] == 2
    with psycopg.connect(db) as c:
        rows = c.execute("SELECT status FROM ingestion_runs ORDER BY id").fetchall()
    assert rows == [("success",), ("no_change",)]


@integration
def test_revision_arrives_as_new_snapshot_and_never_overwrites(db):
    run(["--apply"], VALUES)
    run(["--apply"], {**VALUES, 2: "100.9"})
    with psycopg.connect(db) as c:
        assert c.execute("SELECT count(*) FROM releases").fetchone()[0] == 2
        both = c.execute(
            "SELECT array_agg(value ORDER BY value) FROM observations WHERE period_date = '2026-02-01'"
        ).fetchone()[0]
        assert both == [Decimal("100.5"), Decimal("100.9")]  # old value kept beside the new one
        rev = c.execute("SELECT period_date, distinct_values FROM observation_revisions").fetchall()
        assert rev == [(date(2026, 2, 1), 2)]
        cur = dict(c.execute("SELECT period_date, value FROM current_observations").fetchall())
        assert cur[date(2026, 2, 1)] == Decimal("100.9") and len(cur) == 3  # one row per month


@integration
def test_source_failure_stores_nothing_and_is_reported(db, capsys):
    assert run(["--apply"], VALUES) == 0
    before = counts(db)
    capsys.readouterr()
    assert run(["--apply"], {}, fail=True) == 1
    after = counts(db)
    assert after["observations"] == before["observations"] and after["releases"] == before["releases"]
    report = json.loads(capsys.readouterr().out)
    assert report["targets"][0]["failures"]


@integration
def test_changed_source_format_is_rejected_without_writes(db):
    bad = [wpi_row(2026, 1, "100.0", base_year="1999-00")]

    def handler(req):
        return paged(bad if int(req.url.params["year"]) == 2026 else [], req.url.params)

    argv = ["--only", "wpi:2022-23", "--years-back", "0", "--delay", "0", "--apply"]
    assert monitor.run(argv, client(handler), TODAY) == 1
    assert counts(db)["observations"] == 0


@integration
def test_overlapping_run_is_refused(db, capsys):
    with psycopg.connect(db, autocommit=True) as other:
        other.execute("SELECT pg_advisory_lock(hashtext(%s))", (monitor.LOCK_KEY,))
        assert run(["--apply"], VALUES) == 3
    assert "skipped_locked" in capsys.readouterr().out
    assert counts(db)["observations"] == 0


def test_remote_database_is_refused_before_any_connection(monkeypatch, capsys):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:pw@db.example.com:5432/x")
    assert monitor.run(["--apply"], client(lambda r: httpx.Response(500)), TODAY) == 2
    assert "not local" in capsys.readouterr().err


@integration
def test_same_release_never_silently_changes_a_value(db):
    with psycopg.connect(db) as c:
        sid = c.execute("INSERT INTO sources (code, name) VALUES ('t','t') RETURNING id").fetchone()[0]
        ser = c.execute(
            "INSERT INTO series (source_id, code, name, indicator, frequency, unit) "
            "VALUES (%s,'t.s','t','T','monthly','u') RETURNING id",
            (sid,),
        ).fetchone()[0]
        rel = c.execute(
            "INSERT INTO releases (source_id, release_key, retrieved_at) VALUES (%s,'k',%s) RETURNING id",
            (sid, datetime(2026, 1, 1, tzinfo=UTC)),
        ).fetchone()[0]
        d = date(2026, 1, 1)
        assert _upsert_observation(c, ser, rel, d, Decimal("1.0")) == "inserted"
        assert _upsert_observation(c, ser, rel, d, Decimal("1.0")) == "unchanged"
        with pytest.raises(ConflictingObservation):
            _upsert_observation(c, ser, rel, d, Decimal("2.0"))
