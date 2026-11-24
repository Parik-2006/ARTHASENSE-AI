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
from pipeline.forecasting.interfaces import LEVELS, SEASON_LENGTH, ForecastModel, future_periods
from pipeline.forecasting.intervals import conformal_quantile
from pipeline.research.loader import (
    GapError,
    LoaderError,
    TimeSeries,
    load_cpi_2024_linked,
    load_iip_2022_23_linked,
    load_series,
    load_wpi_2022_23_linked,
)

# What is forecast. Price and production INDEX LEVELS (never official inflation / growth rates) and quarterly
# REAL GDP LEVELS in Rs crore at constant 2022-23 prices (growth is derived from levels, never forecast directly).
INDICATORS: dict[str, str] = {
    "cpi": "mospi.cpi.2024.current.all_india.combined.general.index",
    "wpi": "mospi.wpi.2022-23.india.all_commodities.index",
    "iip": "mospi.iip.2022-23.india.general.index",
    "gdp": "mospi.nas.2022-23.india.gdp.real.level",
}
FREQUENCY: dict[str, str] = {"cpi": "M", "wpi": "M", "iip": "M", "gdp": "Q"}
HORIZONS_BY_FREQ: dict[str, tuple[int, ...]] = {"M": (1, 3, 6, 12), "Q": (1, 2, 4)}
DEFAULT_HORIZONS = HORIZONS_BY_FREQ["M"]
# At least one full seasonal cycle must be observed before anything is evaluated (12 months / 4 quarters).
MIN_INITIAL_TRAIN_BY_FREQ: dict[str, int] = dict(SEASON_LENGTH)
MIN_INITIAL_TRAIN = MIN_INITIAL_TRAIN_BY_FREQ["M"]
CODE_VERSION = "1"

# Training histories. "current" (default) = the indicator's current-base series only. "linked" = a documented
# official extension onto the CURRENT base, stored against the current series (the forecast target) with its
# provenance in `training_data`:
#   cpi: MoSPI's own Back series on base 2024=100 (Jan 2013-Dec 2024) + Current (no factor applied by ArthaSense)
#   wpi: WPI 2011-12 back-cast with OEA's linking factor (old / 1.53) before Apr 2023 + the 2022-23 series
#   iip: IIP 2011-12 General back-cast with NSO's linking factor (old / 1.3834) before Apr 2023 + the 2022-23 series
# GDP has no official back series on the 2022-23 base, so it has no linked history (docs/FORECASTS-V4-GDP.md).
HISTORIES = ("current", "linked")
LINKED_LOADERS = {"cpi": load_cpi_2024_linked, "wpi": load_wpi_2022_23_linked, "iip": load_iip_2022_23_linked}


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


def horizons_for(indicator: str) -> tuple[int, ...]:
    return HORIZONS_BY_FREQ[FREQUENCY[indicator]]


def load_indicator(
    conn: psycopg.Connection, indicator: str, *, policy: str = "latest", as_of=None
) -> TimeSeries:
    """Load the headline series; refuses series with gaps (no interpolation, ever)."""
    if indicator not in INDICATORS:
        raise ValueError(f"unknown indicator {indicator!r}; choose from {', '.join(INDICATORS)}")
    try:
        return load_series(conn, INDICATORS[indicator], policy=policy, as_of=as_of, require_complete=True)  # type: ignore[arg-type]
    except GapError as exc:
        raise LoaderError(f"{indicator}: series has missing periods, refusing to forecast ({exc})") from exc


def load_training(
    conn: psycopg.Connection, indicator: str, history: str = "current", *, as_of=None
) -> TimeSeries:
    """The training series for `indicator`: the current series, or its documented official linked history."""
    if history == "current":
        return load_indicator(conn, indicator, as_of=as_of)
    if history != "linked":
        raise ValueError(f"unknown history {history!r}; choose from {', '.join(HISTORIES)}")
    if indicator not in LINKED_LOADERS:
        raise ValueError(
            f"{indicator}: no official linked history is documented; only {', '.join(LINKED_LOADERS)}"
        )
    try:
        ts = LINKED_LOADERS[indicator](conn, as_of=as_of, require_complete=True)
    except GapError as exc:
        raise LoaderError(
            f"{indicator}: linked history has missing months, refusing to forecast ({exc})"
        ) from exc
    if not ts.components or ts.components[-1] != INDICATORS[indicator]:
        raise LoaderError(
            f"{indicator}: the linked history must end with the current series {INDICATORS[indicator]}"
        )
    return ts


