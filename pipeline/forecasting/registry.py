"""Model registry: ids, default configurations, plain-language descriptions, availability."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pipeline.forecasting.baselines import Drift, Naive, SeasonalNaive
from pipeline.forecasting.foundation import Chronos2, TimesFM25
from pipeline.forecasting.interfaces import ForecastModel
from pipeline.forecasting.ml import XGBoostForecaster
from pipeline.forecasting.statistical import ARIMA, ETS, SARIMA


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    family: str
    cls: type[ForecastModel]
    config: dict[str, Any]
    explanation: str


SPECS: dict[str, ModelSpec] = {
    s.id: s
    for s in (
        ModelSpec(
            "naive",
            "Naive",
            "baseline",
            Naive,
            {},
            "Assumes every future month will equal the latest observed value.",
        ),
        ModelSpec(
            "snaive",
            "Seasonal naive",
            "baseline",
            SeasonalNaive,
            {},
            "Uses the value from the same month one year earlier.",
        ),
        ModelSpec(
            "drift",
            "Drift",
            "baseline",
            Drift,
            {},
            "Extends the straight line between the first and last observation.",
        ),
        ModelSpec(
            "ets",
            "ETS (damped trend)",
            "statistical",
            ETS,
            {"damped": True},
            "Exponential smoothing: recent months weigh more, with a trend that fades over time.",
        ),
        ModelSpec(
            "arima",
            "ARIMA(1,1,0)",
            "statistical",
            ARIMA,
            {"order": (1, 1, 0)},
            "Models month-to-month changes using the previous change (no yearly pattern).",
        ),
        ModelSpec(
            "sarima",
            "SARIMA(1,1,0)(0,1,0)12",
            "statistical",
            SARIMA,
            {"order": (1, 1, 0), "seasonal_order": (0, 1, 0, 12)},
            "Studies trends and recurring yearly patterns in the past data.",
        ),
        ModelSpec(
            "xgboost",
            "XGBoost (lagged changes)",
            "machine_learning",
            XGBoostForecaster,
            {"n_estimators": 100, "max_depth": 2, "learning_rate": 0.05, "min_rows": 24},
            "Learns patterns from previous month-to-month changes with gradient-boosted trees.",
        ),
        ModelSpec(
            "chronos2",
            "Chronos-2",
            "foundation",
            Chronos2,
            {},
            "A pretrained time-series foundation model (needs a large download; not enabled).",
        ),
        ModelSpec(
            "timesfm25",
            "TimesFM 2.5",
            "foundation",
            TimesFM25,
            {},
            "A pretrained time-series foundation model (needs a large download; not enabled).",
        ),
    )
}


def get_spec(model_id: str) -> ModelSpec:
    try:
        return SPECS[model_id]
    except KeyError:
        raise ValueError(f"unknown model {model_id!r}; choose from {', '.join(SPECS)}") from None


def build(model_id: str, seed: int = 0, **overrides: Any) -> ForecastModel:
    spec = get_spec(model_id)
    return spec.cls(seed=seed, **{**spec.config, **overrides})


def min_train(model_id: str, **overrides: Any) -> int:
    spec = get_spec(model_id)
    return spec.cls.min_train(**{**spec.config, **overrides})


def availability(model_id: str) -> tuple[bool, str | None]:
    """(runnable here?, reason if not)."""
    cls = get_spec(model_id).cls
    fn = getattr(cls, "availability", None)
    return fn() if fn else (True, None)
