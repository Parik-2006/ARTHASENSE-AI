"""Read-only forecasting endpoints. They serve STORED experiment results only.

Nothing here trains a model or calls an external service; experiments are produced offline by
`python -m pipeline.forecasting.cli` and stored in forecast_runs / forecasts / scores.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime
from typing import Annotated, Any, Literal

import psycopg
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import get_settings
from app.db import connect

router = APIRouter(prefix="/api/v1/forecasting", tags=["forecasting"])

Indicator = Literal["cpi", "wpi", "iip"]
# Must match pipeline/forecasting/experiments.py (a test enforces this). Index LEVELS only.
INDICATOR_SERIES: dict[str, str] = {
    "cpi": "mospi.cpi.2024.current.all_india.combined.general.index",
    "wpi": "mospi.wpi.2022-23.india.all_commodities.index",
    "iip": "mospi.iip.2022-23.india.general.index",
}
SERIES_TO_INDICATOR = {v: k for k, v in INDICATOR_SERIES.items()}
# Official linked training history (must match pipeline/forecasting/experiments.py LINKED_LOADERS): CPI is trained on
# MoSPI's Back series on base 2024=100 (Jan 2013-Dec 2024, linking factor per FAQs on CPI 2024, Annexure V, Q36-38)
# followed by the Current series. Index levels only; runs are stored against the Current series.
LINKED_HISTORY: dict[str, tuple[str, ...]] = {
    "cpi": ("mospi.cpi.2024.back.all_india.combined.general.index", INDICATOR_SERIES["cpi"]),
}
LINKED_NOTE = {
    "cpi": "MoSPI publishes the Back series on the same 2024 = 100 base, calculated with a documented linking factor, so it extends the Current series without overlap. Before 2025 it follows the 2012 basket's price movements."
}
HORIZONS = (1, 3, 6, 12)
MIN_ORIGINS_EVALUATE = 5
MIN_ORIGINS_RANK = 12
DEFAULT_INITIAL_TRAIN = 18
BASELINE_MODEL = "naive"
MAX_PAGE = 200

# Must match pipeline/forecasting/registry.py (a test enforces this).
MODEL_CATALOGUE: dict[str, dict[str, Any]] = {
    "naive": {
        "name": "Naive",
        "family": "baseline",
        "min_train": 1,
        "explanation": "Assumes every future month will equal the latest observed value.",
    },
    "snaive": {
        "name": "Seasonal naive",
        "family": "baseline",
        "min_train": 12,
        "explanation": "Uses the value from the same month one year earlier.",
    },
    "drift": {
        "name": "Drift",
        "family": "baseline",
        "min_train": 4,
        "explanation": "Extends the straight line between the first and last observation.",
    },
    "ets": {
        "name": "ETS (damped trend)",
        "family": "statistical",
        "min_train": 12,
        "explanation": "Exponential smoothing: recent months weigh more, with a trend that fades over time.",
    },
    "arima": {
        "name": "ARIMA(1,1,0)",
        "family": "statistical",
        "min_train": 12,
        "explanation": "Models month-to-month changes using the previous change (no yearly pattern).",
    },
    "sarima": {
        "name": "SARIMA(1,1,0)(0,1,0)12",
        "family": "statistical",
        "min_train": 36,
        "explanation": "Studies trends and recurring yearly patterns in the past data.",
    },
    "xgboost": {
        "name": "XGBoost (lagged changes)",
        "family": "machine_learning",
        "min_train": 31,
        "explanation": "Learns patterns from previous month-to-month changes with gradient-boosted trees.",
    },
    "chronos2": {
        "name": "Chronos-2",
        "family": "foundation",
        "min_train": 12,
        "explanation": "A pretrained time-series foundation model (needs a large download; not enabled).",
    },
    "timesfm25": {
        "name": "TimesFM 2.5",
        "family": "foundation",
        "min_train": 12,
        "explanation": "A pretrained time-series foundation model (needs a large download; not enabled).",
    },
}
ModelId = Literal["naive", "snaive", "drift", "ets", "arima", "sarima", "xgboost", "chronos2", "timesfm25"]

DISCLAIMER = (
    "Forecasts are statistical estimates of index levels, not official statistics and not guaranteed "
    "outcomes. Accuracy figures come from rolling-origin backtests on a short history."
)


@contextmanager
def _db() -> Iterator[psycopg.Connection]:
    url = get_settings().database_url
    if not url:
        raise HTTPException(status_code=503, detail="database is not configured")
    try:
        with connect(url, get_settings().api_connect_timeout_s) as conn:
            yield conn
    except (psycopg.errors.UndefinedColumn, psycopg.errors.UndefinedTable):
        raise HTTPException(
            status_code=503, detail="forecasting tables not migrated: run python -m db.migrate"
        ) from None
    except psycopg.Error:
        raise HTTPException(status_code=503, detail="database unavailable") from None


def _num(v: Any) -> float | None:
    return None if v is None else float(v)


# ---- models -------------------------------------------------------------------------------------


class ModelInfo(BaseModel):
    id: str
    name: str
    family: str
    explanation: str
    min_train: int
    status: Literal["evaluated", "not_evaluated", "unavailable"]
    unavailable_reason: str | None = None
    completed_runs: int
    is_baseline: bool


@router.get("/models", response_model=list[ModelInfo])
def list_models() -> list[ModelInfo]:
    """Catalogue of models with their real status in the stored experiments."""
    with _db() as conn:
        done = dict(conn.execute(
            "SELECT model_name, count(*) FROM forecast_runs WHERE status='completed' AND kind='backtest' GROUP BY 1"
        ).fetchall())  # fmt: skip
        reasons = dict(conn.execute(
            "SELECT DISTINCT ON (model_name) model_name, error FROM forecast_runs"
            " WHERE status='skipped' AND error LIKE 'unavailable:%%' ORDER BY model_name, id DESC"
        ).fetchall())  # fmt: skip
    out = []
    for mid, m in MODEL_CATALOGUE.items():
        n = int(done.get(mid, 0))
        status = "evaluated" if n else ("unavailable" if mid in reasons else "not_evaluated")
        out.append(ModelInfo(id=mid, completed_runs=n, status=status, unavailable_reason=reasons.get(mid),
                             is_baseline=mid == BASELINE_MODEL, **m))  # fmt: skip
    return out


# ---- series -------------------------------------------------------------------------------------


class TrainingComponent(BaseModel):
    series_code: str
    first_period: date
    last_period: date
    n_observations: int


class TrainingHistory(BaseModel):
    """The series models are trained on when it is longer than the indicator's current series (CPI only)."""

    kind: Literal["official_linked"] = "official_linked"
    n_observations: int
    first_period: date
    last_period: date
    join_period: date
    components: list[TrainingComponent]
    note: str


