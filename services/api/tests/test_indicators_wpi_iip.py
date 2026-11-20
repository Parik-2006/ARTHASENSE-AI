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
WPI = indicators.wpi_code("2022-23")
IIP_IDX, IIP_GR = indicators.iip_codes("2022-23", "general")
MIN_IDX, MIN_GR = indicators.iip_codes("2022-23", "mining")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:secret@127.0.0.1:1/x")
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    yield TestClient(app)
    get_settings.cache_clear()


def fake(monkeypatch, rows, seen=None):
    def f(url, codes, start, end, release_key, row_limit):
        if seen is not None:
            seen.append(dict(codes=codes, start=start, end=end, release_key=release_key, row_limit=row_limit))
        return rows

    monkeypatch.setattr(indicators, "query_series_rows", f)


def test_series_registry_matches_pipeline():
    from pipeline.ingest import iip_records, wpi_records

    for base in wpi_records.WPI_BASES:
        assert indicators.wpi_code(base) == wpi_records.series_code(base)
    assert set(indicators.WPI_BASES) == set(wpi_records.WPI_BASES)
    assert set(indicators.IIP_BASES) == set(iip_records.IIP_BASES)
    for base, keys in indicators.IIP_BASES.items():
        assert list(keys) == [c.key for c in iip_records.IIP_BASES[base].categories]
        for k in keys:
            assert indicators.iip_codes(base, k) == iip_records.series_codes(base, k)
    from pipeline.ingest import cpi_records

    for s in indicators.CPI_SERIES:
        assert indicators.cpi_codes(s) == cpi_records.series_codes(s.capitalize())


# ---- WPI ------------------------------------------------------------------------------------------


def test_wpi_shape_order_and_attribution(client, monkeypatch):
    fake(monkeypatch, [(WPI, date(2025, 3, 1), Decimal("101.0"), "k2", T2, None),
                       (WPI, date(2025, 1, 1), Decimal("100.5"), "k1", T1, None)])  # fmt: skip
    r = client.get("/api/v1/indicators/wpi")
    assert r.status_code == 200
    b = r.json()
    assert b["indicator"] == "WPI" and b["base_year"] == "2022-23" and b["geography"] == "India"
    assert b["source"]["code"] == "mospi" and "Office of the Economic Adviser" in b["publisher_note"]
    assert [o["period"] for o in b["observations"]] == ["2025-01-01", "2025-03-01"]  # chronological, gap kept
    assert b["observations"][1]["index"] == 101.0
    assert b["observations"][0]["index_source"]["release_key"] == "k1"
    assert b["observations"][0]["index_source"]["published_at"] is None
    assert "inflation" not in b["observations"][0]
    assert any("no official inflation" in x for x in b["limitations"])


def test_wpi_filters_are_forwarded_and_validated(client, monkeypatch):
    seen = []
    fake(monkeypatch, [(WPI, date(2025, 1, 1), Decimal("1"), "k", T1, None)], seen)
    client.get("/api/v1/indicators/wpi?start=2025-01-01&end=2025-06-01&release_key=k&limit=5")
    assert (
        seen[0]["start"] == date(2025, 1, 1) and seen[0]["release_key"] == "k" and seen[0]["codes"] == [WPI]
    )
    client.get("/api/v1/indicators/wpi?base_year=2011-12")
    assert seen[1]["codes"] == [indicators.wpi_code("2011-12")]
    for qs in ("limit=0", "limit=9999", "base_year=1999-00", "start=2025-06-01&end=2025-01-01", "start=bad"):
        assert client.get(f"/api/v1/indicators/wpi?{qs}").status_code in (400, 422), qs


def test_wpi_empty_and_unknown_snapshot(client, monkeypatch):
    fake(monkeypatch, [])
    r = client.get("/api/v1/indicators/wpi")
    assert r.status_code == 200 and r.json()["observations"] == [] and r.json()["note"]
    assert client.get("/api/v1/indicators/wpi?release_key=nope").status_code == 404


def test_wpi_limit_keeps_newest(client, monkeypatch):
    fake(monkeypatch, [(WPI, date(2025, m, 1), Decimal(m), "k", T1, None) for m in (12, 11, 10)])
    obs = client.get("/api/v1/indicators/wpi?limit=2").json()["observations"]
    assert [o["period"] for o in obs] == ["2025-11-01", "2025-12-01"]


def test_wpi_database_errors_are_503_without_leaking(client):
    r = client.get("/api/v1/indicators/wpi")  # port 1: nothing listens
    assert r.status_code == 503 and "secret" not in r.text


# ---- IIP ------------------------------------------------------------------------------------------


def test_iip_headline_index_and_growth_are_separate_fields(client, monkeypatch):
    fake(monkeypatch, [
        (IIP_IDX, date(2025, 2, 1), Decimal("112.9"), "k2", T2, None),
        (IIP_GR, date(2025, 1, 1), Decimal("6.3"), "k1", T1, None),
        (IIP_IDX, date(2025, 1, 1), Decimal("118.1"), "k1", T1, None),
    ])  # fmt: skip
    b = client.get("/api/v1/indicators/iip").json()
    assert b["indicator"] == "IIP" and b["sector"] == {"key": "general", "label": "General (headline)"}
    jan, feb = b["observations"]
    assert (jan["index"], jan["growth"]) == (118.1, 6.3)
    assert (feb["index"], feb["growth"]) == (112.9, None)  # null, not 0
    assert feb["growth_source"] is None and feb["index_source"]["release_key"] == "k2"


