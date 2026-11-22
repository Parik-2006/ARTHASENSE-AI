# ruff: noqa: E501
import os
from datetime import UTC, date, datetime
from decimal import Decimal

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import indicators
from app.config import get_settings
from app.main import app

T1 = datetime(2026, 11, 22, tzinfo=UTC)
LVL, GR = indicators.GDP_LEVEL_SERIES, indicators.GDP_GROWTH_SERIES


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
            seen.append(codes)
        return rows

    monkeypatch.setattr(indicators, "query_series_rows", f)


def test_registry_matches_pipeline():
    from pipeline.ingest import nas

    lvl, gr, gva_lvl, gva_gr = nas.INDICATORS
    assert nas.series_code(lvl, None) == indicators.GDP_LEVEL_SERIES
    assert nas.series_code(gr, None) == indicators.GDP_GROWTH_SERIES
    assert list(indicators.GVA_INDUSTRIES) == list(nas.INDUSTRIES.values())
    assert list(indicators.GVA_INDUSTRIES.values()) == list(nas.INDUSTRIES)
    assert f"{indicators._NAS}.gva.mining.real.growth_yoy" == nas.series_code(gva_gr, "mining")


def test_fiscal_quarter():
    assert indicators.fiscal_quarter(date(2025, 4, 1)) == ("2025-26", 1)
    assert indicators.fiscal_quarter(date(2025, 10, 1)) == ("2025-26", 3)
    assert indicators.fiscal_quarter(date(2026, 1, 1)) == ("2025-26", 4)
    with pytest.raises(ValueError):
        indicators.fiscal_quarter(date(2025, 5, 1))


def test_gdp_contract_matches_frontend_parser(client, monkeypatch):
    fake(monkeypatch, [
        (GR, date(2026, 4, 1), Decimal("7.8"), "k", T1, None),
        (LVL, date(2026, 4, 1), Decimal("8136153"), "k", T1, None),
        (LVL, date(2022, 4, 1), Decimal("6162846"), "k", T1, None),  # base year: level, no growth
    ])  # fmt: skip
    b = client.get("/api/v1/indicators/gdp").json()
    assert (b["indicator"], b["frequency"], b["base_year"], b["seasonally_adjusted"]) == (
        "GDP",
        "quarterly",
        "2022-23",
        False,
    )
    assert [(o["fiscal_year"], o["quarter"], o["level"], o["growth_yoy"]) for o in b["observations"]] == [
        ("2022-23", 1, 6162846.0, None), ("2026-27", 1, 8136153.0, 7.8)]  # fmt: skip
    assert b["observations"][1]["growth_source"]["release_key"] == "k"
    assert b["source_url"].startswith("https://api.mospi.gov.in/api/nas/getNASData")


def test_gdp_not_stored_is_404_and_never_invented(client, monkeypatch):
    fake(monkeypatch, [])
    r = client.get("/api/v1/indicators/gdp")
    assert r.status_code == 404 and "not stored" in r.json()["detail"]
    assert client.get("/api/v1/indicators/gdp/gva").status_code == 404


def test_gdp_ignores_non_quarter_months_and_limits_newest(client, monkeypatch):
    fake(monkeypatch, [(GR, date(2025, m, 1), Decimal(m), "k", T1, None) for m in (1, 4, 5, 7, 10)])
    obs = client.get("/api/v1/indicators/gdp?limit=2").json()["observations"]
    assert [o["period"] for o in obs] == ["2025-07-01", "2025-10-01"]
    assert client.get("/api/v1/indicators/gdp?limit=81").status_code == 422


