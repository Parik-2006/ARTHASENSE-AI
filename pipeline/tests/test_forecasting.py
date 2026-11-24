"""Forecasting engine tests: exact numerical fixtures, leakage, alignment, reproducibility."""

from datetime import UTC, date, datetime
from decimal import Decimal
from math import sqrt

import numpy as np
import pytest

from pipeline.forecasting import metrics as M
from pipeline.forecasting import registry
from pipeline.forecasting.backtesting import evaluate_horizon, origin_indices, run_backtest
from pipeline.forecasting.baselines import Drift, Naive, SeasonalNaive
from pipeline.forecasting.experiments import (
    backtest_records,
    dataset_fingerprint,
    forecast_record,
    max_evaluable_horizon,
)
from pipeline.forecasting.interfaces import (
    ForecastError,
    ForecastModel,
    ForecastResult,
    ModelUnavailable,
    future_periods,
    validate_history,
)
from pipeline.forecasting.intervals import conformal_quantile, online_conformal, z_value
from pipeline.forecasting.ml import build_training, make_features
from pipeline.research.loader import build_series


def months(n, start=date(2023, 1, 1)):
    base = start.year * 12 + start.month - 1
    return [date((base + k) // 12, (base + k) % 12 + 1, 1) for k in range(n)]


def walk(n, seed=0):
    rng = np.random.default_rng(seed)
    return 100 + np.cumsum(rng.normal(0.3, 1.0, n))


def make_ts(values, series_code="test.series.index"):
    ps = months(len(values))
    rows = [
        (p, Decimal(repr(float(v))), "k1", datetime(2026, 1, 1, tzinfo=UTC))
        for p, v in zip(ps, values, strict=True)
    ]
    return build_series((series_code, "TEST", "2022-23", "index", "India"), rows)


# ---- baselines: exact fixtures -----------------------------------------------------------------


def test_naive_multistep_and_dates():
    y = np.array([1.0, 2.0, 3.0])
    m = Naive().fit(y, months(3))
    assert list(m.predict(3).point) == [3.0, 3.0, 3.0]
    assert future_periods(date(2025, 11, 1), 3) == [date(2025, 12, 1), date(2026, 1, 1), date(2026, 2, 1)]


def test_seasonal_naive_uses_same_month_last_year():
    y = np.arange(24, dtype=float)  # y_t = t
    p = SeasonalNaive().fit(y, months(24)).predict(14).point
    assert list(p[:12]) == list(range(12, 24))  # h=1 -> value 12 months before the target
    assert p[12] == p[0] and p[13] == p[1]  # repeats after a full year
    # h=12 equals the latest observation, i.e. seasonal naive == naive at h=12
    assert p[11] == 23.0


def test_seasonal_naive_refuses_short_history():
    assert not SeasonalNaive().eligibility(11).ok
    assert SeasonalNaive().eligibility(12).ok


def test_drift_line():
    p = Drift().fit(np.array([1.0, 2.0, 3.0, 4.0, 5.0]), months(5)).predict(2).point
    assert list(p) == [6.0, 7.0]


def test_naive_interval_is_the_textbook_gaussian_formula():
    y = np.array([10.0, 11.0, 13.0, 12.0, 15.0])
    res = Naive().fit(y, months(5)).predict(4)
    sigma = float(np.std(np.diff(y), ddof=1))
    lo, hi = res.intervals[80]
    for h in range(1, 5):
        assert hi[h - 1] == pytest.approx(15.0 + z_value(80) * sigma * sqrt(h))
        assert lo[h - 1] == pytest.approx(15.0 - z_value(80) * sigma * sqrt(h))
    assert z_value(95) == pytest.approx(1.959964, abs=1e-6)
    assert res.interval_method == "random_walk_gaussian"


def test_no_interval_when_history_too_short_to_estimate_spread():
    assert Naive().fit(np.array([1.0, 2.0]), months(2)).predict(2).intervals == {}


def test_all_models_produce_ordered_finite_intervals():
    y = walk(60)
    for mid in ("naive", "snaive", "drift", "ets", "arima", "sarima"):
        res = registry.build(mid).fit(y, months(60)).predict(6)
        res.validate(6)
        for lo, hi in res.intervals.values():
            assert np.all(lo <= hi)


# ---- input validation --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "y,ps",
    [
        (np.array([1.0, np.nan, 3.0]), months(3)),  # missing values are never filled
        (np.array([1.0, 2.0, 3.0]), [date(2023, 1, 1), date(2023, 3, 1), date(2023, 4, 1)]),  # gap
        (np.array([1.0, 2.0, 3.0]), [date(2023, 1, 1), date(2023, 2, 1), date(2023, 2, 1)]),  # duplicate
        (np.array([1.0, 2.0]), [date(2023, 1, 15), date(2023, 2, 15)]),  # not first of month
        (np.array([]), []),
    ],
)
def test_invalid_histories_rejected(y, ps):
    with pytest.raises(ValueError):
        validate_history(y, ps)
    with pytest.raises(ValueError):
        Naive().fit(y, ps)


def test_mixed_base_rejected_by_the_loader():
    from pipeline.research.loader import MixedBaseError, splice

    a = build_series(
        ("a", "WPI", "2011-12", "index", "India"),
        [(date(2023, 1, 1), Decimal(1), "k", datetime(2026, 1, 1, tzinfo=UTC))],
    )
    b = build_series(
        ("b", "WPI", "2022-23", "index", "India"),
        [(date(2023, 2, 1), Decimal(1), "k", datetime(2026, 1, 1, tzinfo=UTC))],
    )
    with pytest.raises(MixedBaseError):
        splice(a, b, "x")


# ---- metrics: exact ----------------------------------------------------------------------------


def test_metrics_exact():
    a, f = [1.0, 2.0, 3.0], [2.0, 2.0, 5.0]
    assert M.mae(a, f).value == pytest.approx(1.0)
    assert M.rmse(a, f).value == pytest.approx(sqrt(5 / 3))
    assert M.bias(a, f).value == pytest.approx(1.0)
    assert M.smape(a, f).value == pytest.approx((200 / 3 + 0 + 50) / 3)
    assert M.mase(a, f, [1.0, 1.0, 2.0]).value == pytest.approx(2 / 3)


def test_metric_edge_cases_are_safe():
    assert M.smape([0.0], [0.0]).value == 0.0  # zero denominator -> term 0, no NaN
    assert M.naive_scale(np.array([5.0, 5.0, 5.0])) is None
    m = M.mase([1.0, 2.0], [2.0, 4.0], [None, 2.0])
    assert m.value == pytest.approx(1.0) and m.n == 1 and "skipped" in m.reason
    none = M.mase([1.0], [2.0], [None])
    assert none.value is None and "zero" in none.reason
    assert M.mae([], []).value is None
    with pytest.raises(ValueError):
        M.mae([1.0], [np.nan])


def test_interval_coverage_and_width():
    assert M.interval_coverage([1, 5, 9], [0, 0, 0], [2, 4, 10]).value == pytest.approx(2 / 3)
    assert M.interval_width([0, 1], [2, 5]).value == pytest.approx(3.0)
    with pytest.raises(ValueError):
        M.interval_coverage([1], [3], [2])


# ---- conformal intervals: calibration uses only realised errors --------------------------------


def test_conformal_quantile_and_minimum_calibration():
    errs = list(range(1, 20))  # 19 errors 1..19
    assert conformal_quantile(errs, 95) == 19.0  # ceil(20*0.95) = 19th smallest
    assert conformal_quantile(errs[:18], 95) is None  # 95% needs >= 19 calibration errors
    assert conformal_quantile([1, 2, 3, 4], 80) == 4.0  # ceil(5*0.8) = 4
    assert conformal_quantile([1, 2, 3], 80) is None


def test_online_conformal_never_uses_unrealised_targets():
    # h=3, origins 0..: the error of origin j is known only when j+h-1 < current origin
    origins = list(range(10))
    pts = [0.0] * 10
    acts = [float(k + 1) for k in range(10)]  # |error| of origin k is k+1
    out = online_conformal(origins, pts, acts, 3, levels=(80,))
    # origin 9: usable calibration origins j with j+2 < 9 -> j=0..6 -> errors 1..7 -> m=7 -> k=ceil(8*.8)=7
    assert out[9][80] == (-7.0, 7.0)
    # origin 3: j+2 < 3 -> j=0 only -> m=1 -> unavailable
    assert out[3][80] is None
    # future errors cannot change an earlier interval
    acts2 = acts[:9] + [1e6]
    assert online_conformal(origins, pts, acts2, 3, levels=(80,))[8] == out[8]


# ---- rolling origin: alignment, leakage, reproducibility ---------------------------------------


def test_rolling_origin_split_and_alignment():
    y = np.arange(30, dtype=float)
    ps = months(30)
    assert origin_indices(30, 20, 3) == [20, 23, 26, 29]
    res = run_backtest(lambda: Naive(), y, ps, max_h=3, initial_train=20)
    ev = evaluate_horizon(res, y, ps, 3)
    first = ev.rows[0]  # origin index 20 = months 0..19 visible
    assert first.origin_date == ps[19] and first.target_date == ps[22] and first.actual == 22.0
    assert first.point == 19.0  # naive forecast from the last visible value y[19]
    assert (
        evaluate_horizon(run_backtest(lambda: Naive(), y, ps, max_h=3, initial_train=24), y, ps, 3).status
        == "insufficient"
    )
    assert all(r.target_date == ps[r.origin_idx + 2] for r in ev.rows)
    assert ev.rows[-1].origin_idx + 2 == 29  # no target beyond the data


@pytest.mark.parametrize("model_id", ["naive", "snaive", "drift", "ets", "arima", "xgboost"])
def test_future_mutation_does_not_change_earlier_forecasts(model_id):
    y = walk(48, seed=3)
    origin = 40
    y2 = y.copy()
    y2[origin:] += 500.0  # rewrite everything from the origin onward
    ps = months(48)
    a = run_backtest(lambda: registry.build(model_id), y, ps, max_h=3, initial_train=34)
    b = run_backtest(lambda: registry.build(model_id), y2, ps, max_h=3, initial_train=34)
    for oa, ob in zip(a.origins, b.origins, strict=True):
        if oa.origin_idx <= origin:
            assert np.array_equal(oa.point, ob.point), f"{model_id} leaked at origin {oa.origin_idx}"
            for lv in oa.intervals:
                assert np.array_equal(oa.intervals[lv][0], ob.intervals[lv][0])


def test_rolling_features_never_include_future_changes():
    d = np.arange(1.0, 31.0)
    j = 20
    f1 = make_features(d, j)
    d2 = d.copy()
    d2[j:] = -999.0
    assert make_features(d2, j) == f1
    X, t = build_training(d)
    assert X.shape[0] == len(d) - 6 and t[0] == d[6]  # first target d[6] built from d[:6] only


def test_training_only_mase_scale_ignores_the_future():
    y = walk(40)
    y2 = y.copy()
    y2[30:] *= 3
    ps = months(40)
    r1 = evaluate_horizon(run_backtest(lambda: Naive(), y, ps, max_h=1, initial_train=20), y, ps, 1)
    r2 = evaluate_horizon(run_backtest(lambda: Naive(), y2, ps, max_h=1, initial_train=20), y2, ps, 1)
    for a, b in zip(r1.rows, r2.rows, strict=True):
        if a.origin_idx <= 29:
            assert a.scale == b.scale and a.point == b.point


def test_xgboost_is_reproducible_and_uses_recursive_forecasts():
    y = walk(45, seed=1)
    ps = months(45)
    a = registry.build("xgboost", seed=7).fit(y, ps).predict(6).point
    b = registry.build("xgboost", seed=7).fit(y, ps).predict(6).point
    assert np.array_equal(a, b)
    v3 = registry.build("xgboost", config_set="v3")  # V1 features: lags 1,2,3,6 -> 24 + 6 + 1
    assert not v3.eligibility(30).ok and v3.eligibility(31).ok
    v4 = registry.build("xgboost")  # V4 monthly features add lag 12 -> 24 + 12 + 1
    assert not v4.eligibility(36).ok and v4.eligibility(37).ok


def test_experiment_repeatability_and_ids():
    ts = make_ts(walk(40, seed=5))
    r1 = backtest_records(ts, "wpi", "ets", (1, 3), initial_train=18)
    r2 = backtest_records(ts, "wpi", "ets", (1, 3), initial_train=18)
    assert [r.experiment_id for r in r1] == [r.experiment_id for r in r2]
    for a, b in zip(r1, r2, strict=True):
        for k in a.metrics:
            assert a.metrics[k]["value"] == pytest.approx(b.metrics[k]["value"], rel=1e-9)
    other = backtest_records(make_ts(walk(40, seed=6)), "wpi", "ets", (1, 3), initial_train=18)
    assert other[0].experiment_id != r1[0].experiment_id  # different data -> different experiment
    assert dataset_fingerprint(ts) == dataset_fingerprint(make_ts(walk(40, seed=5)))


# ---- failures, eligibility, honest skipping -----------------------------------------------------


class Exploding(ForecastModel):
    id = "boom"

    @classmethod
    def min_train(cls, **c):
        return 1

    def fit(self, y, periods):
        if len(y) % 2 == 0:
            raise ForecastError("synthetic failure")
        self._y = y
        return self

    def predict(self, h):
        return ForecastResult(np.full(h, self._y[-1]))


class Absent(Exploding):
    id = "absent"

    def fit(self, y, periods):
        raise ModelUnavailable("weights not approved")


def test_model_failures_are_recorded_not_fatal_or_hidden():
    y, ps = walk(30), months(30)
    res = run_backtest(lambda: Exploding(), y, ps, max_h=1, initial_train=10)
    assert res.failures and all(f["kind"] == "error" for f in res.failures)
    assert len(res.origins) + len(res.failures) == 20
    gone = run_backtest(lambda: Absent(), y, ps, max_h=1, initial_train=10)
    assert gone.unavailable == "weights not approved" and gone.origins == []


def test_cpi_sized_series_is_not_evaluated():
    ts = make_ts(walk(12))  # CPI Current has only 12 months
    for mid in ("naive", "snaive", "ets", "sarima", "xgboost"):
        for start in (6, 12):  # 6 < one seasonal cycle; 12 leaves no origin with an observed target
            recs = backtest_records(ts, "cpi", mid, (1, 3, 6, 12), initial_train=start)
            assert all(r.status == "skipped" and r.metrics == {} and r.rows == [] for r in recs), (mid, start)
    with pytest.raises(ValueError, match="cannot be validated"):
        forecast_record(ts, "cpi", "naive", 3)


def test_seasonal_models_are_skipped_when_history_is_too_short():
    ts = make_ts(walk(43))
    recs = backtest_records(ts, "wpi", "sarima", (1, 3, 6, 12), initial_train=18)
    assert all(r.status == "skipped" and "36" in r.error for r in recs)
    ok = backtest_records(ts, "wpi", "sarima", (1, 3, 12), initial_train=36)
    by_h = {r.horizon: r for r in ok}
    assert by_h[1].status == "completed" and not by_h[1].rankable  # 7 origins: indicative only
    assert by_h[12].status == "skipped" and "origin" in by_h[12].error


def test_unavailable_foundation_models_are_never_fabricated():
    ts = make_ts(walk(43))
    for mid in ("chronos2", "timesfm25"):
        recs = backtest_records(ts, "wpi", mid, (1, 3), initial_train=18)
        assert all(r.status == "skipped" and r.error.startswith("unavailable") and not r.rows for r in recs)
    with pytest.raises(ValueError, match="unavailable"):
        forecast_record(ts, "wpi", "chronos2", 3)


def test_horizon_limits_and_future_forecast_shape():
    assert max_evaluable_horizon(43, 18) == 21
    ts = make_ts(walk(43))
    rec = forecast_record(ts, "wpi", "ets", 3)
    assert rec.kind == "forecast" and [r["step"] for r in rec.rows] == [1, 2, 3]
    assert rec.rows[0]["target_date"] == future_periods(ts.periods[-1], 1)[0]
    assert all(r["actual"] is None for r in rec.rows)  # genuine future: no actuals
    with pytest.raises(ValueError, match="cannot be validated"):
        forecast_record(ts, "wpi", "naive", 40)


def test_coverage_is_reported_against_nominal_not_assumed():
    ts = make_ts(walk(80, seed=9))
    rec = {r.horizon: r for r in backtest_records(ts, "wpi", "naive", (1,), initial_train=30)}[1]
    cov = rec.metrics["coverage_80"]
    assert 0.0 <= cov["value"] <= 1.0 and cov["n"] == rec.n_origins
    assert all(r["lower_80"] <= r["upper_80"] for r in rec.rows if r["lower_80"] is not None), (
        "interval bounds must be ordered"
    )


class PointOnly(ForecastModel):
    """A model with no native intervals (like XGBoost): intervals can only come from online conformal."""

    id = "point_only"

    @classmethod
    def min_train(cls, **c):
        return 1

    def fit(self, y, periods):
        self._y = y
        return self

    def predict(self, h):
        return ForecastResult(np.full(h, self._y[-1]))


def test_conformal_coverage_needs_enough_calibrated_samples():
    """Coverage is only reported when at least MIN_ORIGINS_EVALUATE intervals exist, and n is the count of INTERVALS."""
    y, ps = walk(60, seed=2), months(60)
    res = run_backtest(lambda: PointOnly(), y, ps, max_h=3, initial_train=30)
    ev = evaluate_horizon(res, y, ps, 3)  # 28 origins
    cov80 = ev.metrics["coverage_80"]
    n_with = sum(1 for r in ev.rows if 80 in r.intervals)
    assert (
        cov80.value is not None and cov80.n == n_with and n_with < ev.n_origins
    )  # early origins had nothing to calibrate on
    # 95% needs >= 19 earlier realised errors: only the last 7 of 28 origins qualify, so n = 7 (not 28)
    cov95 = ev.metrics["coverage_95"]
    assert cov95.value is not None and cov95.n == 7 < cov80.n
    short = run_backtest(lambda: PointOnly(), y, ps, max_h=3, initial_train=52)
    ev2 = evaluate_horizon(short, y, ps, 3)  # 6 origins -> only a couple of conformal intervals
    assert ev2.status == "ok" and ev2.metrics["coverage_80"].value is None
    assert ev2.metrics["coverage_80"].n < 5 and "at least 5" in ev2.metrics["coverage_80"].reason
    assert "width_80" not in ev2.metrics
