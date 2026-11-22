# ruff: noqa: E501
"""WPI-like regression: a long flat history followed by a sudden level shift.

Synthetic data (clearly NOT stored data) shaped like the situation found in the real WPI series, where
the index sat near 100 for three years and then jumped. These tests pin down what the evaluation
engine must do in that situation: stay aligned and leak-free, report poor calibration honestly, and
make an explosive fit visible. Nothing here changes how any score is computed.
"""

from datetime import date

import numpy as np

from pipeline.forecasting import registry
from pipeline.forecasting.backtesting import evaluate_horizon, run_backtest


def months(n, start=date(2023, 4, 1)):
    base = start.year * 12 + start.month - 1
    return [date((base + k) // 12, (base + k) % 12 + 1, 1) for k in range(n)]


def shifted_series():
    rng = np.random.default_rng(3)
    flat = 100 + np.cumsum(rng.normal(0.02, 0.35, 36)) * 0.5  # quiet, slowly moving
    jump = flat[-1] + np.array([4.3, 5.5, 5.7, 5.4, 6.2, 8.0, 8.8])  # sudden regime shift
    return np.concatenate([flat, jump])


def test_alignment_and_no_leakage_under_a_level_shift():
    y = shifted_series()
    p = months(len(y))
    res = run_backtest(lambda: registry.build("naive", 0), y, p, max_h=6, initial_train=31)
    ev = evaluate_horizon(res, y, p, 6)
    for r in ev.rows:
        # the target is exactly 6 months after the origin and the actual is the series value at that month
        assert (r.target_date.year * 12 + r.target_date.month) - (
            r.origin_date.year * 12 + r.origin_date.month
        ) == 6
        assert r.actual == y[p.index(r.target_date)]
        # naive = last value visible at the origin: nothing after the origin may be used
        assert r.point == y[p.index(r.origin_date)]
        # scale uses the training window only (flat history -> small scale)
        assert r.scale is not None and r.scale < 1.0


def test_poor_calibration_is_reported_not_hidden_or_zeroed():
    y = shifted_series()
    p = months(len(y))
    res = run_backtest(lambda: registry.build("arima", 0), y, p, max_h=6, initial_train=31)
    ev = evaluate_horizon(res, y, p, 6)
    assert ev.status == "ok" and ev.n_origins >= 5
    assert ev.metrics["coverage_80"].value is not None
    assert ev.metrics["coverage_80"].value < 0.5  # intervals built from the flat history miss the shift
    assert ev.metrics["mase"].value > 5  # tiny training-window scale makes MASE large after the shift
    assert ev.rankable is False  # fewer than 12 origins: indicative only


# TEST FIXTURE ONLY: the WPI (2022-23 base) values Apr 2023 - Apr 2026 as read from the local database
# during the Forecasts V2 audit. With these, ARIMA(1,1,0) (enforce_stationarity=False) fits AR(1) = 1.201
# and forecasts 160.4 six months out. Kept here so the finding stays reproducible without a database.
WPI_THROUGH_APR_2026 = [
    99.0, 98.6, 98.3, 99.1, 99.5, 99.6, 100.1, 100.1, 99.4, 99.3, 99.3, 99.4, 99.9, 100.4, 100.7, 101.0, 100.8, 101.2,
    102.1, 102.1, 101.6, 101.1, 100.9, 100.6, 100.5, 100.2, 100.3, 100.2, 100.8, 101.0, 100.9, 101.5, 101.9, 102.3,
    103.1, 104.6, 108.9,
]  # fmt: skip


def test_explosive_ar_fit_is_flagged():
    """After a sudden +4.3 shift, ARIMA(1,1,0) without enforced stationarity has an AR root inside the unit circle."""
    y = np.array(WPI_THROUGH_APR_2026)
    p = months(len(y))
    m = registry.build("arima", 0)
    m.fit(y, p)
    assert m.diagnostics["explosive_ar"] is True
    assert m.diagnostics["ar_min_root_modulus"] < 1.0
    pt = m.predict(6).point
    assert pt[-1] > 150  # the explosive extrapolation seen in the audit (actual in this period was ~113)
    # one month earlier (before the shift entered the fit) the same model is stable
    m2 = registry.build("arima", 0)
    m2.fit(y[:-1], p[:-1])
    assert m2.diagnostics["explosive_ar"] is False
    # a quiet random walk must not be flagged
    calm = 100 + np.cumsum(np.random.default_rng(1).normal(0.1, 0.3, 40))
    m = registry.build("arima", 0)
    m.fit(calm, months(40))
    assert m.diagnostics["explosive_ar"] is False


def test_naive_baseline_has_no_ar_diagnostic_noise():
    m = registry.build("naive", 0)
    m.fit(shifted_series(), months(43))
    assert "explosive_ar" not in m.diagnostics