def test_gva_lists_official_industries_only(client, monkeypatch):
    seen = []
    code = f"{indicators._NAS}.gva.agriculture.real.growth_yoy"
    fake(monkeypatch, [(code, date(2026, 4, 1), Decimal("3.6"), "k", T1, None)], seen)
    b = client.get("/api/v1/indicators/gdp/gva").json()
    assert [i["key"] for i in b["industries"]] == list(indicators.GVA_INDUSTRIES)
    agri = b["industries"][1]
    assert agri["label"].startswith("Agriculture") and agri["observations"][0]["growth_yoy"] == 3.6
    assert all(not i["observations"] for i in b["industries"] if i["key"] != "agriculture")
    assert "does not publish an agriculture / industry / services split" in " ".join(b["limitations"])
    assert len(seen[0]) == 18


def test_gdp_database_errors_are_503(client):
    r = client.get("/api/v1/indicators/gdp")  # port 1: connection refused
    assert r.status_code == 503 and "secret" not in r.text


@pytest.mark.integration
def test_gdp_on_old_schema_without_0003(migrated_db_url, monkeypatch):
    """Production-shaped schema: the endpoint reads base tables only, so it works without later migrations."""
    with psycopg.connect(migrated_db_url) as conn:
        conn.execute("DROP VIEW IF EXISTS current_observations, observation_revisions CASCADE")
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    get_settings.cache_clear()
    r = TestClient(app).get("/api/v1/indicators/gdp")
    get_settings.cache_clear()
    assert r.status_code == 404


@pytest.mark.integration
def test_gdp_revisions_latest_snapshot_wins_and_dates_filter(migrated_db_url, monkeypatch):
    """Two retrievals of the same quarters: one row per quarter from the newest, old snapshot still auditable."""
    from datetime import timedelta

    from pipeline.ingest import nas

    lvl, gr = nas.series_code(nas.INDICATORS[0], None), nas.series_code(nas.INDICATORS[1], None)
    q = [date(2025, 4, 1), date(2025, 7, 1), date(2025, 10, 1), date(2026, 1, 1)]
    first = [nas.NasRecord(lvl, d, Decimal("100") + i) for i, d in enumerate(q)] + [
        nas.NasRecord(gr, q[0], Decimal("7.0"))
    ]
    revised = [nas.NasRecord(lvl, d, Decimal("200") + i) for i, d in enumerate(q)] + [
        nas.NasRecord(gr, q[0], Decimal("7.4"))
    ]
    with psycopg.connect(migrated_db_url) as conn:
        nas.store_nas(conn, first, T1)
        nas.store_nas(conn, revised, T1 + timedelta(days=30))
        n_obs, n_rel = conn.execute(
            "SELECT (SELECT count(*) FROM observations), (SELECT count(*) FROM releases)"
        ).fetchone()
        old_key = conn.execute("SELECT release_key FROM releases ORDER BY retrieved_at LIMIT 1").fetchone()[0]
    assert (n_obs, n_rel) == (10, 2)  # both snapshots kept
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    get_settings.cache_clear()
    c = TestClient(app)
    obs = c.get("/api/v1/indicators/gdp").json()["observations"]
    assert [o["period"] for o in obs] == [
        "2025-04-01",
        "2025-07-01",
        "2025-10-01",
        "2026-01-01",
    ]  # no duplicate dates, ordered
    assert [o["level"] for o in obs] == [200, 201, 202, 203] and obs[0]["growth_yoy"] == 7.4
    assert obs[3]["fiscal_year"] == "2025-26" and obs[3]["quarter"] == 4
    pinned = c.get(f"/api/v1/indicators/gdp?release_key={old_key}").json()["observations"]
    assert pinned[0]["level"] == 100 and pinned[0]["growth_yoy"] == 7.0
    ranged = c.get("/api/v1/indicators/gdp?start=2025-07-01&end=2025-10-01").json()["observations"]
    assert [o["period"] for o in ranged] == ["2025-07-01", "2025-10-01"]
    assert (
        c.get("/api/v1/indicators/gdp?start=2030-01-01").status_code == 404
    )  # empty range: honest 404, nothing invented
    assert c.get("/api/v1/indicators/gdp?start=2026-01-01&end=2025-01-01").status_code == 400
    get_settings.cache_clear()
