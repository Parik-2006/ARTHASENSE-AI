"""Baseline forecasters: naive, seasonal naive, drift. Deterministic; intervals are the textbook
Gaussian formulas (Hyndman & Athanasopoulos, "Forecasting: Principles and Practice", ch. 5) with the
residual spread estimated from the TRAINING window only."""

from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np

from pipeline.forecasting.interfaces import ForecastModel, ForecastResult, validate_history
from pipeline.forecasting.intervals import gaussian_intervals

M = 12  # monthly seasonality


class Naive(ForecastModel):
    """Next values equal the latest observation: f(T+h) = y(T)."""

    id = "naive"
    family = "baseline"

    @classmethod
    def min_train(cls, **config: Any) -> int:
        return 1

    def fit(self, y: np.ndarray, periods: list[date]) -> Naive:
        validate_history(y, periods)
        self._y = np.asarray(y, dtype=float)
        d = np.diff(self._y)
        self._sigma = float(np.std(d, ddof=1)) if len(d) >= 3 else None  # one-step residuals
        return self

    def predict(self, h: int) -> ForecastResult:
        point = np.full(h, self._y[-1])
        if self._sigma is None:
            return ForecastResult(point)
        sig = self._sigma * np.sqrt(np.arange(1, h + 1))
        return ForecastResult(point, gaussian_intervals(point, sig), "random_walk_gaussian")


class SeasonalNaive(ForecastModel):
    """Same month of the previous year: f(T+h) = y(T+h-12*ceil(h/12)). Needs 12 observations."""

    id = "snaive"
    family = "baseline"

    @classmethod
    def min_train(cls, **config: Any) -> int:
        return M

    def fit(self, y: np.ndarray, periods: list[date]) -> SeasonalNaive:
        validate_history(y, periods)
        self._y = np.asarray(y, dtype=float)
        d = self._y[M:] - self._y[:-M]  # seasonal differences = in-sample residuals
        self._sigma = float(np.std(d, ddof=1)) if len(d) >= 3 else None
        return self

    def predict(self, h: int) -> ForecastResult:
        n = len(self._y)
        steps = np.arange(1, h + 1)
        point = self._y[n - M + ((steps - 1) % M)]
        if self._sigma is None:
            return ForecastResult(point)
        sig = self._sigma * np.sqrt(np.floor((steps - 1) / M) + 1)
        return ForecastResult(point, gaussian_intervals(point, sig), "seasonal_random_walk_gaussian")


class Drift(ForecastModel):
    """Straight line from the first to the last training observation: f(T+h) = y(T) + h*(y(T)-y(1))/(T-1)."""

    id = "drift"
    family = "baseline"

    @classmethod
    def min_train(cls, **config: Any) -> int:
        return 4

    def fit(self, y: np.ndarray, periods: list[date]) -> Drift:
        validate_history(y, periods)
        self._y = np.asarray(y, dtype=float)
        n = len(self._y)
        self._slope = float((self._y[-1] - self._y[0]) / (n - 1))
        resid = np.diff(self._y) - self._slope
        self._sigma = float(np.sqrt(np.sum(resid**2) / (n - 2))) if n > 3 else None
        return self

    def predict(self, h: int) -> ForecastResult:
        n = len(self._y)
        steps = np.arange(1, h + 1)
        point = self._y[-1] + steps * self._slope
        if self._sigma is None:
            return ForecastResult(point)
        sig = self._sigma * np.sqrt(steps * (1 + steps / (n - 1)))
        return ForecastResult(point, gaussian_intervals(point, sig), "drift_gaussian")