def target_code(ts: TimeSeries) -> str:
    """The stored series a run forecasts: the series itself, or the last (current) component of a splice."""
    return ts.components[-1] if ts.components else ts.series_code


def training_data(ts: TimeSeries) -> dict[str, Any] | None:
    """Provenance of a composite training series (None for a single series, so their configs are unchanged)."""
    if not ts.components:
        return None
    out = {"series_code": ts.series_code, "transformation": ts.transformation, "components": list(ts.components),
           "join_period": ts.join_period.isoformat() if ts.join_period else None,
           "first_period": ts.periods[0].isoformat(), "last_period": ts.periods[-1].isoformat(),
           "n_observations": len(ts), "base_year": ts.base_year}  # fmt: skip
    if ts.link:
        out["link"] = dict(ts.link)
    return out


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
    # Stored series lookup; defaults to series_code. Differs only for a composite training history.
    target_series_code: str | None = None


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


def _model_config(model_id: str, freq: str, config_set: str) -> dict[str, Any]:
    return registry.effective_config(model_id, freq, config_set)


def _run_meta(config_set: str) -> dict[str, Any]:
    """Recorded with every V4 run, OUTSIDE the experiment id (library upgrades must not silently re-key runs)."""
    return {} if config_set == "v3" else {"config_set": config_set, "libraries": registry.library_versions()}


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
    config_set: str = "v3",
    overrides: dict[str, Any] | None = None,
) -> list[RunRecord]:
    """One RunRecord per horizon for one model. Skipped / failed runs are recorded, never hidden.

    `config_set='v3'` reproduces the V1-V3 runs exactly; 'v4' uses the registry's current configuration.
    `overrides` (research only, e.g. a multi-step strategy) change the model configuration and therefore the id.
    """
    y = np.array([float(p.value) for p in ts.points])
    periods = ts.periods
    freq = ts.freq
    spec = registry.get_spec(model_id)
    mcfg = {**_model_config(model_id, freq, config_set), **(overrides or {})}
    fp = dataset_fingerprint(ts)
    max_h = max(horizons)
    base_cfg = {"initial_train": initial_train, "step": step, "window": window, "levels": list(LEVELS)}
    need = spec.cls.min_train(**mcfg)
    ok_here, why_not = registry.availability(model_id)
    min_initial = MIN_INITIAL_TRAIN_BY_FREQ[freq]

    td = training_data(ts)
    meta = _run_meta(config_set)

    def make(h: int, status: str, error: str | None, **kw: Any) -> RunRecord:
        cfg = {**base_cfg, "model": dict(mcfg), "diagnostics": kw.pop("diagnostics", {}),
               **({"training_data": td} if td else {}), **({"frequency": freq} if freq != "M" else {}), **meta}  # fmt: skip
        ident = experiment_id({"v": CODE_VERSION, "kind": "backtest", "series": ts.series_code, "model": model_id,
                               "mcfg": mcfg, "seed": seed, "h": h, "icfg": base_cfg, "fp": fp,
                               "ofp": kw.get("origins_fingerprint")})  # fmt: skip
        return RunRecord(ident, "backtest", indicator, ts.series_code, model_id, spec.name, spec.cls.version, cfg,
                         seed, h, status, error, suite, ts.snapshot_policy, fp, kw.get("origins_fingerprint"),
                         kw.get("training_start"), kw.get("training_cutoff", periods[min(initial_train, len(periods)) - 1]),
                         kw.get("n_origins", 0), kw.get("runtime", 0.0), kw.get("rows", []), kw.get("metrics", {}),
                         kw.get("rankable", False), target_series_code=target_code(ts))  # fmt: skip

    unit = "months" if freq == "M" else "quarters"
    if not ok_here:
        return [make(h, "skipped", f"unavailable: {why_not}") for h in horizons]
    if initial_train < min_initial:
        return [
            make(
                h,
                "skipped",
                f"initial training window {initial_train} < {min_initial} {unit} (one seasonal cycle)",
            )
            for h in horizons
        ]
    if need > initial_train:
        # The status 'skipped' + this wording is what the API reports as "insufficient history".
        return [
            make(
                h,
                "skipped",
                f"{model_id} needs >= {need} training observations; suite starts at {initial_train}",
            )
            for h in horizons
        ]

    res: BacktestResult = run_backtest(lambda: registry.build(model_id, seed, freq, config_set, **(overrides or {})),
                                       y, periods, max_h=max_h, initial_train=initial_train, step=step, window=window)  # fmt: skip
    if res.unavailable:
        return [make(h, "skipped", f"unavailable: {res.unavailable}") for h in horizons]
    diag = {
        "failures": res.failures[:20],
        "n_failures": len(res.failures),
        "warnings": sorted({w for o in res.origins for w in o.diagnostics.get("warnings", [])})[:10],
        "non_converged_origins": sum(1 for o in res.origins if o.diagnostics.get("converged") is False),
        # origins whose AR part was explosive (|root| < 1); recorded for transparency, scores unchanged
        "explosive_ar_origins": sum(1 for o in res.origins if o.diagnostics.get("explosive_ar") is True),
    }
    labels = sorted({o.diagnostics["label"] for o in res.origins if o.diagnostics.get("label")})
    if labels and config_set != "v3":
        diag["selected_labels"] = labels[:20]  # the configuration each origin chose (AICc), for transparency
        diag["last_origin_label"] = res.origins[-1].diagnostics.get("label") if res.origins else None
    errors = [f for f in res.failures if f.get("kind") == "error"]
    if errors and config_set != "v3":
        # A model that errors at some origins would be scored on a different origin set than the others, and so
        # silently fall out of the comparison. Record it as FAILED instead (the UI says "training failed").
        n_try = len(origin_indices(len(y), initial_train, step))
        why = f"failed at {len(errors)} of {n_try} forecast origins: {errors[0]['reason'][:160]}"
        return [make(h, "failed", why, runtime=res.runtime_seconds, diagnostics=diag) for h in horizons]
    records = []
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