class SeriesInfo(BaseModel):
    indicator: str
    series_code: str
    base_year: str | None
    n_observations: int
    first_period: date | None
    last_period: date | None
    latest_value: float | None
    evaluable_horizons: list[int]
    forecast_status: Literal["no_data", "insufficient_history", "ready_not_run", "has_experiments"]
    reason: str | None = None
    completed_backtests: int
    future_forecasts: int
    last_experiment_at: datetime | None
    training_history: TrainingHistory | None = None


def _evaluable(n: int, initial_train: int = DEFAULT_INITIAL_TRAIN) -> list[int]:
    return [h for h in HORIZONS if n - initial_train - h + 1 >= MIN_ORIGINS_EVALUATE]


def _months(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + b.month - a.month


def _linked_history(conn: psycopg.Connection, indicator: str) -> TrainingHistory | None:
    """The official linked history, only when every component is stored, gap-free and the parts join exactly."""
    codes = LINKED_HISTORY.get(indicator)
    if not codes:
        return None
    parts: list[TrainingComponent] = []
    for code in codes:
        n, first, last = conn.execute(
            "SELECT count(DISTINCT o.period_date), min(o.period_date), max(o.period_date)"
            " FROM observations o JOIN series s ON s.id=o.series_id WHERE s.code=%s",
            (code,),
        ).fetchone()
        if not n or _months(first, last) + 1 != n:
            return None  # missing component or a gap: no linked history is claimed
        parts.append(
            TrainingComponent(series_code=code, first_period=first, last_period=last, n_observations=n)
        )
    if any(_months(a.last_period, b.first_period) != 1 for a, b in zip(parts, parts[1:], strict=False)):
        return None  # overlap or hole at a join
    return TrainingHistory(n_observations=sum(p.n_observations for p in parts), first_period=parts[0].first_period,
                           last_period=parts[-1].last_period, join_period=parts[-1].first_period, components=parts,
                           note=LINKED_NOTE[indicator])  # fmt: skip


@router.get("/series", response_model=list[SeriesInfo])
def list_series() -> list[SeriesInfo]:
    out = []
    with _db() as conn:
        for ind, code in INDICATOR_SERIES.items():
            meta = conn.execute("SELECT id, base_year FROM series WHERE code=%s", (code,)).fetchone()
            n, first, last = 0, None, None
            latest = None
            if meta:
                n, first, last = conn.execute(
                    "SELECT count(DISTINCT period_date), min(period_date), max(period_date) FROM observations WHERE series_id=%s",
                    (meta[0],),
                ).fetchone()
                latest_row = conn.execute(
                    "SELECT o.value FROM observations o JOIN releases r ON r.id=o.release_id"
                    " WHERE o.series_id=%s ORDER BY o.period_date DESC, r.retrieved_at DESC, r.id DESC LIMIT 1",
                    (meta[0],),
                ).fetchone()
                latest = _num(latest_row[0]) if latest_row else None
            bt, fc, last_at = conn.execute(
                "SELECT count(*) FILTER (WHERE fr.kind='backtest' AND fr.status='completed'),"
                " count(*) FILTER (WHERE fr.kind='forecast' AND fr.status='completed'), max(fr.created_at)"
                " FROM forecast_runs fr JOIN series s ON s.id=fr.series_id WHERE s.code=%s",
                (code,),
            ).fetchone()
            linked = _linked_history(conn, ind)
            ev = _evaluable(linked.n_observations if linked else n)
            if n == 0:
                status, reason = "no_data", "No observations stored."
            elif not ev:
                status = "insufficient_history"
                reason = (f"{n} monthly observations: not enough to evaluate any horizon "
                          f"(needs {DEFAULT_INITIAL_TRAIN} training months plus at least {MIN_ORIGINS_EVALUATE} backtest origins).")  # fmt: skip
            elif bt or fc:
                status, reason = "has_experiments", None
            elif linked:
                status = "ready_not_run"
                reason = (f"The official linked history ({linked.n_observations} months) is long enough to test models, "
                          "but no tested forecast is stored yet.")  # fmt: skip
            else:
                status, reason = "ready_not_run", "Data is sufficient but no experiment has been run yet."
            out.append(SeriesInfo(indicator=ind, series_code=code, base_year=meta[1] if meta else None,
                                  n_observations=n, first_period=first, last_period=last, latest_value=latest,
                                  evaluable_horizons=ev, forecast_status=status, reason=reason,
                                  completed_backtests=bt, future_forecasts=fc, last_experiment_at=last_at,
                                  training_history=linked))  # fmt: skip
    return out


# ---- runs ---------------------------------------------------------------------------------------


class Run(BaseModel):
    id: int
    experiment_id: str | None
    indicator: str | None
    model: str
    model_name: str
    kind: str
    status: str
    error: str | None
    horizon: int
    suite: str | None
    n_origins: int | None
    training_start: date | None
    training_cutoff: date
    dataset_fingerprint: str | None
    origins_fingerprint: str | None
    snapshot_policy: str | None
    random_seed: int | None
    runtime_seconds: float | None
    created_at: datetime
    evaluation_start: date | None = None
    evaluation_end: date | None = None
    metrics: dict[str, float] = {}


_RUN_COLS = (
    "fr.id, fr.experiment_id, s.code, fr.model_name, fr.kind, fr.status, fr.error, fr.horizon, fr.suite, fr.n_origins,"
    " fr.training_start, fr.training_cutoff, fr.dataset_fingerprint, fr.origins_fingerprint, fr.snapshot_policy,"
    " fr.random_seed, fr.runtime_seconds, fr.created_at, fr.model_version"
)


def _run(row: tuple[Any, ...], metrics: dict[str, float] | None = None, window: tuple | None = None) -> Run:
    (
        rid,
        eid,
        code,
        model,
        kind,
        status,
        error,
        horizon,
        suite,
        n_or,
        tstart,
        tcut,
        dfp,
        ofp,
        pol,
        seed,
        rt,
        created,
        _ver,
    ) = row
    return Run(id=rid, experiment_id=eid, indicator=SERIES_TO_INDICATOR.get(code), model=model,
               model_name=MODEL_CATALOGUE.get(model, {}).get("name", model), kind=kind, status=status, error=error,
               horizon=horizon, suite=suite, n_origins=n_or, training_start=tstart, training_cutoff=tcut,
               dataset_fingerprint=dfp, origins_fingerprint=ofp, snapshot_policy=pol, random_seed=seed,
               runtime_seconds=rt, created_at=created, metrics=metrics or {},
               evaluation_start=window[0] if window else None, evaluation_end=window[1] if window else None)  # fmt: skip


def _metrics_for(conn: psycopg.Connection, ids: list[int]) -> dict[int, dict[str, float]]:
    if not ids:
        return {}
    out: dict[int, dict[str, float]] = {i: {} for i in ids}
    for rid, metric, value in conn.execute(
        "SELECT run_id, metric, metric_value FROM scores WHERE run_id = ANY(%s)", (ids,)
    ):
        out[rid][metric] = float(value)
    return out


def _windows(conn: psycopg.Connection, ids: list[int]) -> dict[int, tuple[date, date]]:
    if not ids:
        return {}
    return {
        rid: (a, b)
        for rid, a, b in conn.execute(
            "SELECT run_id, min(target_date), max(target_date) FROM forecasts WHERE run_id = ANY(%s) GROUP BY run_id",
            (ids,),
        )
    }


class RunPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[Run]


@router.get("/runs", response_model=RunPage)
def list_runs(
    indicator: Indicator | None = None,
    model: ModelId | None = None,
    horizon: Annotated[int | None, Query(ge=1, le=24)] = None,
    kind: Literal["backtest", "forecast"] | None = None,
    status: Literal["completed", "failed", "skipped"] | None = None,
    suite: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RunPage:
    where, params = ["1=1"], {}
    for col, val, key in (("s.code", INDICATOR_SERIES.get(indicator) if indicator else None, "code"),
                          ("fr.model_name", model, "model"), ("fr.horizon", horizon, "h"), ("fr.kind", kind, "kind"),
                          ("fr.status", status, "status"), ("fr.suite", suite, "suite")):  # fmt: skip
        if val is not None:
            where.append(f"{col} = %({key})s")
            params[key] = val
    clause = " AND ".join(where)
    with _db() as conn:
        total = conn.execute(
            f"SELECT count(*) FROM forecast_runs fr JOIN series s ON s.id=fr.series_id WHERE {clause}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT {_RUN_COLS} FROM forecast_runs fr JOIN series s ON s.id=fr.series_id WHERE {clause}"
            " ORDER BY fr.created_at DESC, fr.id DESC LIMIT %(limit)s OFFSET %(offset)s",
            {**params, "limit": limit, "offset": offset},
        ).fetchall()
        ids = [r[0] for r in rows]
        mets, wins = _metrics_for(conn, ids), _windows(conn, ids)
    return RunPage(total=total, limit=limit, offset=offset,
                   items=[_run(r, mets.get(r[0]), wins.get(r[0])) for r in rows])  # fmt: skip


class RunDetail(Run):
    configuration: dict[str, Any]
    n_forecast_rows: int
    score_notes: dict[str, str | None] = {}
    score_samples: dict[str, int | None] = {}
    rankable: bool = False
    disclaimer: str = DISCLAIMER


@router.get("/runs/{run_id}", response_model=RunDetail)
def get_run(run_id: int) -> RunDetail:
    with _db() as conn:
        row = conn.execute(
            f"SELECT {_RUN_COLS}, fr.configuration FROM forecast_runs fr JOIN series s ON s.id=fr.series_id WHERE fr.id=%s",
            (run_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="run not found")
        mets, wins = _metrics_for(conn, [run_id]), _windows(conn, [run_id])
        n_rows = conn.execute("SELECT count(*) FROM forecasts WHERE run_id=%s", (run_id,)).fetchone()[0]
        sc = conn.execute("SELECT metric, note, n_samples FROM scores WHERE run_id=%s", (run_id,)).fetchall()
    base = _run(row[:-1], mets.get(run_id), wins.get(run_id))
    return RunDetail(**base.model_dump(), configuration=row[-1], n_forecast_rows=n_rows,
                     score_notes={m: n for m, n, _ in sc}, score_samples={m: s for m, _, s in sc},
                     rankable=bool(base.n_origins and base.n_origins >= MIN_ORIGINS_RANK))  # fmt: skip


# ---- forecasts / scores -------------------------------------------------------------------------


class ForecastRow(BaseModel):
    origin_date: date | None
    target_date: date
    step: int | None
    forecast: float
    actual: float | None
    lower_80: float | None
    upper_80: float | None
    lower_95: float | None
    upper_95: float | None
    interval_method: str | None


class ForecastPage(BaseModel):
    run_id: int
    kind: str
    indicator: str | None
    model: str
    horizon: int
    total: int
    limit: int
    offset: int
    note: str
    items: list[ForecastRow]


@router.get("/forecasts", response_model=ForecastPage)
def get_forecasts(
    run_id: Annotated[int, Query(ge=1)],
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ForecastPage:
    with _db() as conn:
        run = conn.execute(
            f"SELECT {_RUN_COLS} FROM forecast_runs fr JOIN series s ON s.id=fr.series_id WHERE fr.id=%s",
            (run_id,),
        ).fetchone()
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        total = conn.execute("SELECT count(*) FROM forecasts WHERE run_id=%s", (run_id,)).fetchone()[0]
        rows = conn.execute(
            "SELECT origin_date, target_date, step, point_forecast, actual_value, lower_80, upper_80, lower_95, upper_95,"
            " interval_method FROM forecasts WHERE run_id=%s ORDER BY target_date LIMIT %s OFFSET %s",
            (run_id, limit, offset),
        ).fetchall()
    r = _run(run)
    note = ("Genuine future forecast from the latest stored observation." if r.kind == "forecast"
            else "Historical backtest: each row is a prediction made at its origin and compared with the later actual value.")  # fmt: skip
    items = [ForecastRow(origin_date=o, target_date=t, step=s, forecast=float(p), actual=_num(a), lower_80=_num(l8),
                         upper_80=_num(u8), lower_95=_num(l95), upper_95=_num(u95), interval_method=m)
             for o, t, s, p, a, l8, u8, l95, u95, m in rows]  # fmt: skip
    return ForecastPage(run_id=run_id, kind=r.kind, indicator=r.indicator, model=r.model, horizon=r.horizon,
                        total=total, limit=limit, offset=offset, note=note, items=items)  # fmt: skip


class LatestForecast(BaseModel):
    run: Run | None
    items: list[ForecastRow]
    note: str


@router.get("/forecasts/latest", response_model=LatestForecast)
def latest_forecast(
    indicator: Indicator, model: ModelId, horizon: Annotated[int, Query(ge=1, le=24)]
) -> LatestForecast:
    """Newest stored genuine-future forecast for an indicator/model with at least `horizon` steps."""
    with _db() as conn:
        row = conn.execute(
            f"SELECT {_RUN_COLS} FROM forecast_runs fr JOIN series s ON s.id=fr.series_id"
            " WHERE s.code=%s AND fr.model_name=%s AND fr.kind='forecast' AND fr.status='completed' AND fr.horizon >= %s"
            " ORDER BY fr.created_at DESC, fr.id DESC LIMIT 1",
            (INDICATOR_SERIES[indicator], model, horizon),
        ).fetchone()
        if row is None:
            return LatestForecast(
                run=None, items=[], note="No forecast has been stored for this model and horizon."
            )
        rows = conn.execute(
            "SELECT origin_date, target_date, step, point_forecast, actual_value, lower_80, upper_80, lower_95, upper_95,"
            " interval_method FROM forecasts WHERE run_id=%s AND step <= %s ORDER BY target_date",
            (row[0], horizon),
        ).fetchall()
    items = [ForecastRow(origin_date=o, target_date=t, step=s, forecast=float(p), actual=None, lower_80=_num(l8),
                         upper_80=_num(u8), lower_95=_num(l95), upper_95=_num(u95), interval_method=m)
             for o, t, s, p, _a, l8, u8, l95, u95, m in rows]  # fmt: skip
    return LatestForecast(run=_run(row), items=items, note="Genuine future forecast. " + DISCLAIMER)


class ScoreRow(BaseModel):
    run_id: int
    model: str
    horizon: int
    metric: str
    value: float
    n_samples: int | None
    evaluation_start: date | None
    evaluation_end: date | None
    note: str | None


@router.get("/scores", response_model=list[ScoreRow])
def get_scores(
    indicator: Indicator | None = None,
    model: ModelId | None = None,
    horizon: Annotated[int | None, Query(ge=1, le=24)] = None,
    metric: Annotated[str | None, Query(max_length=30, pattern="^[a-z0-9_]+$")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ScoreRow]:
    where, params = ["fr.kind='backtest'", "fr.status='completed'"], {}
    for col, val, key in (("s.code", INDICATOR_SERIES.get(indicator) if indicator else None, "code"),
                          ("fr.model_name", model, "model"), ("fr.horizon", horizon, "h"), ("sc.metric", metric, "metric")):  # fmt: skip
        if val is not None:
            where.append(f"{col} = %({key})s")
            params[key] = val
    with _db() as conn:
        rows = conn.execute(
            "SELECT sc.run_id, fr.model_name, fr.horizon, sc.metric, sc.metric_value, sc.n_samples, sc.evaluation_start,"
            " sc.evaluation_end, sc.note FROM scores sc JOIN forecast_runs fr ON fr.id=sc.run_id"
            f" JOIN series s ON s.id=fr.series_id WHERE {' AND '.join(where)}"
            " ORDER BY fr.horizon, fr.model_name, sc.metric LIMIT %(limit)s OFFSET %(offset)s",
            {**params, "limit": limit, "offset": offset},
        ).fetchall()
    return [ScoreRow(run_id=a, model=b, horizon=c, metric=d, value=float(e), n_samples=f, evaluation_start=g,
                     evaluation_end=h, note=i) for a, b, c, d, e, f, g, h, i in rows]  # fmt: skip


# ---- comparison ---------------------------------------------------------------------------------

LOWER_IS_BETTER = ("mae", "rmse", "mase", "smape")


class ComparedModel(BaseModel):
    run_id: int
    model: str
    model_name: str
    is_baseline: bool
    n_origins: int
    runtime_seconds: float | None
    metrics: dict[str, float]
    vs_baseline_mae_pct: float | None = None


class ExcludedModel(BaseModel):
    model: str
    model_name: str
    reason: str


class ComparisonGroup(BaseModel):
    group_id: str
    indicator: str
    horizon: int
    dataset_fingerprint: str | None
    origins_fingerprint: str | None
    evaluation_start: date | None
    evaluation_end: date | None
    n_origins: int
    comparable: bool
    rankable: bool
    best: dict[str, str]
    warnings: list[str]
    models: list[ComparedModel]


class Comparison(BaseModel):
    indicator: str
    horizon: int
    baseline: str
    groups: list[ComparisonGroup]
    excluded: list[ExcludedModel]
    note: str


@router.get("/comparison", response_model=Comparison)
def comparison(indicator: Indicator, horizon: Annotated[int, Query(ge=1, le=24)]) -> Comparison:
    """Only runs on the SAME series, data snapshot, horizon AND forecast origins are put side by side."""
    code = INDICATOR_SERIES[indicator]
    with _db() as conn:
        rows = conn.execute(
            f"SELECT {_RUN_COLS} FROM forecast_runs fr JOIN series s ON s.id=fr.series_id"
            " WHERE s.code=%s AND fr.kind='backtest' AND fr.horizon=%s ORDER BY fr.created_at DESC, fr.id DESC",
            (code, horizon),
        ).fetchall()
        done = [r for r in rows if r[5] == "completed"]
        mets, wins = _metrics_for(conn, [r[0] for r in done]), _windows(conn, [r[0] for r in done])
    grouped: dict[tuple[str | None, str | None], list[tuple]] = {}
    for r in done:
        grouped.setdefault((r[12], r[13]), []).append(r)
    groups: list[ComparisonGroup] = []
    for (dfp, ofp), members in grouped.items():
        latest_by_model: dict[str, tuple] = {}
        for r in members:  # newest first: keep one run per model
            latest_by_model.setdefault(r[3], r)
        chosen = list(latest_by_model.values())
        base_mae = next((mets[r[0]].get("mae") for r in chosen if r[3] == BASELINE_MODEL), None)
        models, n_set = [], {r[9] for r in chosen}
        for r in sorted(chosen, key=lambda r: r[3]):
            m = mets.get(r[0], {})
            vs = (
                (m["mae"] / base_mae - 1) * 100
                if base_mae and "mae" in m and r[3] != BASELINE_MODEL
                else None
            )
            models.append(ComparedModel(run_id=r[0], model=r[3], model_name=MODEL_CATALOGUE.get(r[3], {}).get("name", r[3]),
                                        is_baseline=r[3] == BASELINE_MODEL, n_origins=r[9], runtime_seconds=r[16],
                                        metrics=m, vs_baseline_mae_pct=vs))  # fmt: skip
        n = max(n_set)
        comparable = len(models) >= 2
        rankable = comparable and len(n_set) == 1 and n >= MIN_ORIGINS_RANK
        warnings = []
        if len(models) < 2:
            warnings.append(
                "Only one model was evaluated on this exact data and origin set: nothing to compare."
            )
        if BASELINE_MODEL not in latest_by_model:
            warnings.append("The naive baseline was not evaluated on this origin set.")
        if n < MIN_ORIGINS_RANK:
            warnings.append(
                f"Only {n} backtest origins (< {MIN_ORIGINS_RANK}): differences are indicative, not evidence of superiority."
            )
        best: dict[str, str] = {}
        if rankable:
            for metric in LOWER_IS_BETTER:
                vals = [(m.metrics[metric], m.model) for m in models if metric in m.metrics]
                if len(vals) >= 2:
                    best[metric] = min(vals)[1]
            warnings.append("Differences between models are not tested for statistical significance.")
        w = [wins.get(r[0]) for r in chosen if wins.get(r[0])]
        groups.append(ComparisonGroup(
            group_id=f"{dfp}-{ofp}", indicator=indicator, horizon=horizon, dataset_fingerprint=dfp,
            origins_fingerprint=ofp, evaluation_start=min(a for a, _ in w) if w else None,
            evaluation_end=max(b for _, b in w) if w else None, n_origins=n, comparable=comparable,
            rankable=rankable, best=best, warnings=warnings, models=models))  # fmt: skip
    groups.sort(key=lambda g: (-len(g.models), -g.n_origins))
    excluded = []
    seen: set[str] = set()
    # Runs on a superseded data vintage (e.g. CPI's 2025 runs on the 12-month Current series, before the linked
    # history) are not reasons for excluding a model from today's comparison. When every run shares one dataset
    # fingerprint (WPI, IIP) this changes nothing.
    live_fps = {r[12] for r in done}
    for r in rows:
        if live_fps and r[12] not in live_fps:
            continue
        if r[5] != "completed" and r[3] not in seen:
            seen.add(r[3])
            excluded.append(ExcludedModel(model=r[3], model_name=MODEL_CATALOGUE.get(r[3], {}).get("name", r[3]),
                                          reason=r[6] or r[5]))  # fmt: skip
    return Comparison(
        indicator=indicator,
        horizon=horizon,
        baseline=BASELINE_MODEL,
        groups=groups[:10],
        excluded=excluded,
        note="Models are compared only when evaluated on identical data and forecast origins.",
    )
