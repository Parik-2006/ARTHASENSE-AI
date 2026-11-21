import os
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from psycopg import errors as pg_errors

from app import data_status
from app.config import get_settings
from app.main import app

T = datetime(2026, 11, 20, tzinfo=UTC)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:secret@127.0.0.1:1/x")
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    yield TestClient(app)
    get_settings.cache_clear()


def fake_run(monkeypatch, by_marker):
    def f(sql, params=None):
        for marker, result in by_marker.items():
            if marker in sql:
                return result
        raise AssertionError(f"unexpected SQL: {sql[:40]}")

    monkeypatch.setattr(data_status, "_run", f)


def test_sources_names_publishers_and_marks_planned_datasets(client):
    body = client.get("/api/v1/data/sources").json()
    assert {s["indicator"] for s in body["sources"]} == {"CPI", "WPI", "IIP"}
    assert all(s["release_dates_provided"] is False for s in body["sources"])
    assert {p["indicator"] for p in body["planned"]} == {"GDP / GVA", "RBI repo rate"}
    assert "never merged" in body["base_year_note"]
    wpi = next(s for s in body["sources"] if s["indicator"] == "WPI")
    assert "2011-12" in wpi["bases_ingested"] and "not re-verified" in wpi["notes"]


def test_coverage_reports_gaps_snapshots_and_base_years(client, monkeypatch):
    row = ("mospi.wpi.2011-12.india.all_commodities.index", "WPI", "2011-12", "index", "India",
           date(2026, 1, 1), date(2026, 4, 1), 3, 2, T, [date(2026, 3, 1)])  # fmt: skip
    fake_run(monkeypatch, {"WITH cur": (True, [row]), "linking_factors": (True, [(0,)])})
    body = client.get("/api/v1/data/coverage").json()
    s = body["series"][0]
    assert (s["kind"], s["months_stored"], s["months_in_span"]) == ("index", 3, 4)
    assert s["missing_months"] == ["2026-03-01"] and s["base_year"] == "2011-12" and s["snapshots"] == 2
    assert body["linking_factors_stored"] == 0


def test_freshness_flags_stale_series(client, monkeypatch):
    fake_run(monkeypatch, {"freshness_policy": (True, [("CPI", 1, 20, "assumption", date(2020, 1, 1)),
                                                      ("IIP", 2, 20, "assumption", None)])})  # fmt: skip
    items = {i["indicator"]: i for i in client.get("/api/v1/data/freshness").json()["indicators"]}
    assert items["CPI"]["status"] == "stale" and items["CPI"]["months_behind"] > 0
    assert items["IIP"]["status"] == "no_data" and items["IIP"]["months_behind"] is None


def test_older_schema_degrades_instead_of_failing(client, monkeypatch):
    fake_run(monkeypatch, {"ingestion_runs": (False, []), "observation_revisions": (False, [])})
    assert client.get("/api/v1/data/ingestion").json() == {"available": False, "runs": []}
    r = client.get("/api/v1/data/revisions").json()
    assert r["available"] is False and r["revisions"] == []


def test_ingestion_and_revisions_shape(client, monkeypatch):
    run = (1, "wpi:2022-23", "apply", "manual", "success", "2022-23", 2026, 2026, T, T, 3, 3, 0, 0, 0, None)
    rev = ("mospi.wpi.2022-23.india.all_commodities.index", date(2026, 2, 1), 2, 2, T, T)
    fake_run(monkeypatch, {"ingestion_runs": (True, [run]), "observation_revisions": (True, [rev])})
    r = client.get("/api/v1/data/ingestion").json()
    assert r["runs"][0]["target"] == "wpi:2022-23" and r["runs"][0]["rows_new"] == 3
    assert client.get("/api/v1/data/revisions").json()["revisions"][0]["distinct_values"] == 2


def test_undefined_table_is_mapped_to_unavailable(monkeypatch):
    class Boom:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        read_only = True

        def execute(self, *a, **k):
            raise pg_errors.UndefinedTable("missing")

    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")
    get_settings.cache_clear()
    monkeypatch.setattr(data_status, "connect", lambda *a, **k: Boom())
    assert data_status._run("SELECT 1") == (False, [])
    get_settings.cache_clear()