def _conformal_future(
    ts: TimeSeries, model_id: str, horizon: int, initial_train: int, seed: int, config_set: str
) -> tuple[dict[int, tuple[np.ndarray, np.ndarray]], dict[str, Any]]:
    """Split-conformal intervals for a model WITHOUT native intervals: for step k the interval is
    point +- q_k, q_k = the ceil((m+1)*level)-th smallest absolute error of the model's own k-step backtest
    forecasts (expanding window from `initial_train`). Every calibration error has a target that was already
    observed at the forecast origin, so nothing from the future is used. Missing levels stay missing."""
    y = np.array([float(p.value) for p in ts.points])
    res = run_backtest(lambda: registry.build(model_id, seed, ts.freq, config_set), y, ts.periods,
                       max_h=horizon, initial_train=initial_train)  # fmt: skip
    q: dict[int, list[float | None]] = {lv: [] for lv in LEVELS}
    n_cal: list[int] = []
    for k in range(1, horizon + 1):
        errs = [
            abs(float(o.point[k - 1]) - y[o.origin_idx + k - 1])
            for o in res.origins
            if o.origin_idx + k - 1 < len(y)
        ]
        n_cal.append(len(errs))
        for lv in LEVELS:
            q[lv].append(conformal_quantile(errs, lv))
    return q, {"interval_calibration": "split_conformal_backtest_errors", "calibration_errors_per_step": n_cal,
               "calibration_initial_train": initial_train}  # fmt: skip


def forecast_record(
    ts: TimeSeries,
    indicator: str,
    model_id: str,
    horizon: int,
    *,
    initial_train: int = 18,
    seed: int = 0,
    config_set: str = "v3",
) -> RunRecord:
    """A genuine future forecast from the full stored history. Refuses unevaluable horizons.

    V4 runs of models without native intervals (Random Forest, XGBoost) get split-conformal intervals from their
    own backtest errors when there are enough of them (95% needs >= 19); otherwise no interval is stored."""
    y = np.array([float(p.value) for p in ts.points])
    freq = ts.freq
    spec = registry.get_spec(model_id)
    mcfg = _model_config(model_id, freq, config_set)
    ok, why = registry.availability(model_id)
    if not ok:
        raise ValueError(f"{model_id} unavailable: {why}")
    need = spec.cls.min_train(**mcfg)
    if len(y) < need:
        raise ValueError(f"{model_id} needs {need} observations, series has {len(y)}")
    start = max(initial_train, need)
    limit = max_evaluable_horizon(len(y), start)
    if horizon > limit:
        raise ValueError(
            f"horizon {horizon} cannot be validated on {len(y)} observations (largest evaluable horizon for "
            f"{model_id} is {limit}); a generated forecast is not a validated forecast"
        )
    model: ForecastModel = registry.build(model_id, seed, freq, config_set)
    res = model.fit(y, ts.periods).predict(horizon)
    res.validate(horizon)
    targets = future_periods(ts.periods[-1], horizon, freq)
    fp = dataset_fingerprint(ts)
    intervals, method, extra = res.intervals, res.interval_method if res.intervals else None, {}
    if not res.intervals and config_set != "v3":
        qs, extra = _conformal_future(ts, model_id, horizon, start, seed, config_set)
        intervals = {}
        for lv in LEVELS:
            if all(v is not None for v in qs[lv]):
                qa = np.array(qs[lv], float)
                intervals[lv] = (res.point - qa, res.point + qa)
        method = "split_conformal_backtest" if intervals else None
    rows = []
    for k, t in enumerate(targets):
        row: dict[str, Any] = {"origin_date": ts.periods[-1], "target_date": t, "step": k + 1,
                               "point": float(res.point[k]), "actual": None, "interval_method": method}  # fmt: skip
        for lv in LEVELS:
            iv = intervals.get(lv)
            row[f"lower_{lv}"], row[f"upper_{lv}"] = (
                (float(iv[0][k]), float(iv[1][k])) if iv else (None, None)
            )
        rows.append(row)
    ident = experiment_id({"v": CODE_VERSION, "kind": "forecast", "series": ts.series_code, "model": model_id,
                           "mcfg": mcfg, "seed": seed, "h": horizon, "fp": fp,
                           **({"start": start} if config_set != "v3" else {})})  # fmt: skip
    td = training_data(ts)
    cfg = {"model": mcfg, "diagnostics": {**model.diagnostics, **extra}, **({"training_data": td} if td else {}),
           **({"frequency": freq} if freq != "M" else {}), **_run_meta(config_set)}  # fmt: skip
    if config_set != "v3":
        cfg["validation_initial_train"] = start
    return RunRecord(ident, "forecast", indicator, ts.series_code, model_id, spec.name, spec.cls.version,
                     cfg, seed, horizon, "completed", None, None,
                     ts.snapshot_policy, fp, None, ts.periods[0], ts.periods[-1], 1, 0.0, rows, {}, False,
                     target_series_code=target_code(ts))  # fmt: skip


