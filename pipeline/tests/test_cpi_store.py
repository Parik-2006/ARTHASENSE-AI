"""Integration tests: need ARTHASENSE_TEST_DATABASE_URL (a throwaway database named *test*)."""

from datetime import UTC, date, datetime
from decimal import Decimal

import psycopg
import pytest

from pipeline.ingest.cpi_records import CpiRecord
from pipeline.ingest.cpi_store import snapshot_sha256, store_cpi

pytestmark = pytest.mark.integration
NOW = datetime(2026, 1, 5, tzinfo=UTC)


def recs(infl_jan=None, index_dec="104.10"):
    return [
        CpiRecord(date(2025, 1, 1), Decimal("100.00"), infl_jan),
        CpiRecord(date(2025, 12, 1), Decimal(index_dec), None),
    ]


def run(url, records, **kw):
    with psycopg.connect(url) as conn:
        return store_cpi(conn, records, start_year=2025, end_year=2025, retrieved_at=NOW, **kw)


def count(url, sql):
    with psycopg.connect(url) as conn:
        return conn.execute(sql).fetchone()[0]


def test_first_load_inserts_index_only_when_inflation_missing(migrated_db_url):
    stats = run(migrated_db_url, recs())
    assert (stats.inserted, stats.skipped_missing, stats.release_created) == (2, 2, True)
    assert count(migrated_db_url, "SELECT count(*) FROM series") == 1  # no inflation series
    assert count(migrated_db_url, "SELECT count(*) FROM observations WHERE value = 0") == 0


def test_rerun_is_idempotent(migrated_db_url):
    run(migrated_db_url, recs())
    stats = run(migrated_db_url, recs())
    assert (stats.inserted, stats.updated, stats.unchanged, stats.release_created) == (0, 0, 2, False)
    assert count(migrated_db_url, "SELECT count(*) FROM observations") == 2
    assert count(migrated_db_url, "SELECT count(*) FROM releases") == 1
    assert count(migrated_db_url, "SELECT count(*) FROM sources") == 1


def test_changed_data_creates_new_release_and_keeps_old_snapshot(migrated_db_url):
    run(migrated_db_url, recs())
    stats = run(migrated_db_url, recs(index_dec="104.20"))
    assert stats.release_created and stats.inserted == 2
    assert count(migrated_db_url, "SELECT count(*) FROM releases") == 2
    assert count(migrated_db_url, "SELECT count(*) FROM observations") == 4
    assert count(migrated_db_url, "SELECT count(*) FROM observations WHERE value = 104.10") == 1


def test_provenance_is_honest_and_inflation_is_a_separate_series(migrated_db_url):
    run(migrated_db_url, recs(infl_jan=Decimal("3.2")))
    with psycopg.connect(migrated_db_url) as conn:
        pub, ret, sha, key = conn.execute(
            "SELECT published_at, retrieved_at, content_sha256, release_key FROM releases"
        ).fetchone()
        units = conn.execute("SELECT unit FROM series ORDER BY unit").fetchall()
    assert pub is None  # never invented
    assert ret == NOW
    assert sha == snapshot_sha256(recs(infl_jan=Decimal("3.2")), 2025, 2025) and sha[:16] in key
    assert units == [("index (2024=100)",), ("percent",)]


def test_failure_rolls_back_everything(migrated_db_url, monkeypatch):
    import pipeline.ingest.store_common as store

    def boom(*a, **k):
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(store, "_upsert_observation", boom)
    with pytest.raises(RuntimeError):
        run(migrated_db_url, recs())
    for table in ("sources", "series", "releases", "observations"):
        assert count(migrated_db_url, f"SELECT count(*) FROM {table}") == 0
