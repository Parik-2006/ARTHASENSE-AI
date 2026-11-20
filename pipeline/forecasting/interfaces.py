"""The one interface every forecasting model implements.

A model instance is single-use: build it, `fit` it on the history visible at ONE forecast origin,
call `predict`, throw it away. A fresh instance per origin is what keeps backtests free of leakage.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from typing import Any, ClassVar

import numpy as np

LEVELS = (80, 95)  # nominal coverage levels (%) used everywhere


class ForecastError(RuntimeError):
    """A model could not produce a valid forecast (convergence, numerical failure, ...)."""


class ModelUnavailable(RuntimeError):
    """The model cannot run here (missing optional dependency, weights not approved, ...)."""


@dataclass(frozen=True)
class Eligibility:
    ok: bool
    reason: str | None = None


@dataclass
class ForecastResult:
    """`point[k]` is the (k+1)-step-ahead forecast. `intervals[level] = (lower, upper)` arrays."""

    point: np.ndarray
    intervals: dict[int, tuple[np.ndarray, np.ndarray]] = field(default_factory=dict)
    interval_method: str | None = None

    def validate(self, h: int) -> None:
        if self.point.shape != (h,) or not np.all(np.isfinite(self.point)):
            raise ForecastError("model returned a non-finite or wrongly shaped forecast")
        for level, (lo, hi) in self.intervals.items():
            if (
                lo.shape != (h,)
                or hi.shape != (h,)
                or not (np.all(np.isfinite(lo)) and np.all(np.isfinite(hi)))
            ):
                raise ForecastError(f"model returned a non-finite {level}% interval")
            if np.any(lo > hi):
                raise ForecastError(f"{level}% interval has lower > upper")


def month_index(d: date) -> int:
    return d.year * 12 + d.month - 1


def validate_history(y: np.ndarray, periods: list[date]) -> None:
    """Strict input validation: finite values, first-of-month dates, consecutive months, no gaps."""
    if y.ndim != 1 or len(y) != len(periods):
        raise ValueError("values and periods must be 1-D and the same length")
    if len(y) == 0:
        raise ValueError("empty history")
    if not np.all(np.isfinite(y)):
        raise ValueError("history contains NaN/inf: missing values are never filled silently")
    if any(p.day != 1 for p in periods):
        raise ValueError("periods must be first-of-month dates")
    steps = np.diff([month_index(p) for p in periods])
    if len(steps) and not np.all(steps == 1):
        raise ValueError("periods must be strictly consecutive months (gap or duplicate found)")


def future_periods(last: date, h: int) -> list[date]:
    n = month_index(last)
    return [date((n + k) // 12, (n + k) % 12 + 1, 1) for k in range(1, h + 1)]


class ForecastModel(ABC):
    id: ClassVar[str]
    version: ClassVar[str] = "1"
    family: ClassVar[str] = "baseline"  # baseline | statistical | machine_learning | foundation
    stochastic: ClassVar[bool] = False

    def __init__(self, seed: int = 0, **config: Any) -> None:
        self.seed = seed
        self._config = dict(config)
        self.diagnostics: dict[str, Any] = {}

    @property
    def config(self) -> dict[str, Any]:
        return dict(self._config)

    @classmethod
    @abstractmethod
    def min_train(cls, **config: Any) -> int:
        """Smallest training window (observations) for which the model is allowed to run."""

    def eligibility(self, n_train: int) -> Eligibility:
        need = self.min_train(**self._config)
        if n_train < need:
            return Eligibility(False, f"{self.id} needs at least {need} training observations, got {n_train}")
        return Eligibility(True)

    @abstractmethod
    def fit(self, y: np.ndarray, periods: list[date]) -> ForecastModel: ...

    @abstractmethod
    def predict(self, h: int) -> ForecastResult: ...