# Predefined, reproducible research suites. All models of a suite share initial_train, so they are evaluated on
# identical forecast origins (a precondition for a fair comparison).
#   core / ml / seasonal / linked_current: the V1-V3 suites (config set v3), kept so stored runs reproduce.
#   v4_*: the eight algorithms with the V4 configuration (automatic order selection, RF, calendar features).
CORE8 = list(registry.CORE_MODELS)
SUITES: dict[str, dict[str, Any]] = {
    "core": {
        "models": ["naive", "snaive", "drift", "ets", "arima"],
        "initial_train": 18,
        "horizons": (1, 3, 6, 12),
        "freq": "M", "config_set": "v3",
    },
    "ml": {
        "models": ["naive", "snaive", "ets", "arima", "xgboost", "chronos2", "timesfm25"],
        "initial_train": 31,
        "horizons": (1, 3, 6, 12),
        "freq": "M", "config_set": "v3",
    },
    "seasonal": {"models": ["naive", "snaive", "ets", "sarima"], "initial_train": 36, "horizons": (1, 3),
                 "freq": "M", "config_set": "v3"},
    # Current monthly series only (IIP / WPI without the linked history): the eight models from 18 months; models
    # that need more history are recorded as skipped with the reason.
    "v4_current": {"models": CORE8, "initial_train": 18, "horizons": (1, 3, 6, 12), "freq": "M", "config_set": "v4"},
    # Quarterly GDP (17 quarters): two windows. 8 quarters = two full years (baselines); 12 quarters = the minimum
    # for ETS and ARIMA. Each suite is one origin set.
    "v4_q8": {"models": CORE8, "initial_train": 8, "horizons": (1, 2, 4), "freq": "Q", "config_set": "v4"},
    "v4_q12": {"models": CORE8, "initial_train": 12, "horizons": (1, 2, 4), "freq": "Q", "config_set": "v4"},
}  # fmt: skip
# Suites for a LINKED history only. The first origin is the last month before the join and the window expands from
# there, so every scored target is a genuine current-series month (no scored month comes from the older part)
# while training uses the whole official history before each origin.
LINKED_SUITES: dict[str, dict[str, Any]] = {
    "linked_current": {
        "models": ["naive", "snaive", "drift", "ets", "arima", "sarima"],
        "initial_train": "join",
        "horizons": (1, 3, 6, 12),
        "freq": "M", "config_set": "v3",
    },
    "v4_linked": {"models": CORE8, "initial_train": "join", "horizons": (1, 3, 6, 12), "freq": "M", "config_set": "v4"},
}  # fmt: skip
FUTURE_MODELS = ["naive", "drift", "ets", "arima"]  # V3 future forecasts (config set v3)
FUTURE_HORIZON = 6
# V4 future forecasts: all eight models, at the longest horizon (<= the target) that the model's own backtest
# can validate. (indicator frequency -> target horizon)
FUTURE_HORIZON_BY_FREQ = {"M": 6, "Q": 4}
# The suites whose origins validate each indicator's V4 future forecasts (current history / linked history). A model's
# future forecast is validated by the FIRST listed suite that can run it (its window >= the model's min_train).
V4_PRIMARY_SUITE: dict[tuple[str, str], tuple[str, ...]] = {
    ("cpi", "linked"): ("v4_linked",), ("wpi", "linked"): ("v4_linked",), ("iip", "linked"): ("v4_linked",),
    ("wpi", "current"): ("v4_current",), ("iip", "current"): ("v4_current",), ("gdp", "current"): ("v4_q8", "v4_q12"),
}  # fmt: skip


