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


STEP_MONTHS = {"M": 1, "Q": 3}  # months between consecutive observations
SEASON_LENGTH = {"M": 12, "Q": 4}  # observations per seasonal cycle (one year)


def infer_frequency(periods: list[date]) -> str:
    """'M' (consecutive months) or 'Q' (quarters: first month of each quarter, 3 months apart).

    A single observation is treated as monthly. Anything else (mixed or irregular steps) is an error:
    frequencies are never guessed from partial evidence."""
    if len(periods) < 2:
        return "M"
    steps = set(np.diff([month_index(p) for p in periods]).tolist())
    if steps == {1}:
        return "M"
    if steps == {3}:
        return "Q"
    raise ValueError(
        "periods must be strictly consecutive months or quarters (gap, duplicate or mixed step found)"
    )


def validate_history(y: np.ndarray, periods: list[date], freq: str | None = None) -> str:
    """Strict input validation: finite values, first-of-month dates, consecutive periods, no gaps.

    Returns the frequency ('M' or 'Q'). With `freq` given, the periods must have exactly that step."""
    if y.ndim != 1 or len(y) != len(periods):
        raise ValueError("values and periods must be 1-D and the same length")
    if len(y) == 0:
        raise ValueError("empty history")
    if not np.all(np.isfinite(y)):
        raise ValueError("history contains NaN/inf: missing values are never filled silently")
    if any(p.day != 1 for p in periods):
        raise ValueError("periods must be first-of-month dates")
    found = infer_frequency(periods)
    if freq is not None and len(periods) >= 2 and found != freq:
        step = "months" if freq == "M" else "quarters"
        raise ValueError(f"periods must be strictly consecutive {step} (gap or duplicate found)")
    return freq or found


def future_periods(last: date, h: int, freq: str = "M") -> list[date]:
    n, s = month_index(last), STEP_MONTHS[freq]
    return [date((n + s * k) // 12, (n + s * k) % 12 + 1, 1) for k in range(1, h + 1)]


def season_position(d: date, freq: str) -> int:
    """0-based position within the year: month 0..11, or quarter 0..3 (calendar quarters)."""
    return d.month - 1 if freq == "M" else (d.month - 1) // 3


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
