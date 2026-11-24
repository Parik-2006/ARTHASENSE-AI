import os
from datetime import UTC, date, datetime
from decimal import Decimal

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import forecasting
from app.config import get_settings
from app.main import app

NOW = datetime(2026, 1, 5, tzinfo=UTC)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:secret@127.0.0.1:1/x")
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    yield TestClient(app)
    get_settings.cache_clear()


def test_api_registry_matches_the_pipeline():
    from pipeline.forecasting import registry
    from pipeline.forecasting.experiments import INDICATORS, MIN_INITIAL_TRAIN

    assert forecasting.INDICATOR_SERIES == INDICATORS
    assert set(forecasting.MODEL_CATALOGUE) == set(registry.SPECS)
    for mid, spec in registry.SPECS.items():
        info = forecasting.MODEL_CATALOGUE[mid]
        assert (info["name"], info["family"], info["explanation"]) == (
            spec.name,
            spec.family,
            spec.explanation,
        )
        assert info["min_train"] == registry.min_train(mid)
    from pipeline.forecasting.backtesting import MIN_ORIGINS_EVALUATE, MIN_ORIGINS_RANK

    assert (forecasting.MIN_ORIGINS_EVALUATE, forecasting.MIN_ORIGINS_RANK) == (
        MIN_ORIGINS_EVALUATE,
        MIN_ORIGINS_RANK,
    )
    assert MIN_INITIAL_TRAIN == 12


@pytest.mark.parametrize(
    "path",
    [
        "/runs?indicator=gva", "/model-status?indicator=gva", "/model-status",
        "/runs?model=prophet", "/runs?horizon=0", "/runs?horizon=99", "/runs?limit=0",
        "/runs?limit=100000", "/runs?offset=-1", "/runs?kind=other", "/forecasts", "/forecasts?run_id=0",
        "/comparison", "/comparison?indicator=wpi", "/comparison?indicator=wpi&horizon=0",
        "/scores?metric=DROP%20TABLE",
        "/forecasts/latest?indicator=wpi&model=naive",
    ],
)  # fmt: skip
def test_invalid_parameters_are_rejected_before_any_query(client, path):
    assert client.get("/api/v1/forecasting" + path).status_code == 422


def test_database_down_is_503_and_never_leaks_credentials(client):
    for path in ("/models", "/series", "/runs", "/scores"):
        r = client.get("/api/v1/forecasting" + path)
        assert r.status_code == 503 and "secret" not in r.text


def test_evaluable_horizon_rule():
    assert forecasting._evaluable(12) == []  # CPI-sized: nothing is evaluable
    assert forecasting._evaluable(43) == [1, 3, 6, 12]
    assert forecasting._evaluable(30) == [1, 3, 6]  # 30-18-12+1 = 1 < 5 -> 12 dropped


# ---- integration: real stored experiments -------------------------------------------------------