def suite_config(name: str) -> dict[str, Any]:
    if name in SUITES:
        return SUITES[name]
    if name in LINKED_SUITES:
        return LINKED_SUITES[name]
    raise ValueError(f"unknown suite {name!r}")


def suite_applies(ts: TimeSeries, name: str) -> bool:
    """A suite runs only on series of its frequency (monthly suites never touch quarterly GDP and vice versa)."""
    return suite_config(name).get("freq", "M") == ts.freq


def suite_initial_train(ts: TimeSeries, name: str) -> int:
    cfg = suite_config(name)
    if cfg["initial_train"] != "join":
        return int(cfg["initial_train"])
    if ts.join_period is None:
        raise ValueError(f"suite {name!r} needs a linked history (a series with a join)")
    return sum(1 for p in ts.periods if p < ts.join_period)


def suite_records(ts: TimeSeries, indicator: str, name: str, seed: int = 0) -> list[RunRecord]:
    cfg = suite_config(name)
    if not suite_applies(ts, name):
        return []
    initial_train = suite_initial_train(ts, name)
    out: list[RunRecord] = []
    for mid in cfg["models"]:
        out += backtest_records(ts, indicator, mid, tuple(cfg["horizons"]), initial_train=initial_train,
                                seed=seed, suite=name, config_set=cfg.get("config_set", "v3"))  # fmt: skip
    return out


def v4_future_records(
    ts: TimeSeries, indicator: str, history: str, seed: int = 0
) -> tuple[list[RunRecord], list[str]]:
    """V4 future forecasts for the eight models. Each is issued at the longest horizon <= the frequency's target
    horizon that its backtest can validate; a model that cannot validate even one step is refused (and reported)."""
    suites = V4_PRIMARY_SUITE.get((indicator, history))
    if not suites:
        return [], [f"no V4 suite is defined for {indicator} on the {history} history"]
    target = FUTURE_HORIZON_BY_FREQ[ts.freq]
    recs, notes = [], []
    for mid in registry.CORE_MODELS:
        need = registry.min_train(mid, ts.freq, "v4")
        runnable = [n for n in suites if suite_initial_train(ts, n) >= need]
        if not runnable:
            notes.append(f"{mid}: refused, insufficient history (needs {need} observations to train; no V4 suite "
                         f"window is that long on {len(ts)} observations)")  # fmt: skip
            continue
        start = suite_initial_train(ts, runnable[0])
        # the horizon must be one the suite actually evaluates, with >= MIN_ORIGINS_EVALUATE origins
        ok_h = [
            h
            for h in suite_config(runnable[0])["horizons"]
            if h <= min(target, max_evaluable_horizon(len(ts), start))
        ]
        h = max(ok_h) if ok_h else 0
        if h < 1:
            notes.append(f"{mid}: refused, insufficient history (needs {need} observations to train plus "
                         f"{MIN_ORIGINS_EVALUATE} validated origins; series has {len(ts)})")  # fmt: skip
            continue
        try:
            recs.append(
                forecast_record(ts, indicator, mid, h, initial_train=start, seed=seed, config_set="v4")
            )
        except Exception as exc:  # a fit failure is reported, never replaced by another model's numbers
            notes.append(f"{mid}: refused ({type(exc).__name__}: {str(exc)[:160]})")
    return recs, notes


__all__ = [
    "CORE8",
    "FREQUENCY",
    "FUTURE_HORIZON",
    "FUTURE_HORIZON_BY_FREQ",
    "FUTURE_MODELS",
    "HISTORIES",
    "HORIZONS_BY_FREQ",
    "LINKED_SUITES",
    "SUITES",
    "V4_PRIMARY_SUITE",
    "horizons_for",
    "load_training",
    "suite_applies",
    "suite_config",
    "suite_initial_train",
    "target_code",
    "training_data",
    "suite_records",
    "v4_future_records",
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
