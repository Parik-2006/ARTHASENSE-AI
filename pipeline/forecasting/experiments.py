"""Experiment orchestration: dataset loading, eligibility rules, suites, deterministic ids."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np
import psycopg

from pipeline.forecasting import registry
from pipeline.forecasting.backtesting import (
    MIN_ORIGINS_EVALUATE,
    BacktestResult,
    HorizonEvaluation,
    evaluate_horizon,
    origin_indices,
    run_backtest,
)
from pipeline.forecasting.interfaces import LEVELS, ForecastModel, future_periods
from pipeline.research.loader import GapError, LoaderError, TimeSeries, load_series

# Index LEVELS are forecast, never official inflation / growth rates.
INDICATORS: dict[str, str] = {
    "cpi": "mospi.cpi.2024.current.all_india.combined.general.index",
    "wpi": "mospi.wpi.2022-23.india.all_commodities.index",
    "iip": "mospi.iip.2022-23.india.general.index",
}
DEFAULT_HORIZONS = (1, 3, 6, 12)
MIN_INITIAL_TRAIN = 12  # at least one full seasonal cycle must be observed before anything is evaluated
CODE_VERSION = "1"


def dataset_fingerprint(ts: TimeSeries) -> str:
    body = [
        ts.series_code,
        ts.snapshot_policy,
        [[p.period.isoformat(), str(p.value), p.release_key] for p in ts.points],
    ]
    return hashlib.sha256(json.dumps(body).encode()).hexdigest()[:16]


def origins_fingerprint(origin_idx: list[int]) -> str:
    return hashlib.sha256(json.dumps(origin_idx).encode()).hexdigest()[:16]


def experiment_id(parts: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:20]


def load_indicator(
    conn: psycopg.Connection, indicator: str, *, policy: str = "latest", as_of=None
) -> TimeSeries:
    """Load the headline index; refuses series with gaps (no interpolation, ever)."""
    if indicator not in INDICATORS:
        raise ValueError(f"unknown indicator {indicator!r}; choose from {', '.join(INDICATORS)}")
    try:
        return load_series(conn, INDICATORS[indicator], policy=policy, as_of=as_of, require_complete=True)  # type: ignore[arg-type]
    except GapError as exc:
        raise LoaderError(f"{indicator}: series has missing months, refusing to forecast ({exc})") from exc


def max_evaluable_horizon(n: int, initial_train: int, min_origins: int = MIN_ORIGINS_EVALUATE) -> int:
    """Largest h for which at least `min_origins` origins have an observed target."""
    return max(0, n - initial_train - min_origins + 1)


@dataclass
class RunRecord:
    experiment_id: str
    kind: str  # backtest | forecast
    indicator: str
    series_code: str
    model_id: str
    model_name: str
    model_version: str
    config: dict[str, Any]
    seed: int
    horizon: int
    status: str  # completed | failed | skipped
    error: str | None
    suite: str | None
    snapshot_policy: str
    dataset_fingerprint: str
    origins_fingerprint: str | None
    training_start: date | None
    training_cutoff: date
    n_origins: int
    runtime_seconds: float
    rows: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, dict[str, Any]] = field(default_factory=dict)  # name -> {value, n, note}
    rankable: bool = False
    diagnostics: dict[str, Any] = field(default_factory=dict)


def _metric_dict(ev: HorizonEvaluation) -> dict[str, dict[str, Any]]:
    return {
        k: {"value": m.value, "n": m.n, "note": m.reason}
        for k, m in ev.metrics.items()
        if m.value is not None
    }


def _rows(ev: HorizonEvaluation, y: np.ndarray) -> list[dict[str, Any]]:
    out = []
    for r in ev.rows:
        row = {
            "origin_date": r.origin_date,
            "target_date": r.target_date,
            "step": ev.h,
            "point": r.point,
            "actual": r.actual,
            "interval_method": r.interval_method,
        }
        for lv in LEVELS:
            lo_hi = r.intervals.get(lv)
            row[f"lower_{lv}"], row[f"upper_{lv}"] = lo_hi if lo_hi else (None, None)
        out.append(row)
    return out


def backtest_records(
    ts: TimeSeries,
    indicator: str,
    model_id: str,
    horizons: tuple[int, ...],
    *,
    initial_train: int,
    step: int = 1,
    window: int | None = None,
    seed: int = 0,
    suite: str | None = None,
) -> list[RunRecord]:
    """One RunRecord per horizon for one model. Skipped / failed runs are recorded, never hidden."""
    y = np.array([float(p.value) for p in ts.points])
    periods = ts.periods
    spec = registry.get_spec(model_id)
    fp = dataset_fingerprint(ts)
    max_h = max(horizons)
    base_cfg = {"initial_train": initial_train, "step": step, "window": window, "levels": list(LEVELS)}
    need = registry.min_train(model_id)
    ok_here, why_not = registry.availability(model_id)

    def make(h: int, status: str, error: str | None, **kw: Any) -> RunRecord:
        cfg = {**base_cfg, "model": {**spec.config}, "diagnostics": kw.pop("diagnostics", {})}
        ident = experiment_id({"v": CODE_VERSION, "kind": "backtest", "series": ts.series_code, "model": model_id,
                               "mcfg": spec.config, "seed": seed, "h": h, "icfg": base_cfg, "fp": fp,
                               "ofp": kw.get("origins_fingerprint")})  # fmt: skip
        return RunRecord(ident, "backtest", indicator, ts.series_code, model_id, spec.name, spec.cls.version, cfg,
                         seed, h, status, error, suite, ts.snapshot_policy, fp, kw.get("origins_fingerprint"),
                         kw.get("training_start"), kw.get("training_cutoff", periods[min(initial_train, len(periods)) - 1]),
                         kw.get("n_origins", 0), kw.get("runtime", 0.0), kw.get("rows", []), kw.get("metrics", {}),
                         kw.get("rankable", False))  # fmt: skip

    if not ok_here:
        return [make(h, "skipped", f"unavailable: {why_not}") for h in horizons]
    if initial_train < MIN_INITIAL_TRAIN:
        return [
            make(
                h,
                "skipped",
                f"initial training window {initial_train} < {MIN_INITIAL_TRAIN} months (one seasonal cycle)",
            )
            for h in horizons
        ]
    if need > initial_train:
        return [
            make(
                h,
                "skipped",
                f"{model_id} needs >= {need} training observations; suite starts at {initial_train}",
            )
            for h in horizons
        ]

    res: BacktestResult = run_backtest(lambda: registry.build(model_id, seed), y, periods, max_h=max_h,
                                       initial_train=initial_train, step=step, window=window)  # fmt: skip
    if res.unavailable:
        return [make(h, "skipped", f"unavailable: {res.unavailable}") for h in horizons]
    records = []
    diag = {
        "failures": res.failures[:20],
        "n_failures": len(res.failures),
        "warnings": sorted({w for o in res.origins for w in o.diagnostics.get("warnings", [])})[:10],
        "non_converged_origins": sum(1 for o in res.origins if o.diagnostics.get("converged") is False),
    }
    for h in horizons:
        ev = evaluate_horizon(res, y, periods, h)
        if ev.status != "ok":
            records.append(
                make(
                    h,
                    "skipped",
                    ev.reason,
                    n_origins=ev.n_origins,
                    runtime=res.runtime_seconds,
                    diagnostics=diag,
                )
            )
            continue
        ofp = origins_fingerprint([r.origin_idx for r in ev.rows])
        records.append(
            make(h, "completed", ev.reason, origins_fingerprint=ofp, training_start=res.origins[0].train_start,
                 training_cutoff=ev.rows[-1].origin_date, n_origins=ev.n_origins, runtime=res.runtime_seconds,
                 rows=_rows(ev, y), metrics=_metric_dict(ev), rankable=ev.rankable, diagnostics=diag)
        )  # fmt: skip
    return records


def forecast_record(
    ts: TimeSeries, indicator: str, model_id: str, horizon: int, *, initial_train: int = 18, seed: int = 0
) -> RunRecord:
    """A genuine future forecast from the full stored history. Refuses unevaluable horizons."""
    y = np.array([float(p.value) for p in ts.points])
    spec = registry.get_spec(model_id)
    ok, why = registry.availability(model_id)
    if not ok:
        raise ValueError(f"{model_id} unavailable: {why}")
    need = registry.min_train(model_id)
    if len(y) < need:
        raise ValueError(f"{model_id} needs {need} observations, series has {len(y)}")
    limit = max_evaluable_horizon(len(y), max(initial_train, need))
    if horizon > limit:
        raise ValueError(
            f"horizon {horizon} cannot be validated on {len(y)} observations (largest evaluable horizon for "
            f"{model_id} is {limit}); a generated forecast is not a validated forecast"
        )
    model: ForecastModel = registry.build(model_id, seed)
    res = model.fit(y, ts.periods).predict(horizon)
    res.validate(horizon)
    targets = future_periods(ts.periods[-1], horizon)
    fp = dataset_fingerprint(ts)
    rows = []
    for k, t in enumerate(targets):
        row: dict[str, Any] = {"origin_date": ts.periods[-1], "target_date": t, "step": k + 1,
                               "point": float(res.point[k]), "actual": None,
                               "interval_method": res.interval_method if res.intervals else None}  # fmt: skip
        for lv in LEVELS:
            iv = res.intervals.get(lv)
            row[f"lower_{lv}"], row[f"upper_{lv}"] = (
                (float(iv[0][k]), float(iv[1][k])) if iv else (None, None)
            )
        rows.append(row)
    ident = experiment_id({"v": CODE_VERSION, "kind": "forecast", "series": ts.series_code, "model": model_id,
                           "mcfg": spec.config, "seed": seed, "h": horizon, "fp": fp})  # fmt: skip
    return RunRecord(ident, "forecast", indicator, ts.series_code, model_id, spec.name, spec.cls.version,
                     {"model": spec.config, "diagnostics": model.diagnostics}, seed, horizon, "completed", None, None,
                     ts.snapshot_policy, fp, None, ts.periods[0], ts.periods[-1], 1, 0.0, rows, {}, False)  # fmt: skip


# Predefined, reproducible research suites. All models of a suite share initial_train, so they are
# evaluated on identical forecast origins (a precondition for a fair comparison).
SUITES: dict[str, dict[str, Any]] = {
    "core": {
        "models": ["naive", "snaive", "drift", "ets", "arima"],
        "initial_train": 18,
        "horizons": (1, 3, 6, 12),
    },
    "ml": {
        "models": ["naive", "snaive", "ets", "arima", "xgboost", "chronos2", "timesfm25"],
        "initial_train": 31,
        "horizons": (1, 3, 6, 12),
    },
    "seasonal": {"models": ["naive", "snaive", "ets", "sarima"], "initial_train": 36, "horizons": (1, 3)},
}
FUTURE_MODELS = ["naive", "drift", "ets", "arima"]
FUTURE_HORIZON = 6


def suite_records(ts: TimeSeries, indicator: str, name: str, seed: int = 0) -> list[RunRecord]:
    cfg = SUITES[name]
    out: list[RunRecord] = []
    for mid in cfg["models"]:
        out += backtest_records(ts, indicator, mid, tuple(cfg["horizons"]), initial_train=cfg["initial_train"],
                                seed=seed, suite=name)  # fmt: skip
    return out


__all__ = [
    "FUTURE_HORIZON",
    "FUTURE_MODELS",
    "SUITES",
    "suite_records",
    "DEFAULT_HORIZONS",
    "INDICATORS",
    "RunRecord",
    "backtest_records",
    "dataset_fingerprint",
    "forecast_record",
    "load_indicator",
    "max_evaluable_horizon",
    "origin_indices",
]