def test_iip_sector_selection_never_mixes_categories(client, monkeypatch):
    seen = []
    fake(monkeypatch, [(MIN_IDX, date(2025, 1, 1), Decimal("121.2"), "k", T1, None)], seen)
    b = client.get("/api/v1/indicators/iip?sector=mining").json()
    assert seen[0]["codes"] == [MIN_IDX, MIN_GR] and b["sector"]["key"] == "mining"
    assert b["observations"][0]["index"] == 121.2
    assert client.get("/api/v1/indicators/iip?sector=water&base_year=2011-12").status_code == 422
    assert client.get("/api/v1/indicators/iip?sector=steel").status_code == 422


def test_iip_sectors_endpoint_groups_by_sector(client, monkeypatch):
    fake(monkeypatch, [
        (MIN_IDX, date(2025, 1, 1), Decimal("121.2"), "k", T1, None),
        (MIN_GR, date(2025, 1, 1), Decimal("3.3"), "k", T1, None),
    ])  # fmt: skip
    b = client.get("/api/v1/indicators/iip/sectors").json()
    assert [s["key"] for s in b["sectors"]] == ["mining", "manufacturing", "electricity", "water"]
    mining = b["sectors"][0]["observations"][0]
    assert (mining["index"], mining["growth"]) == (121.2, 3.3)
    assert all(s["observations"] == [] for s in b["sectors"][1:])  # nothing invented for the rest


def test_iip_empty_database_and_bad_params(client, monkeypatch):
    fake(monkeypatch, [])
    b = client.get("/api/v1/indicators/iip").json()
    assert b["observations"] == [] and b["note"]
    assert client.get("/api/v1/indicators/iip/sectors").json()["note"]
    assert client.get("/api/v1/indicators/iip?release_key=zzz").status_code == 404
    assert client.get("/api/v1/indicators/iip?limit=0").status_code == 422
    assert client.get("/api/v1/indicators/iip?start=2025-02-01&end=2025-01-01").status_code == 400


def test_not_configured_is_503(client, monkeypatch):
    monkeypatch.delenv("ARTHASENSE_DATABASE_URL")
    get_settings.cache_clear()
    for path in ("wpi", "iip", "iip/sectors", "cpi"):
        assert client.get(f"/api/v1/indicators/{path}").status_code == 503


def test_cpi_back_series_option_and_default_unchanged(client, monkeypatch):
    seen = []

    def f(url, start, end, release_key, limit, series="current"):
        seen.append(series)
        idx = indicators.cpi_codes(series)[0]
        return [(idx, date(2024, 12, 1), Decimal("100"), "k", T1, None)]

    monkeypatch.setattr(indicators, "query_cpi_rows", f)
    assert client.get("/api/v1/indicators/cpi").json()["series"] == "current"
    b = client.get("/api/v1/indicators/cpi?series=back").json()
    assert seen == ["current", "back"] and b["series"] == "back" and b["observations"][0]["index"] == 100.0
    assert client.get("/api/v1/indicators/cpi?series=other").status_code == 422


@pytest.mark.integration
def test_real_database_wpi_and_iip(migrated_db_url, monkeypatch):
    import psycopg

    from pipeline.ingest.iip import store_iip
    from pipeline.ingest.iip_records import IipRecord, categories
    from pipeline.ingest.wpi import store_wpi
    from pipeline.ingest.wpi_records import WpiRecord

    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    c = TestClient(app)
    assert c.get("/api/v1/indicators/wpi").json()["observations"] == []
    assert c.get("/api/v1/indicators/iip").json()["observations"] == []
    with psycopg.connect(migrated_db_url) as conn:
        for v, at in (("100.5", T1), ("100.7", T2)):  # two snapshots of the same month
            store_wpi(
                conn,
                [WpiRecord(date(2025, 1, 1), Decimal(v))],
                start_year=2025,
                end_year=2025,
                retrieved_at=at,
            )
        store_iip(conn, [IipRecord("general", date(2025, 1, 1), Decimal("118.1"), Decimal("6.3")),
                         IipRecord("mining", date(2025, 1, 1), Decimal("121.2"), None)],
                  start_year=2025, end_year=2025, retrieved_at=T1,
                  cats=categories("2022-23", ["general", "mining"]))  # fmt: skip
    obs = c.get("/api/v1/indicators/wpi").json()["observations"]
    assert len(obs) == 1 and obs[0]["index"] == 100.7  # latest snapshot wins
    old = obs[0]["index_source"]["release_key"]
    assert c.get("/api/v1/indicators/wpi?release_key=" + old).json()["observations"][0]["index"] == 100.7
    g = c.get("/api/v1/indicators/iip").json()["observations"][0]
    assert (g["index"], g["growth"]) == (118.1, 6.3)
    m = c.get("/api/v1/indicators/iip?sector=mining").json()["observations"][0]
    assert (m["index"], m["growth"]) == (121.2, None)
    sectors = c.get("/api/v1/indicators/iip/sectors").json()["sectors"]
    assert sectors[0]["key"] == "mining" and sectors[0]["observations"][0]["index"] == 121.2
    get_settings.cache_clear()
