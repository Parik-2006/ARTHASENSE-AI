import os
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app import indicators
from app.config import get_settings
from app.main import app

T1 = datetime(2026, 1, 5, tzinfo=UTC)
T2 = datetime(2026, 2, 5, tzinfo=UTC)
IDX, INF = indicators.CPI_INDEX_SERIES, indicators.CPI_INFLATION_SERIES


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    yield TestClient(app)
    get_settings.cache_clear()


def fake_rows(monkeypatch, rows):
    monkeypatch.setattr(indicators, "query_cpi_rows", lambda *a, **k: rows)


def test_series_codes_match_pipeline():
    from pipeline.ingest import cpi_records

    assert indicators.CPI_INDEX_SERIES == cpi_records.SERIES_INDEX_CODE
    assert indicators.CPI_INFLATION_SERIES == cpi_records.SERIES_INFLATION_CODE


def test_response_shape_sorted_with_nulls_and_provenance(client, monkeypatch):
    # rows arrive newest first, as the SQL returns them
    fake_rows(monkeypatch, [
        (IDX, date(2025, 12, 1), Decimal("104.10"), "k2", T2, None),
        (INF, date(2025, 1, 1), Decimal("3.20"), "k1", T1, None),
        (IDX, date(2025, 1, 1), Decimal("100.00"), "k1", T1, None),
    ])  # fmt: skip
    body = client.get("/api/v1/indicators/cpi").json()
    assert body["indicator"] == "CPI" and body["base_year"] == "2024"
    assert body["geography"] == "All India" and body["sector"] == "Combined"
    assert body["division"] == "CPI (General)" and body["source"]["code"] == "mospi"
    assert [o["period"] for o in body["observations"]] == ["2025-01-01", "2025-12-01"]
    jan, dec = body["observations"]
    assert jan["index"] == 100.0 and jan["inflation"] == 3.2
    assert dec["index"] == 104.1 and dec["inflation"] is None  # null, not 0
    assert dec["index_source"]["release_key"] == "k2"
    assert dec["index_source"]["published_at"] is None
    assert dec["inflation_source"] is None
    assert body["count"] == 2 and body["note"] is None


def test_limit_keeps_newest_months(client, monkeypatch):
    rows = [(IDX, date(2025, m, 1), Decimal(m), "k", T1, None) for m in (12, 11, 10)]
    fake_rows(monkeypatch, rows)
    obs = client.get("/api/v1/indicators/cpi?limit=2").json()["observations"]
    assert [o["period"] for o in obs] == ["2025-11-01", "2025-12-01"]


def test_empty_database_returns_empty_list_not_fake_data(client, monkeypatch):
    fake_rows(monkeypatch, [])
    r = client.get("/api/v1/indicators/cpi")
    assert r.status_code == 200
    assert r.json()["observations"] == [] and r.json()["count"] == 0 and r.json()["note"]


def test_unknown_release_key_is_404(client, monkeypatch):
    fake_rows(monkeypatch, [])
    assert client.get("/api/v1/indicators/cpi?release_key=nope").status_code == 404


@pytest.mark.parametrize("qs", ["limit=0", "limit=100000", "start=2025-12-01&end=2025-01-01", "start=bad"])
def test_bad_parameters(client, qs):
    assert client.get(f"/api/v1/indicators/cpi?{qs}").status_code in (400, 422)


def test_database_down_is_503_without_leaking_credentials(client):
    r = client.get("/api/v1/indicators/cpi")  # port 1: nothing listens
    assert r.status_code == 503 and "p@" not in r.text


def test_not_configured_is_503(client, monkeypatch):
    monkeypatch.delenv("ARTHASENSE_DATABASE_URL")
    get_settings.cache_clear()
    assert client.get("/api/v1/indicators/cpi").status_code == 503


@pytest.mark.integration
def test_real_database_empty_then_populated(migrated_db_url, monkeypatch):
    import psycopg

    from pipeline.ingest.cpi_records import CpiRecord
    from pipeline.ingest.cpi_store import store_cpi

    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    c = TestClient(app)
    assert c.get("/api/v1/indicators/cpi").json()["observations"] == []

    with psycopg.connect(migrated_db_url) as conn:
        for idx, when in (("104.10", T1), ("104.20", T2)):  # two snapshots of the same month
            store_cpi(conn, [CpiRecord(date(2025, 12, 1), Decimal(idx), None)],
                      start_year=2025, end_year=2025, retrieved_at=when)  # fmt: skip
    obs = c.get("/api/v1/indicators/cpi").json()["observations"]
    assert len(obs) == 1 and obs[0]["index"] == 104.2 and obs[0]["inflation"] is None  # latest snapshot wins
    old_key = None
    with psycopg.connect(migrated_db_url) as conn:
        old_key = conn.execute("SELECT release_key FROM releases ORDER BY retrieved_at LIMIT 1").fetchone()[0]
    pinned = c.get(f"/api/v1/indicators/cpi?release_key={old_key}").json()["observations"]
    assert pinned[0]["index"] == 104.1
    get_settings.cache_clear()