def seed_all(url):
    import psycopg

    from pipeline.forecasting.experiments import backtest_records, forecast_record, load_indicator
    from pipeline.forecasting.persistence import store_run
    from pipeline.ingest.wpi import store_wpi
    from pipeline.ingest.wpi_records import WpiRecord

    rng = np.random.default_rng(0)
    vals = 100 + np.cumsum(rng.normal(0.3, 1.0, 43))
    base = 2023 * 12 + 3
    recs = [
        WpiRecord(date((base + k) // 12, (base + k) % 12 + 1, 1), Decimal(f"{v:.1f}"))
        for k, v in enumerate(vals)
    ]
    with psycopg.connect(url) as conn:
        for year in sorted({r.period.year for r in recs}):
            store_wpi(
                conn,
                [r for r in recs if r.period.year == year],
                start_year=year,
                end_year=year,
                retrieved_at=NOW,
            )
        ts = load_indicator(conn, "wpi")
        for mid in ("naive", "ets", "chronos2"):
            for r in backtest_records(ts, "wpi", mid, (1, 3), initial_train=18, suite="core"):
                store_run(conn, r)
        for r in backtest_records(
            ts, "wpi", "snaive", (1,), initial_train=24, suite="other"
        ):  # different origins
            store_run(conn, r)
        for r in backtest_records(ts, "wpi", "sarima", (1,), initial_train=36, suite="seasonal"):  # 7 origins
            store_run(conn, r)
        store_run(conn, forecast_record(ts, "wpi", "ets", 3))


@pytest.mark.integration
def test_endpoints_over_real_stored_experiments(migrated_db_url, monkeypatch):
    seed_all(migrated_db_url)
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    c = TestClient(app)
    base = "/api/v1/forecasting"

    models = {m["id"]: m for m in c.get(base + "/models").json()}
    assert models["naive"]["status"] == "evaluated" and models["naive"]["is_baseline"] is True
    assert (
        models["chronos2"]["status"] == "unavailable"
        and "not installed" in models["chronos2"]["unavailable_reason"]
    )
    assert models["xgboost"]["status"] == "not_evaluated"

    series = {s["indicator"]: s for s in c.get(base + "/series").json()}
    assert series["wpi"]["n_observations"] == 43 and series["wpi"]["evaluable_horizons"] == [1, 3, 6, 12]
    assert series["wpi"]["forecast_status"] == "has_experiments" and series["wpi"]["future_forecasts"] == 1
    assert series["cpi"]["forecast_status"] == "no_data" and series["cpi"]["latest_value"] is None
    assert series["iip"]["forecast_status"] == "no_data"

    page = c.get(base + "/runs?indicator=wpi&kind=backtest&status=completed&limit=2").json()
    assert page["total"] == 6 and len(page["items"]) == 2 and page["items"][0]["indicator"] == "wpi"
    assert "mae" in page["items"][0]["metrics"]
    skipped = c.get(base + "/runs?status=skipped").json()["items"]
    assert skipped and all(r["model"] == "chronos2" and r["error"].startswith("unavailable") for r in skipped)

    naive1 = c.get(base + "/runs?model=naive&horizon=1&kind=backtest").json()["items"][0]
    detail = c.get(f"{base}/runs/{naive1['id']}").json()
    assert detail["n_forecast_rows"] == naive1["n_origins"] and detail["configuration"]["initial_train"] == 18
    assert detail["rankable"] is True and "estimates" in detail["disclaimer"]
    assert c.get(base + "/runs/999999").status_code == 404

    fc = c.get(f"{base}/forecasts?run_id={naive1['id']}&limit=5&offset=2").json()
    assert fc["kind"] == "backtest" and fc["total"] == naive1["n_origins"] and len(fc["items"]) == 5
    assert fc["items"][0]["actual"] is not None and fc["items"][0]["step"] == 1
    dates = [i["target_date"] for i in fc["items"]]
    assert dates == sorted(dates)

    latest = c.get(base + "/forecasts/latest?indicator=wpi&model=ets&horizon=3").json()
    assert latest["run"]["kind"] == "forecast" and len(latest["items"]) == 3
    assert all(i["actual"] is None for i in latest["items"])
    none = c.get(base + "/forecasts/latest?indicator=wpi&model=naive&horizon=3").json()
    assert none["run"] is None and none["items"] == []

    scores = c.get(base + "/scores?indicator=wpi&model=naive&horizon=1&metric=mae").json()
    assert len(scores) == 1 and scores[0]["n_samples"] == naive1["n_origins"] and scores[0]["value"] > 0

    comp = c.get(base + "/comparison?indicator=wpi&horizon=1").json()
    groups = {g["origins_fingerprint"]: g for g in comp["groups"]}
    main = comp["groups"][0]  # naive + ets on identical origins come first
    assert {m["model"] for m in main["models"]} == {"naive", "ets"} and main["comparable"] is True
    assert (
        main["n_origins"] >= 12
        and main["rankable"] is True
        and set(main["best"]) == {"mae", "rmse", "mase", "smape"}
    )
    assert any(m["is_baseline"] for m in main["models"]) and all(
        m["vs_baseline_mae_pct"] is not None for m in main["models"] if not m["is_baseline"]
    )
    assert len(groups) == 3  # snaive (other origins) and sarima (7 origins) are NOT mixed into the main group
    small = [g for g in comp["groups"] if g["n_origins"] < 12]
    assert small and all(g["best"] == {} and not g["rankable"] for g in small)
    assert any("indicative" in w for g in small for w in g["warnings"])
    assert any(e["model"] == "chronos2" for e in comp["excluded"])
    get_settings.cache_clear()


@pytest.mark.integration
def test_unmigrated_database_gives_a_clear_503_not_a_generic_error(migrated_db_url, monkeypatch):
    """Dev without migration 0002 must say so (the schema only has 0000 + 0001)."""
    import psycopg

    from conftest import reset_test_database

    reset_test_database(migrated_db_url)
    from pathlib import Path

    mig = Path(__file__).resolve().parents[3] / "db" / "migrations"
    with psycopg.connect(migrated_db_url, autocommit=True) as conn:
        for name in ("0000_bootstrap.sql", "0001_core_schema.sql"):
            conn.execute((mig / name).read_text(encoding="utf-8"))
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    c = TestClient(app)
    for path in ("/series", "/runs", "/models", "/comparison?indicator=wpi&horizon=1"):
        r = c.get("/api/v1/forecasting" + path)
        assert r.status_code == 503, path
        assert "not migrated" in r.json()["detail"] and "db.migrate" in r.json()["detail"]
    get_settings.cache_clear()


@pytest.mark.integration
def test_v4_model_status_and_labels_over_real_stored_runs(migrated_db_url, monkeypatch):
    """/model-status explains all eight models from stored runs; each run carries its exact configuration."""
    import psycopg

    from pipeline.forecasting.experiments import backtest_records, forecast_record, load_indicator
    from pipeline.forecasting.persistence import store_run

    seed_all(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        ts = load_indicator(conn, "wpi")
        for r in backtest_records(ts, "wpi", "arima", (1,), initial_train=18, config_set="v4"):
            store_run(conn, r)
        store_run(conn, forecast_record(ts, "wpi", "arima", 3, initial_train=18, config_set="v4"))
        for r in backtest_records(
            ts, "wpi", "rf", (1,), initial_train=18, config_set="v4"
        ):  # needs 37: skipped
            store_run(conn, r)
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    c = TestClient(app)
    base = "/api/v1/forecasting"

    st = c.get(base + "/model-status?indicator=wpi").json()
    by = {m["model"]: m for m in st["models"]}
    assert list(by) == ["naive", "snaive", "drift", "ets", "arima", "sarima", "rf", "xgboost"]
    assert by["ets"]["status"] == "available" and by["ets"]["model_label"] == "ETS(A,Ad,N)"  # legacy V3 run
    assert by["arima"]["status"] == "available" and by["arima"]["model_label"].startswith("ARIMA(")
    assert by["arima"]["forecast_horizons"] == [1, 2, 3]
    assert by["rf"]["status"] == "insufficient_history" and "needs >= 37" in by["rf"]["reason"]
    assert by["naive"]["status"] == "not_trained" and "Backtested" in by["naive"]["reason"]
    assert by["xgboost"]["status"] == "not_trained" and "No run" in by["xgboost"]["reason"]
    assert st["frequency"] == "monthly"
    gdp = c.get(base + "/model-status?indicator=gdp").json()
    assert gdp["frequency"] == "quarterly" and all(m["status"] == "not_trained" for m in gdp["models"])

    latest = c.get(base + "/forecasts/latest?indicator=wpi&model=arima&horizon=3").json()
    assert latest["run"]["model_label"] == by["arima"]["model_label"]
    assert latest["run"]["model_parameters"]["selection"] == "aicc"
    series = {s["indicator"]: s for s in c.get(base + "/series").json()}
    assert series["gdp"]["frequency"] == "quarterly" and series["gdp"]["horizons"] == [1, 2, 4]
