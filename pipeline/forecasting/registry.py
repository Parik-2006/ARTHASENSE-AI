"""Model registry: ids, default configurations, plain-language descriptions, availability."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pipeline.forecasting.baselines import Drift, Naive, SeasonalNaive
from pipeline.forecasting.foundation import Chronos2, TimesFM25
from pipeline.forecasting.interfaces import ForecastModel
from pipeline.forecasting.ml import RandomForestForecaster, XGBoostForecaster
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
            "Assumes every future period will equal the latest observed value.",
        ),
        ModelSpec(
            "snaive",
            "Seasonal naive",
            "baseline",
            SeasonalNaive,
            {},
            "Uses the value from the same month (or quarter) one year earlier.",
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
            "ETS",
            "statistical",
            ETS,
            {"select": "aicc"},
            "Exponential smoothing: recent periods weigh more; trend and seasonal form chosen by AICc on the training data.",
        ),
        ModelSpec(
            "arima",
            "ARIMA",
            "statistical",
            ARIMA,
            {"select": "aicc"},
            "Models period-to-period changes from their own recent past; order chosen by AICc on the training data.",
        ),
        ModelSpec(
            "sarima",
            "SARIMA",
            "statistical",
            SARIMA,
            {"select": "aicc", "m": 12},
            "ARIMA with a yearly seasonal part; orders chosen by AICc on the training data.",
        ),
        ModelSpec(
            "rf",
            "Random Forest",
            "machine_learning",
            RandomForestForecaster,
            {
                "features": "v4",
                "strategy": "direct",
                "n_estimators": 300,
                "min_samples_leaf": 3,
                "max_features": 0.5,
                "min_rows": 24,
            },
            "Averages many decision trees trained on lagged period-to-period changes and the time of year.",
        ),
        ModelSpec(
            "xgboost",
            "XGBoost",
            "machine_learning",
            XGBoostForecaster,
            {
                "features": "v4",
                "strategy": "direct",
                "n_estimators": 100,
                "max_depth": 2,
                "learning_rate": 0.05,
                "min_rows": 24,
            },
            "Gradient-boosted trees trained on lagged period-to-period changes and the time of year.",
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


# The eight algorithms ArthaSense evaluates for every indicator (foundation models stay optional, not installed).
CORE_MODELS: tuple[str, ...] = ("naive", "snaive", "drift", "ets", "arima", "sarima", "rf", "xgboost")
SEASONAL_MODELS = {"snaive", "ets", "sarima"}


# Configurations of the V1-V3 runs (fixed orders, V1 features). The suites that produced the stored 2026-11-20/23
# runs keep using them, so those runs stay reproducible bit for bit (tools/forecast_reproduce.py) and their
# experiment ids do not change. Models without an entry used the same configuration as today.
LEGACY_CONFIGS: dict[str, dict[str, Any]] = {
    "ets": {"damped": True},
    "arima": {"order": (1, 1, 0)},
    "sarima": {"order": (1, 1, 0), "seasonal_order": (0, 1, 0, 12)},
    "xgboost": {"n_estimators": 100, "max_depth": 2, "learning_rate": 0.05, "min_rows": 24},
}
CONFIG_SETS = ("v3", "v4")


def frequency_config(model_id: str, freq: str) -> dict[str, Any]:
    """Configuration changes a model needs for a data frequency. Monthly data use the registry config unchanged
    (so stored monthly experiment ids stay stable); quarterly data set the season length m = 4 and, for the tree
    models, the quarterly lag set."""
    if freq == "M":
        return {}
    if freq != "Q":
        raise ValueError(f"unsupported frequency {freq!r}")
    if model_id in SEASONAL_MODELS:
        return {"m": 4}
    if model_id in ("rf", "xgboost"):
        return {"freq": "Q"}
    return {}


def effective_config(
    model_id: str, freq: str = "M", config_set: str = "v4", **overrides: Any
) -> dict[str, Any]:
    if config_set not in CONFIG_SETS:
        raise ValueError(f"unknown config set {config_set!r}")
    base = (
        LEGACY_CONFIGS.get(model_id, get_spec(model_id).config)
        if config_set == "v3"
        else get_spec(model_id).config
    )
    return {**base, **frequency_config(model_id, freq), **overrides}


def library_versions() -> dict[str, str]:
    """Versions of the numerical libraries in this process (recorded with every run, outside the experiment id)."""
    import importlib.metadata as md
    import platform

    out = {"python": platform.python_version()}
    for pkg in ("numpy", "pandas", "scipy", "statsmodels", "xgboost", "scikit-learn"):
        try:
            out[pkg] = md.version(pkg)
        except md.PackageNotFoundError:
            out[pkg] = "not installed"
    return out


def get_spec(model_id: str) -> ModelSpec:
    try:
        return SPECS[model_id]
    except KeyError:
        raise ValueError(f"unknown model {model_id!r}; choose from {', '.join(SPECS)}") from None


def build(
    model_id: str, seed: int = 0, freq: str = "M", config_set: str = "v4", **overrides: Any
) -> ForecastModel:
    spec = get_spec(model_id)
    return spec.cls(seed=seed, **effective_config(model_id, freq, config_set, **overrides))


def min_train(model_id: str, freq: str = "M", config_set: str = "v4", **overrides: Any) -> int:
    spec = get_spec(model_id)
    return spec.cls.min_train(**effective_config(model_id, freq, config_set, **overrides))


def availability(model_id: str) -> tuple[bool, str | None]:
    """(runnable here?, reason if not)."""
    cls = get_spec(model_id).cls
    fn = getattr(cls, "availability", None)
    return fn() if fn else (True, None)
