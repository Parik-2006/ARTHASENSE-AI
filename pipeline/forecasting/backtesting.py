"""Rolling-origin backtesting.

At origin index i (= number of observations visible), the model sees ONLY y[:i] (expanding window) or
y[i-window:i] (rolling window), predicts steps 1..max_h, and the predictions are later compared with
y[i : i+max_h]. A new model instance is built per origin, so nothing can leak between origins.
Index i corresponds to the first month NOT yet observed, so the h-step target of origin i is y[i+h-1].
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np

from pipeline.forecasting import metrics as M
from pipeline.forecasting.interfaces import (
    LEVELS,
    ForecastModel,
    ModelUnavailable,
    future_periods,
    infer_frequency,
)
from pipeline.forecasting.intervals import online_conformal

MIN_ORIGINS_EVALUATE = 5  # fewer origins than this: no metrics are reported at all
MIN_ORIGINS_RANK = 12  # fewer than this: metrics are shown but flagged "indicative, not rankable"


@dataclass
class OriginForecast:
    origin_idx: int
    origin_date: date  # last observed month at the origin
    train_start: date
    n_train: int
    point: np.ndarray
    intervals: dict[int, tuple[np.ndarray, np.ndarray]]
    interval_method: str | None
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass
class BacktestResult:
    model_id: str
    config: dict[str, Any]
    seed: int
    max_h: int
    initial_train: int
    window: int | None
    step: int
    origins: list[OriginForecast]
    failures: list[dict[str, Any]]
    runtime_seconds: float
    unavailable: str | None = None


def origin_indices(n: int, initial_train: int, step: int = 1) -> list[int]:
    if initial_train < 1 or step < 1:
        raise ValueError("initial_train and step must be >= 1")
    return list(range(initial_train, n, step))


def run_backtest(
    factory: Callable[[], ForecastModel],
    y: np.ndarray,
    periods: list[date],
    *,
    max_h: int,
    initial_train: int,
    step: int = 1,
    window: int | None = None,
) -> BacktestResult:
    y = np.asarray(y, dtype=float)
    probe = factory()
    started = time.perf_counter()
    origins: list[OriginForecast] = []
    failures: list[dict[str, Any]] = []
    unavailable = None
    for i in origin_indices(len(y), initial_train, step):
        lo = 0 if window is None else max(0, i - window)
        train_y, train_p = y[lo:i], periods[lo:i]  # <- the ONLY data the model may see
        model = factory()
        elig = model.eligibility(len(train_y))
        if not elig.ok:
            failures.append({"origin_idx": i, "reason": elig.reason, "kind": "ineligible"})
            continue
        try:
            res = model.fit(train_y, train_p).predict(max_h)
            res.validate(max_h)
        except ModelUnavailable as exc:
            unavailable = str(exc)
            break
        except Exception as exc:  # any model failure is recorded per origin, never hidden or fatal
            failures.append({"origin_idx": i, "reason": f"{type(exc).__name__}: {exc}", "kind": "error"})
            continue
        origins.append(
            OriginForecast(i, train_p[-1], train_p[0], len(train_y), res.point, res.intervals,
                           res.interval_method, model.diagnostics)
        )  # fmt: skip
    return BacktestResult(
        probe.id, probe.config, probe.seed, max_h, initial_train, window, step, origins, failures,
        time.perf_counter() - started, unavailable,
    )  # fmt: skip


@dataclass
class HorizonRow:
    origin_idx: int
    origin_date: date
    target_date: date
    point: float
    actual: float
    intervals: dict[int, tuple[float, float]]  # stored intervals (native, else conformal)
    interval_method: str | None
    scale: float | None  # MASE scale from the origin's training window


@dataclass
class HorizonEvaluation:
    h: int
    rows: list[HorizonRow]
    metrics: dict[str, M.Metric]
    n_origins: int
    status: str  # "ok" | "insufficient"
    rankable: bool
    reason: str | None = None


def evaluate_horizon(res: BacktestResult, y: np.ndarray, periods: list[date], h: int) -> HorizonEvaluation:
    y = np.asarray(y, dtype=float)
    used = [o for o in res.origins if o.origin_idx + h - 1 < len(y)]
    n = len(used)
    if n < MIN_ORIGINS_EVALUATE:
        return HorizonEvaluation(h, [], {}, n, "insufficient", False,
                                 f"only {n} usable forecast origin(s); at least {MIN_ORIGINS_EVALUATE} needed")  # fmt: skip
    pts = [float(o.point[h - 1]) for o in used]
    acts = [float(y[o.origin_idx + h - 1]) for o in used]
    native = all(lv in o.intervals for o in used for lv in LEVELS)
    method = None
    if native:
        method = used[0].interval_method
        ivs = [
            {lv: (float(o.intervals[lv][0][h - 1]), float(o.intervals[lv][1][h - 1])) for lv in LEVELS}
            for o in used
        ]
    else:
        conf = online_conformal([o.origin_idx for o in used], pts, acts, h, LEVELS)
        method = "online_conformal"
        ivs = [{lv: iv for lv, iv in row.items() if iv is not None} for row in conf]
    scales = [M.naive_scale(y[: o.origin_idx - 0][-o.n_train :]) for o in used]  # training window only
    rows = [
        HorizonRow(o.origin_idx, o.origin_date, periods[o.origin_idx + h - 1] if o.origin_idx + h - 1 < len(periods) else future_periods(periods[-1], 1, infer_frequency(periods))[0],
                   pts[k], acts[k], ivs[k], method if ivs[k] else None, scales[k])
        for k, o in enumerate(used)
    ]  # fmt: skip
    metrics: dict[str, M.Metric] = {
        "mae": M.mae(acts, pts),
        "rmse": M.rmse(acts, pts),
        "mase": M.mase(acts, pts, scales),
        "smape": M.smape(acts, pts),
        "bias": M.bias(acts, pts),
    }
    for lv in LEVELS:
        have = [k for k in range(n) if lv in ivs[k]]
        if len(have) >= MIN_ORIGINS_EVALUATE:
            a = [acts[k] for k in have]
            lo = [ivs[k][lv][0] for k in have]
            hi = [ivs[k][lv][1] for k in have]
            metrics[f"coverage_{lv}"] = M.interval_coverage(a, lo, hi)
            metrics[f"width_{lv}"] = M.interval_width(lo, hi)
        else:
            why = (
                f"only {len(have)} interval(s) available; at least {MIN_ORIGINS_EVALUATE} needed to report coverage"
                if method == "online_conformal" or have
                else "model has no intervals"
            )
            metrics[f"coverage_{lv}"] = M.Metric(None, len(have), why)
    rankable = n >= MIN_ORIGINS_RANK
    return HorizonEvaluation(h, rows, metrics, n, "ok", rankable,
                             None if rankable else f"indicative only: {n} origins (< {MIN_ORIGINS_RANK})")  # fmt: skip
