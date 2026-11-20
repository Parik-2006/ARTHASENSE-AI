"""XGBoost forecaster with leakage-safe lag features and a recursive multi-step strategy.

Design:
  * Target = next one-month CHANGE d_t = y_t - y_{t-1} (trees cannot extrapolate levels, but they can
    model changes). The level forecast is y_T + cumulative sum of predicted changes.
  * Features for predicting d_t use ONLY changes up to d_{t-1}: lags 1,2,3,6 and the mean / std of the
    last 3 changes. Nothing is computed from the whole series, and no scaling is fitted, so there is
    no train/test contamination. Training rows are built from the training window only.
  * Multi-step: recursive. The k-th step feeds PREDICTED changes (never actuals) into the lag window.
  * Fixed seed, single thread, tiny fixed model (no search): bit-for-bit repeatable on one machine.
  * Eligibility: at least `min_rows` training rows after lag construction (default 24).
"""

from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np

from pipeline.forecasting.interfaces import ForecastError, ForecastModel, ForecastResult, validate_history

LAGS = (1, 2, 3, 6)
MAX_LAG = max(LAGS)


def make_features(d: np.ndarray, j: int) -> list[float]:
    """Features for predicting d[j], using d[:j] only."""
    hist = d[:j]
    recent = hist[-3:]
    return [*(float(hist[-lag]) for lag in LAGS), float(np.mean(recent)), float(np.std(recent))]


def build_training(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rows = [make_features(d, j) for j in range(MAX_LAG, len(d))]
    return np.array(rows, dtype=float), d[MAX_LAG:].astype(float)


class XGBoostForecaster(ForecastModel):
    id = "xgboost"
    family = "machine_learning"
    stochastic = False  # subsample=1, colsample=1, fixed seed: deterministic given the data

    @classmethod
    def min_train(cls, **config: Any) -> int:
        # n observations -> n-1 changes -> n-1-MAX_LAG training rows
        return int(config.get("min_rows", 24)) + MAX_LAG + 1

    def fit(self, y: np.ndarray, periods: list[date]) -> XGBoostForecaster:
        import xgboost as xgb

        validate_history(y, periods)
        self._y = np.asarray(y, float)
        self._d = np.diff(self._y)
        X, t = build_training(self._d)
        if len(t) < int(self._config.get("min_rows", 24)):
            raise ForecastError(f"only {len(t)} training rows after lag construction")
        # Native xgboost API (no scikit-learn dependency). Fixed seed, one thread, no sampling.
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
        self._xgb = xgb
        self._model = xgb.train(
            params, xgb.DMatrix(X, label=t), num_boost_round=int(self._config.get("n_estimators", 100))
        )
        self.diagnostics = {"train_rows": int(len(t))}
        return self

    def predict(self, h: int) -> ForecastResult:
        d = list(self._d)
        level = float(self._y[-1])
        out = []
        for _ in range(h):
            arr = np.array(d, dtype=float)
            x = np.array([make_features(arr, len(arr))], dtype=float)
            step = float(self._model.predict(self._xgb.DMatrix(x))[0])
            d.append(step)  # recursive: predicted change, never an actual future value
            level += step
            out.append(level)
        return ForecastResult(np.array(out))
