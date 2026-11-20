"""Prediction intervals. Two honest methods; nothing is "prediction +- x%".

1. Model-based (native): each model that has a probabilistic form returns its own intervals
   (random-walk / drift Gaussian formulas, ARIMA state-space, ETS state-space).
2. Online conformal (`online_conformal`): distribution-free, built ONLY from forecast errors that
   were already observable at the origin. For the h-step forecast made at origin index i
   (target index i+h-1), the calibration set is every earlier origin j with j+h-1 < i, i.e. whose
   target had already happened when the forecast was issued. With m calibration errors the
   interval is  point +- q  where q is the ceil((m+1)*level)-th smallest |error|. If
   ceil((m+1)*level) > m the interval is unavailable (e.g. 95% needs at least 19 errors).
"""

from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np

_Z = {level: NormalDist().inv_cdf(0.5 + level / 200.0) for level in (80, 95)}


def z_value(level: int) -> float:
    return _Z[level]


def gaussian_intervals(
    point: np.ndarray, sigma_h: np.ndarray, levels=(80, 95)
) -> dict[int, tuple[np.ndarray, np.ndarray]]:
    return {lv: (point - z_value(lv) * sigma_h, point + z_value(lv) * sigma_h) for lv in levels}


def conformal_quantile(abs_errors: list[float] | np.ndarray, level: int) -> float | None:
    """Split-conformal quantile of absolute errors, or None if too few calibration points."""
    e = np.sort(np.asarray(abs_errors, dtype=float))
    m = len(e)
    k = math.ceil((m + 1) * level / 100.0)
    if m == 0 or k > m:
        return None
    return float(e[k - 1])


def online_conformal(
    origins: list[int], points: list[float], actuals: list[float], h: int, levels=(80, 95)
) -> list[dict[int, tuple[float, float] | None]]:
    """Intervals for h-step forecasts made at `origins` (indices, ascending), leakage-free.

    points[k]/actuals[k] belong to origins[k]; the target of origin o is index o + h - 1.
    """
    out: list[dict[int, tuple[float, float] | None]] = []
    for k, o in enumerate(origins):
        # only errors whose target index is strictly before the current origin are known
        calib = [abs(actuals[j] - points[j]) for j in range(k) if origins[j] + h - 1 < o]
        row: dict[int, tuple[float, float] | None] = {}
        for lv in levels:
            q = conformal_quantile(calib, lv)
            row[lv] = None if q is None else (points[k] - q, points[k] + q)
        out.append(row)
    return out
