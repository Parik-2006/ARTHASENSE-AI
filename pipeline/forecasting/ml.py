"""Tree-based forecasters (XGBoost, Random Forest) with leakage-safe lag features.

Design (shared by both models):
  * Target = CHANGES, not levels: trees cannot extrapolate a trending index, but they can model changes.
    d_t = y_t - y_{t-1}; the level forecast is y_T plus predicted changes.
  * Features for a target that starts at change index j use ONLY d[:j] (changes already observed): lags of d
    (monthly 1,2,3,6,12; quarterly 1,2,3,4), the mean and standard deviation of the last 3 changes, and the
    position of the target period in the year as sin/cos (a calendar feature that is known in advance, never
    a value). Nothing is computed from the whole series and no scaler is fitted, so there is no train/test
    contamination. Training rows are built from the training window only. Splits are never random.
  * Two multi-step strategies (config `strategy`):
      - recursive: one model predicts the next change; step k feeds the PREDICTED changes 1..k-1 (never
        actuals) back into the lag window.
      - direct: one model per step k predicts the cumulative k-step change y_{j+k-1} - y_{j-1} from the
        features at j. No predicted value is ever fed back.
    Both are evaluated in the `ml_strategy` research suite; the production configuration in the registry
    records the strategy that was chosen (docs/FORECASTS-V4-MODELS.md).
  * Fixed hyperparameters chosen BEFORE any backtest (small trees, many rows per leaf), fixed seed, single
    thread: bit-for-bit repeatable on one machine. Nothing is tuned on backtest output.
  * Eligibility: at least `min_rows` training rows after lag construction (default 24).
  * No native intervals: the backtest engine attaches online-conformal intervals built only from errors
    already observable at each origin; future forecasts get split-conformal intervals from the model's own
    backtest errors (pipeline/forecasting/experiments.py). Without enough errors there is no interval.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any

import numpy as np

from pipeline.forecasting.interfaces import (
    ForecastError,
    ForecastModel,
    ForecastResult,
    future_periods,
    season_position,
    validate_history,
)

LAGS = {"M": (1, 2, 3, 6, 12), "Q": (1, 2, 3, 4)}
SEASON = {"M": 12, "Q": 4}
# Kept for the V1-V3 XGBoost configuration (lags 1,2,3,6, no calendar feature), used when `features='v1'`.
LAGS_V1 = (1, 2, 3, 6)
MAX_LAG = max(LAGS_V1)


def make_features(
    d: np.ndarray, j: int, lags: tuple[int, ...] = LAGS_V1, season: tuple[int, int] | None = None
) -> list[float]:
    """Features for a target starting at change index j, using d[:j] only. `season` = (position, cycle)."""
    hist = d[:j]
    recent = hist[-3:]
    row = [*(float(hist[-lag]) for lag in lags), float(np.mean(recent)), float(np.std(recent))]
    if season is not None:
        pos, cycle = season
        row += [math.sin(2 * math.pi * pos / cycle), math.cos(2 * math.pi * pos / cycle)]
    return row


def build_training(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """V1 helper (lags 1,2,3,6, one-step target). Kept for the stored XGBoost runs and their tests."""
    rows = [make_features(d, j) for j in range(MAX_LAG, len(d))]
    return np.array(rows, dtype=float), d[MAX_LAG:].astype(float)


class _TreeForecaster(ForecastModel):
    family = "machine_learning"
    stochastic = False  # fixed seed; deterministic given the data
    name = "tree"

    @classmethod
    def _lags(cls, config: dict[str, Any], freq: str = "M") -> tuple[int, ...]:
        return LAGS_V1 if config.get("features", "v1") == "v1" else LAGS[freq]

    @classmethod
    def min_train(cls, **config: Any) -> int:
        # n observations -> n-1 changes -> n-1-max_lag training rows (one-step); the frequency is known only at
        # fit time, so this uses the monthly lags (the larger set) unless `freq` is configured
        lags = cls._lags(config, config.get("freq", "M"))
        return int(config.get("min_rows", 24)) + max(lags) + 1

    # -- model-specific -------------------------------------------------------------------------------
    def _train(self, X: np.ndarray, t: np.ndarray) -> Any: ...

    def _predict_one(self, model: Any, x: np.ndarray) -> float: ...

    # -- shared ---------------------------------------------------------------------------------------
    def fit(self, y: np.ndarray, periods: list[date]) -> _TreeForecaster:
        self._freq = validate_history(y, periods)
        self._y = np.asarray(y, float)
        self._d = np.diff(self._y)
        self._periods = list(periods)
        self._lag = self._lags(self._config, self._freq)
        self._calendar = self._config.get("features", "v1") != "v1"
        self._min_rows = int(self._config.get("min_rows", 24))
        self._strategy = self._config.get("strategy", "recursive")
        if self._strategy not in ("recursive", "direct"):
            raise ValueError(f"unknown strategy {self._strategy!r}")
        n_rows = len(self._d) - max(self._lag)
        if n_rows < self._min_rows:
            raise ForecastError(
                f"only {max(0, n_rows)} training rows after lag construction (need {self._min_rows})"
            )
        self._models: dict[int, Any] = {}
        if self._strategy == "recursive":
            self._models[1] = self._fit_step(1)
        self.diagnostics = {"label": self.label(), "strategy": self._strategy, "lags": list(self._lag),
                            "calendar_features": self._calendar, "train_rows": int(n_rows)}  # fmt: skip
        return self

    def label(self) -> str:
        return f"{self.name} ({self._strategy})"

    def _season(self, change_idx: int) -> tuple[int, int] | None:
        """Season position of the period whose change is d[change_idx] (= period index change_idx + 1)."""
        if not self._calendar:
            return None
        k = change_idx + 1
        p = (
            self._periods[k]
            if k < len(self._periods)
            else future_periods(self._periods[-1], k - len(self._periods) + 1, self._freq)[-1]
        )
        return season_position(p, self._freq), SEASON[self._freq]

    def _fit_step(self, k: int) -> Any:
        d, L = self._d, max(self._lag)
        rows, targets = [], []
        for j in range(L, len(d) - k + 1):  # the k-step target d[j..j+k-1] must be inside the training window
            rows.append(make_features(d, j, self._lag, self._season(j + k - 1)))
            targets.append(float(np.sum(d[j : j + k])))
        if len(rows) < self._min_rows:
            raise ForecastError(f"direct step {k}: only {len(rows)} training rows (need {self._min_rows})")
        return self._train(np.array(rows, float), np.array(targets, float))

    def predict(self, h: int) -> ForecastResult:
        level0 = float(self._y[-1])
        n = len(self._d)
        out = []
        if self._strategy == "recursive":
            d = list(self._d)
            level = level0
            for k in range(h):
                arr = np.array(d, float)
                step = self._predict_one(
                    self._models[1],
                    np.array(make_features(arr, len(arr), self._lag, self._season(n + k)), float),
                )
                d.append(step)  # recursive: a predicted change, never an actual future value
                level += step
                out.append(level)
        else:
            for k in range(1, h + 1):
                if k not in self._models:
                    self._models[k] = self._fit_step(k)
                x = np.array(make_features(self._d, n, self._lag, self._season(n + k - 1)), float)
                out.append(level0 + self._predict_one(self._models[k], x))
        return ForecastResult(np.array(out))


class XGBoostForecaster(_TreeForecaster):
    """Gradient-boosted trees (native xgboost API, no scikit-learn dependency)."""

    id = "xgboost"
    name = "XGBoost"

    def _train(self, X: np.ndarray, t: np.ndarray) -> Any:
        import xgboost as xgb

        self._xgb = xgb
        params = {
            "objective": "reg:squarederror",
            "max_depth": int(self._config.get("max_depth", 2)),
            "eta": float(self._config.get("learning_rate", 0.05)),
            "subsample": 1.0,
            "colsample_bytree": 1.0,
            "seed": self.seed,
            "nthread": 1,
            "tree_method": "hist",
            "verbosity": 0,
        }
        return xgb.train(
            params, xgb.DMatrix(X, label=t), num_boost_round=int(self._config.get("n_estimators", 100))
        )

    def _predict_one(self, model: Any, x: np.ndarray) -> float:
        return float(model.predict(self._xgb.DMatrix(x.reshape(1, -1)))[0])


class RandomForestForecaster(_TreeForecaster):
    """Random forest (scikit-learn RandomForestRegressor): bootstrap-aggregated trees with feature subsampling.
    Deterministic for a fixed seed (random_state) and a single job."""

    id = "rf"
    name = "Random Forest"

    def _train(self, X: np.ndarray, t: np.ndarray) -> Any:
        from sklearn.ensemble import RandomForestRegressor

        model = RandomForestRegressor(
            n_estimators=int(self._config.get("n_estimators", 300)),
            max_depth=self._config.get("max_depth"),
            min_samples_leaf=int(self._config.get("min_samples_leaf", 3)),
            max_features=self._config.get("max_features", 0.5),
            bootstrap=True,
            random_state=self.seed,
            n_jobs=1,
        )
        return model.fit(X, t)

    def _predict_one(self, model: Any, x: np.ndarray) -> float:
        return float(model.predict(x.reshape(1, -1))[0])
