"""CPI forecasting on MoSPI's official linked history (Back series 2013-2024 + Current 2025-, both base 2024).

Pure tests (no database) of the composite training series and the `linked_current` suite, plus integration tests
(ARTHASENSE_TEST_DATABASE_URL) that runs are stored against the CURRENT series and served by the API.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import numpy as np
import psycopg
import pytest

from pipeline.forecasting.experiments import (
    INDICATORS,
    LINKED_SUITES,
    backtest_records,
    dataset_fingerprint,
    forecast_record,
    load_training,
    suite_initial_train,
    suite_records,
    target_code,
    training_data,
)
from pipeline.research.loader import (
    CPI_BACK_INDEX,
    CPI_CURRENT_INDEX,
    LoaderError,
    MixedBaseError,
    build_series,
    splice,
)

T = datetime(2026, 11, 1, tzinfo=UTC)
CUR = CPI_CURRENT_INDEX
BACK = CPI_BACK_INDEX


def _months(start: date, n: int) -> list[date]:
    k0 = start.year * 12 + start.month - 1
    return [date((k0 + i) // 12, (k0 + i) % 12 + 1, 1) for i in range(n)]


def _series(code: str, base: str, start: date, vals) -> object:
    rows = [
        (p, Decimal(f"{v:.2f}"), f"rel-{code}", T)
        for p, v in zip(_months(start, len(vals)), vals, strict=True)
    ]
    return build_series((code, "CPI", base, "index (2024=100)", "India"), rows)


def linked(n_back: int = 48, n_cur: int = 22, seed: int = 0):
    rng = np.random.default_rng(seed)
    y = 80 * np.exp(np.cumsum(rng.normal(0.004, 0.005, n_back + n_cur)))
    back = _series(BACK, "2024", date(2021, 1, 1), y[:n_back])
    cur = _series(CUR, "2024", _months(date(2021, 1, 1), n_back + 1)[-1], y[n_back:])
    return splice(back, cur, "cpi.2024.official_linked.index"), back, cur


# ---- the composite series ------------------------------------------------------------------------


def test_splice_records_the_join_and_refuses_overlap_or_another_base():
    ts, back, cur = linked()
    assert ts.join_period == date(2025, 1, 1) and ts.components == (BACK, CUR) and len(ts) == 70
    assert [p.period for p in ts.points] == sorted(
        p.period for p in ts.points
    )  # chronological, no duplicates
    assert len({p.period for p in ts.points}) == len(ts)
    with pytest.raises(LoaderError, match="overlap"):
        splice(back, back, "x")  # the same months twice would double-count
    legacy = _series(
        "mospi.cpi.2012.current.all_india.combined.general.index", "2012", date(2021, 1, 1), [150.0] * 12
    )
    with pytest.raises(MixedBaseError):
        splice(legacy, cur, "x")  # base 2012 is never joined to base 2024


def test_training_data_and_target_only_change_for_a_composite():
    ts, _, cur = linked()
    td = training_data(ts)
    assert (
        td["components"] == [BACK, CUR] and td["join_period"] == "2025-01-01" and td["n_observations"] == 70
    )
    assert target_code(ts) == CUR == INDICATORS["cpi"]
    assert training_data(cur) is None and target_code(cur) == CUR
    # A single series keeps exactly the configuration keys it had before (WPI/IIP experiment ids stay the same).
    rec = backtest_records(cur, "cpi", "naive", (1,), initial_train=12)[0]
    assert set(rec.config) == {"initial_train", "step", "window", "levels", "model", "diagnostics"}
    assert rec.target_series_code == CUR


def test_linked_current_suite_scores_only_current_series_months_without_look_ahead():
    ts, back, cur = linked()
    assert suite_initial_train(ts, "linked_current") == len(back) == 48
    recs = suite_records(ts, "cpi", "linked_current")
    done = [r for r in recs if r.status == "completed"]
    assert {r.model_id for r in done} == set(LINKED_SUITES["linked_current"]["models"])
    for r in done:
        assert r.target_series_code == CUR and r.config["training_data"]["join_period"] == "2025-01-01"
        assert r.config["initial_train"] == 48 and r.training_start == date(2021, 1, 1)
        for row in r.rows:
            assert row["target_date"] >= date(2025, 1, 1)  # every scored month is a Current-series month
            assert row["origin_date"] < row["target_date"]  # trained only on data before the origin
            assert row["origin_date"] >= date(2024, 12, 1)
            assert row["actual"] == pytest.approx(
                float(next(p.value for p in ts.points if p.period == row["target_date"]))
            )
    by = {(r.model_id, r.horizon): r for r in done}
    assert (
        by[("naive", 1)].n_origins == 22
        and by[("naive", 3)].n_origins == 20
        and by[("naive", 6)].n_origins == 17
    )
    # identical origins for every model at a horizon (fair comparison)
    for h in (1, 3, 6):
        assert len({r.origins_fingerprint for r in done if r.horizon == h}) == 1


def test_linked_runs_are_deterministic_and_separate_from_current_only_runs():
    ts, _, cur = linked()
    a = suite_records(ts, "cpi", "linked_current")
    b = suite_records(ts, "cpi", "linked_current")
    assert [r.experiment_id for r in a] == [r.experiment_id for r in b]
    assert [r.metrics for r in a] == [r.metrics for r in b]
    assert dataset_fingerprint(ts) != dataset_fingerprint(cur)
    f = forecast_record(ts, "cpi", "drift", 6)
    assert f.target_series_code == CUR and f.config["training_data"]["n_observations"] == 70
    assert [r["target_date"] for r in f.rows] == _months(date(2026, 11, 1), 6)
    assert all(r["lower_95"] <= r["lower_80"] <= r["point"] <= r["upper_80"] <= r["upper_95"] for r in f.rows)


def test_suite_needs_a_linked_history_and_load_training_refuses_other_indicators():
    _, _, cur = linked()
    with pytest.raises(ValueError, match="linked history"):
        suite_initial_train(cur, "linked_current")
    with pytest.raises(ValueError, match="no official linked history"):
        load_training(None, "wpi", "linked")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="unknown history"):
        load_training(None, "cpi", "spliced")  # type: ignore[arg-type]


# ---- database-backed -----------------------------------------------------------------------------


def seed_cpi(url: str, n_back: int = 48, n_cur: int = 22) -> None:
    from pipeline.ingest.cpi_records import CpiRecord
    from pipeline.ingest.cpi_store import store_cpi

    ts, back, cur = linked(n_back, n_cur)
    with psycopg.connect(url) as conn:
        for part, name in ((back, "Back"), (cur, "Current")):
            for year in sorted({p.period.year for p in part.points}):
                recs = [CpiRecord(p.period, p.value, None) for p in part.points if p.period.year == year]
                store_cpi(conn, recs, start_year=year, end_year=year, retrieved_at=T, series_name=name)


@pytest.mark.integration
def test_linked_runs_are_stored_against_the_current_series_and_served(migrated_db_url, monkeypatch):
    from pipeline.forecasting.persistence import store_run

    seed_cpi(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        before = conn.execute("SELECT count(*), sum(value) FROM observations").fetchone()
        ts = load_training(conn, "cpi", "linked")
        assert len(ts) == 70 and ts.join_period == date(2025, 1, 1)
        recs = suite_records(ts, "cpi", "linked_current") + [forecast_record(ts, "cpi", "drift", 6)]
        assert [store_run(conn, r)[0] for r in recs] == ["stored"] * len(recs)
        assert [store_run(conn, r)[0] for r in recs] == ["exists"] * len(
            recs
        )  # idempotent, never overwritten
        codes = {
            c
            for (c,) in conn.execute(
                "SELECT DISTINCT s.code FROM forecast_runs fr JOIN series s ON s.id=fr.series_id"
            )
        }
        assert codes == {CUR}
        assert (
            conn.execute("SELECT count(*), sum(value) FROM observations").fetchone() == before
        )  # official data untouched

    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import app

    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    get_settings.cache_clear()
    try:
        c = TestClient(app)
        base = "/api/v1/forecasting"
        cpi = {s["indicator"]: s for s in c.get(base + "/series").json()}["cpi"]
        assert cpi["n_observations"] == 22 and cpi["forecast_status"] == "has_experiments"
        th = cpi["training_history"]
        assert th["n_observations"] == 70 and th["join_period"] == "2025-01-01"
        assert [p["series_code"] for p in th["components"]] == [BACK, CUR]
        comp = c.get(base + "/comparison?indicator=cpi&horizon=6").json()
        assert comp["groups"][0]["n_origins"] == 17 and comp["groups"][0]["rankable"] is True
        latest = c.get(base + "/forecasts/latest?indicator=cpi&model=drift&horizon=6").json()
        assert latest["run"]["training_start"] == "2021-01-01" and len(latest["items"]) == 6
    finally:
        get_settings.cache_clear()


@pytest.mark.integration
def test_series_without_linked_runs_or_with_a_gap_claims_nothing(migrated_db_url, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import app

    seed_cpi(migrated_db_url)
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    get_settings.cache_clear()
    try:
        c = TestClient(app)
        cpi = {s["indicator"]: s for s in c.get("/api/v1/forecasting/series").json()}["cpi"]
        # data import done, runs not yet imported: ready, but no forecast is claimed
        assert (
            cpi["forecast_status"] == "ready_not_run" and "no tested forecast is stored yet" in cpi["reason"]
        )
        with psycopg.connect(migrated_db_url) as conn:  # a hole in the Back series: no linked history at all
            conn.execute(
                "DELETE FROM observations o USING series s WHERE s.id=o.series_id AND s.code=%s AND o.period_date='2022-06-01'",
                (BACK,),
            )
        cpi = {s["indicator"]: s for s in c.get("/api/v1/forecasting/series").json()}["cpi"]
        assert cpi["training_history"] is None and cpi["forecast_status"] == "insufficient_history"
    finally:
        get_settings.cache_clear()
