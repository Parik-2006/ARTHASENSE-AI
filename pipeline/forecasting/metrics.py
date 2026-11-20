"""Forecast accuracy metrics. Pure numpy; every function documents its formula and edge cases.

Notation: a_i actual, f_i forecast, e_i = f_i - a_i, n = number of (origin, target) pairs.

  MAE   = mean |e_i|
  RMSE  = sqrt(mean e_i^2)
  Bias  = mean e_i                      (positive = over-forecast)
  sMAPE = mean 200 * |e_i| / (|a_i| + |f_i|)   [%]; a term is 0 when |a_i| + |f_i| = 0
  MASE  = mean_i |e_i| / s_i            s_i = mean |y_t - y_{t-1}| over the TRAINING window of the
                                        origin that produced pair i (training data only). Pairs with
                                        s_i = 0 are skipped and counted; if none remain it is unavailable.

A metric that cannot be computed reliably returns `None` plus a reason, never NaN.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Metric:
    value: float | None
    n: int
    reason: str | None = None  # why value is None, or a caveat


def _arr(x) -> np.ndarray:
    return np.asarray(x, dtype=float)


def _checked(a, f) -> tuple[np.ndarray, np.ndarray] | None:
    a, f = _arr(a), _arr(f)
    if a.shape != f.shape:
        raise ValueError("actual and forecast must have the same shape")
    if a.size == 0:
        return None
    if not (np.all(np.isfinite(a)) and np.all(np.isfinite(f))):
        raise ValueError("non-finite values in actuals or forecasts")
    return a, f


def mae(a, f) -> Metric:
    c = _checked(a, f)
    return (
        Metric(None, 0, "no samples") if c is None else Metric(float(np.mean(np.abs(c[1] - c[0]))), len(c[0]))
    )


def rmse(a, f) -> Metric:
    c = _checked(a, f)
    return (
        Metric(None, 0, "no samples")
        if c is None
        else Metric(float(np.sqrt(np.mean((c[1] - c[0]) ** 2))), len(c[0]))
    )


def bias(a, f) -> Metric:
    c = _checked(a, f)
    return Metric(None, 0, "no samples") if c is None else Metric(float(np.mean(c[1] - c[0])), len(c[0]))


def smape(a, f) -> Metric:
    c = _checked(a, f)
    if c is None:
        return Metric(None, 0, "no samples")
    act, fc = c
    denom = np.abs(act) + np.abs(fc)
    terms = np.where(denom == 0, 0.0, 200.0 * np.abs(fc - act) / np.where(denom == 0, 1.0, denom))
    return Metric(float(np.mean(terms)), len(act))


def naive_scale(train: np.ndarray) -> float | None:
    """In-sample mean absolute one-step change of a training window; None if it cannot be computed."""
    train = _arr(train)
    if train.size < 2:
        return None
    s = float(np.mean(np.abs(np.diff(train))))
    return s if s > 0 else None


def mase(a, f, scales) -> Metric:
    """`scales[i]` is the training-window scale for pair i (None allowed -> pair skipped)."""
    c = _checked(a, f)
    if c is None:
        return Metric(None, 0, "no samples")
    act, fc = c
    if len(scales) != len(act):
        raise ValueError("one scale per pair is required")
    keep = [i for i, s in enumerate(scales) if s is not None and s > 0]
    if not keep:
        return Metric(None, 0, "all training windows are constant: MASE denominator is zero")
    idx = np.array(keep)
    s = np.array([scales[i] for i in keep], dtype=float)
    value = float(np.mean(np.abs(fc[idx] - act[idx]) / s))
    skipped = len(act) - len(keep)
    return Metric(value, len(keep), f"{skipped} pair(s) skipped: zero scale" if skipped else None)


def interval_coverage(actual, lower, upper) -> Metric:
    """Fraction of actuals inside [lower, upper]. Pairs without an interval must be removed first."""
    a, lo, hi = _arr(actual), _arr(lower), _arr(upper)
    if a.size == 0:
        return Metric(None, 0, "no samples")
    if np.any(lo > hi):
        raise ValueError("lower bound above upper bound")
    return Metric(float(np.mean((a >= lo) & (a <= hi))), len(a))


def interval_width(lower, upper) -> Metric:
    lo, hi = _arr(lower), _arr(upper)
    if lo.size == 0:
        return Metric(None, 0, "no samples")
    return Metric(float(np.mean(hi - lo)), len(lo))
