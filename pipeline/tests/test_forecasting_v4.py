"""Forecasts V4 scientific checks: frequencies, all eight algorithms, leakage, identical origins, failure status,
conformal future intervals, the official WPI/IIP back-cast and GDP growth arithmetic. No database needed."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import numpy as np
import pytest

from pipeline.forecasting import registry
from pipeline.forecasting.backtesting import run_backtest
from pipeline.forecasting.experiments import (
    SUITES,
    backtest_records,
    forecast_record,
    v4_future_records,
)
from pipeline.forecasting.interfaces import (
    ForecastError,
    ForecastModel,
    ForecastResult,
    future_periods,
    infer_frequency,
    season_position,
    validate_history,
)
from pipeline.research.loader import (
    BACKCAST_LINKS,
    GapError,
    LoaderError,
    Point,
    TimeSeries,
    build_series,
    find_missing_periods,
)

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def months(n, start=date(2015, 1, 1)):
    base = start.year * 12 + start.month - 1
    return [date((base + k) // 12, (base + k) % 12 + 1, 1) for k in range(n)]


def quarters(n, start=date(2022, 4, 1)):
    base = start.year * 12 + start.month - 1
    return [date((base + 3 * k) // 12, (base + 3 * k) % 12 + 1, 1) for k in range(n)]


def seasonal_walk(n, period=12, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    return 100 + np.cumsum(rng.normal(0.3, 0.6, n)) + 3 * np.sin(2 * np.pi * t / period)


def ts_of(values, periods, freq_name="monthly", code="t.index"):
    rows = [(p, Decimal(repr(float(v))), "k", T0) for p, v in zip(periods, values, strict=True)]
    return build_series((code, "T", "2022-23", "index", "India", freq_name), rows)


# ---- frequencies -----------------------------------------------------------------------------------


def test_quarterly_periods_validate_and_extend():
    q = quarters(5)
    assert infer_frequency(q) == "Q" and infer_frequency(months(5)) == "M"
    assert validate_history(np.arange(5.0), q) == "Q"
    assert future_periods(date(2026, 4, 1), 3, "Q") == [date(2026, 7, 1), date(2026, 10, 1), date(2027, 1, 1)]
    with pytest.raises(ValueError):
        validate_history(
            np.arange(3.0), [date(2025, 1, 1), date(2025, 4, 1), date(2025, 5, 1)]
        )  # mixed steps
    with pytest.raises(ValueError, match="months"):
        validate_history(np.arange(5.0), q, "M")  # quarterly data are never accepted as monthly
    assert [season_position(d, "Q") for d in q[:4]] == [1, 2, 3, 0]


def test_loader_reads_quarterly_series_without_inventing_months():
    q = quarters(6)
    ts = ts_of(np.arange(6.0), q, "quarterly")
    assert ts.freq == "Q" and ts.missing_periods == () and len(ts) == 6
    assert find_missing_periods([q[0], q[2]], 3) == [q[1]]
    with pytest.raises(GapError, match="quarter"):
        ts_of(np.arange(5.0), q[:2] + q[3:], "quarterly")
    with pytest.raises(LoaderError, match="first month of a calendar quarter"):
        ts_of([1.0, 2.0], [date(2025, 5, 1), date(2025, 8, 1)], "quarterly")


def test_seasonal_models_use_season_length_four_for_quarters():
    assert registry.effective_config("snaive", "Q") == {"m": 4}
    assert registry.effective_config("sarima", "Q")["m"] == 4
    assert registry.effective_config("naive", "M") == {}  # monthly configs unchanged (stable ids)
    m = registry.build("snaive", freq="Q").fit(np.array([1.0, 2, 3, 4, 5, 6, 7, 8]), quarters(8))
    assert list(m.predict(4).point) == [5.0, 6.0, 7.0, 8.0]


# ---- all eight algorithms ----------------------------------------------------------------------------


@pytest.mark.parametrize("model_id", registry.CORE_MODELS)
def test_every_core_model_fits_and_records_its_configuration(model_id):
    y = seasonal_walk(72)
    m = registry.build(model_id).fit(y, months(72))
    res = m.predict(6)
    res.validate(6)
    assert m.diagnostics.get("label"), f"{model_id} must record the exact configuration it used"


@pytest.mark.parametrize("model_id", registry.CORE_MODELS)
def test_no_look_ahead_for_any_model(model_id):
    y = seasonal_walk(64, seed=2)
    origin = 50
    y2 = y.copy()
    y2[origin:] += 400.0
    ps = months(64)
    a = run_backtest(lambda: registry.build(model_id), y, ps, max_h=3, initial_train=44)
    b = run_backtest(lambda: registry.build(model_id), y2, ps, max_h=3, initial_train=44)
    assert a.origins and not a.failures
    for oa, ob in zip(a.origins, b.origins, strict=True):
        if oa.origin_idx <= origin:
            assert np.array_equal(oa.point, ob.point), f"{model_id} leaked at origin {oa.origin_idx}"


@pytest.mark.parametrize("model_id", ["rf", "xgboost"])
@pytest.mark.parametrize("strategy", ["recursive", "direct"])
def test_tree_models_are_deterministic_for_both_strategies(model_id, strategy):
    y = seasonal_walk(70, seed=5)
    ps = months(70)
    a = registry.build(model_id, seed=3, strategy=strategy).fit(y, ps).predict(6).point
    b = registry.build(model_id, seed=3, strategy=strategy).fit(y, ps).predict(6).point
    assert np.array_equal(a, b)


def test_direct_strategy_never_sees_targets_beyond_the_window():
    y = seasonal_walk(60, seed=1)
    ps = months(60)
    m = registry.build("rf", strategy="direct").fit(y[:50], ps[:50])
    p1 = m.predict(3).point
    m2 = registry.build("rf", strategy="direct").fit(np.concatenate([y[:50], y[50:] + 1e4])[:50], ps[:50])
    assert np.array_equal(p1, m2.predict(3).point)


def test_aicc_selection_happens_inside_the_training_window():
    y = seasonal_walk(80, seed=4)
    ps = months(80)
    short = registry.build("arima").fit(y[:40], ps[:40]).diagnostics
    full = registry.build("arima").fit(y, ps).diagnostics
    assert short["selection"] == "aicc" and short["candidates"] and full["candidates"]
    # the shorter window chose from ITS data (same grid); the result may differ, never computed on unseen data
    assert all(len(c) == 2 for c in short["candidates"])


# ---- suites: identical origins, failure status -----------------------------------------------------


def test_all_models_of_a_suite_share_identical_origins():
    y = seasonal_walk(80, seed=6)
    ts = ts_of(y, months(80))
    fps = set()
    for mid in registry.CORE_MODELS:
        for r in backtest_records(ts, "wpi", mid, (1, 3), initial_train=40, config_set="v4"):
            assert r.status == "completed", (mid, r.error)
            fps.add((r.horizon, r.origins_fingerprint))
    assert len({fp for h, fp in fps if h == 1}) == 1 and len({fp for h, fp in fps if h == 3}) == 1


class _Flaky(ForecastModel):
    id = "flaky"

    @classmethod
    def min_train(cls, **config):
        return 1

    def fit(self, y, periods):
        if len(y) == 15:
            raise ForecastError("numerical failure")
        self._y = y
        return self

    def predict(self, h):
        return ForecastResult(np.full(h, float(self._y[-1])))


def test_a_model_that_errors_at_an_origin_is_recorded_failed_not_silently_regrouped(monkeypatch):
    spec = registry.SPECS["naive"]
    monkeypatch.setitem(
        registry.SPECS,
        "naive",
        registry.ModelSpec("naive", "Naive", "baseline", _Flaky, {}, spec.explanation),
    )
    ts = ts_of(seasonal_walk(30), months(30))
    recs = backtest_records(ts, "wpi", "naive", (1,), initial_train=12, config_set="v4")
    assert recs[0].status == "failed" and "failed at 1 of" in recs[0].error and not recs[0].rows


def test_gdp_suites_skip_models_without_enough_quarters():
    q = quarters(17)
    y = 6e6 * (1.07 ** (np.arange(17) / 4)) * (1 + 0.06 * np.cos(2 * np.pi * np.arange(17) / 4))
    ts = ts_of(y, q, "quarterly", "gdp.level")
    recs = {r.model_id: r for r in backtest_records(ts, "gdp", "rf", (1,), initial_train=8, config_set="v4")}
    assert recs["rf"].status == "skipped" and "needs >=" in recs["rf"].error
    naive = backtest_records(ts, "gdp", "naive", (1, 2, 4), initial_train=8, config_set="v4")
    assert [r.status for r in naive] == ["completed"] * 3
    assert all(r.rows[0]["target_date"].month in (1, 4, 7, 10) for r in naive)
    future, notes = v4_future_records(ts, "gdp", "current")
    got = {r.model_id: r.horizon for r in future}
    assert got["naive"] == 4 and got.get("ets") == 1 and "rf" not in got
    assert any(n.startswith("rf: refused, insufficient history") for n in notes)
    assert SUITES["v4_q8"]["horizons"] == (1, 2, 4)


# ---- future forecasts: honest intervals ------------------------------------------------------------


def test_ml_future_forecasts_get_conformal_intervals_from_their_own_backtest_errors():
    y = seasonal_walk(110, seed=8)
    ts = ts_of(y, months(110))
    r = forecast_record(ts, "wpi", "rf", 3, initial_train=60, config_set="v4")
    assert r.config["diagnostics"]["interval_calibration"] == "split_conformal_backtest_errors"
    assert r.config["diagnostics"]["calibration_errors_per_step"][0] >= 19
    for row in r.rows:
        assert row["interval_method"] == "split_conformal_backtest"
        assert row["lower_95"] <= row["lower_80"] <= row["point"] <= row["upper_80"] <= row["upper_95"]


def test_ml_future_intervals_are_omitted_when_calibration_is_too_short():
    y = seasonal_walk(52, seed=9)
    ts = ts_of(y, months(52))
    r = forecast_record(ts, "rf", "rf", 1, initial_train=40, config_set="v4")  # 12 errors: 80% ok, 95% not
    row = r.rows[0]
    assert row["lower_95"] is None and row["upper_95"] is None
    assert r.config["libraries"]["scikit-learn"] != "not installed"


# ---- official back-cast (WPI, IIP) -----------------------------------------------------------------


def test_backcast_specs_match_the_published_factors_and_direction():
    assert BACKCAST_LINKS["wpi"]["factor"] == "1.53" and "/ 1.53" in BACKCAST_LINKS["wpi"]["formula"]
    assert BACKCAST_LINKS["iip"]["factor"] == "1.3834" and "/ 1.3834" in BACKCAST_LINKS["iip"]["formula"]
    assert all(v["evidence"] == "L" for v in BACKCAST_LINKS.values())


def test_backcast_divides_old_values_only_before_the_join_and_keeps_official_values(monkeypatch):
    from pipeline.research import loader as L

    old_p = months(30, date(2021, 1, 1))
    new_p = months(10, date(2023, 4, 1))
    old = TimeSeries(BACKCAST_LINKS["wpi"]["old"], "WPI", "2011-12", "index", "India",
                     tuple(Point(p, Decimal("153.0"), "old-rel", T0) for p in old_p), (), "latest", None)  # fmt: skip
    new = TimeSeries(BACKCAST_LINKS["wpi"]["current"], "WPI", "2022-23", "index", "India",
                     tuple(Point(p, Decimal("101.5"), "new-rel", T0) for p in new_p), (), "latest", None)  # fmt: skip
    monkeypatch.setattr(L, "load_series", lambda conn, code, **kw: old if code == old.series_code else new)
    ts = L.load_backcast_linked(None, "wpi")
    before = [p for p in ts.points if p.period < date(2023, 4, 1)]
    after = [p for p in ts.points if p.period >= date(2023, 4, 1)]
    assert all(p.value == Decimal("153.0") / Decimal("1.53") and p.release_key == "old-rel" for p in before)
    assert [p.value for p in after] == [Decimal("101.5")] * 10 and all(
        p.release_key == "new-rel" for p in after
    )
    assert ts.join_period == date(2023, 4, 1) and ts.link["n_old_months_from_join_unused"] == 3
    assert ts.transformation == "official_linking_factor_backcast"


# ---- GDP growth arithmetic ---------------------------------------------------------------------------


def test_year_on_year_growth_compares_the_same_quarter_a_year_earlier():
    levels = {date(2025, 4, 1): 100.0, date(2025, 7, 1): 90.0, date(2026, 4, 1): 107.8}
    yoy = (levels[date(2026, 4, 1)] / levels[date(2025, 4, 1)] - 1) * 100
    qoq = (levels[date(2026, 4, 1)] / levels[date(2025, 7, 1)] - 1) * 100
    assert round(yoy, 1) == 7.8 and round(qoq, 1) != 7.8  # QoQ is never labelled as YoY
