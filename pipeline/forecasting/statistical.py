"""Statistical models via statsmodels: ETS and (S)ARIMA, with leakage-free automatic order selection.

Selection happens INSIDE `fit`, on the training window it is given and nothing else: every candidate in a
small, fixed grid is fitted to that window and the lowest AICc wins (Hurvich & Tsai's small-sample AIC; the
criterion recommended for short series by Hyndman & Athanasopoulos, FPP3 ch. 8-9). In a backtest each forecast
origin therefore selects its own order from the data it could see. The grids are deliberately small: with a few
years of data a wide search overfits. The chosen configuration is written to `diagnostics` ("label", "order",
"seasonal_order", ...) so every stored run says exactly which model produced it.

Only candidates with the same differencing are compared by AICc (ARIMA d=1; SARIMA d=1, D=1), because
likelihoods of differently differenced data are not comparable. Warnings from the optimiser are RECORDED
(diagnostics), not hidden.

Legacy fixed-order behaviour is still available: pass `order` / `seasonal_order` explicitly (as the stored
V1-V3 runs did) and no search is made.
"""

from __future__ import annotations

import warnings
from datetime import date
from itertools import product
from typing import Any

import numpy as np

from pipeline.forecasting.interfaces import (
    LEVELS,
    ForecastError,
    ForecastModel,
    ForecastResult,
    validate_history,
)


def _record(caught: list[warnings.WarningMessage]) -> list[str]:
    return sorted({f"{w.category.__name__}: {str(w.message)[:120]}" for w in caught})


def _finite_aicc(res: Any) -> float:
    v = float(getattr(res, "aicc", np.nan))
    return v if np.isfinite(v) else float(getattr(res, "aic", np.inf))


# ---- ETS ------------------------------------------------------------------------------------------

# (trend, damped, seasonal) candidates. Additive errors throughout (index levels are positive and far from 0).
ETS_GRID: tuple[tuple[str | None, bool, str | None], ...] = (
    ("add", True, None),  # A,Ad,N: damped trend (the V1-V3 configuration)
    ("add", False, None),  # A,A,N : Holt's linear trend
    (None, False, None),  # A,N,N : simple exponential smoothing
    ("add", True, "add"),  # A,Ad,A: damped trend + additive season (only with >= 3 full cycles)
)


def _ets_label(trend: str | None, damped: bool, seasonal: str | None) -> str:
    t = "N" if trend is None else ("Ad" if damped else "A")
    return f"ETS(A,{t},{'A' if seasonal else 'N'})"


class ETS(ForecastModel):
    """Additive-error exponential smoothing (state-space ETS) with AICc selection over `ETS_GRID`.

    Level l_t = l_{t-1} + phi*b_{t-1} + alpha*e_t ; trend b_t = phi*b_{t-1} + beta*e_t (damped: phi < 1);
    seasonal s_t = s_{t-m} + gamma*e_t. Intervals come from the selected state-space model.
    Config: m (season length, 12 or 4), select ('aicc' | 'fixed'), damped (used when select='fixed').
    """

    id = "ets"
    family = "statistical"

    @classmethod
    def min_train(cls, **config: Any) -> int:
        return 12

    def _candidates(self, n: int) -> list[tuple[str | None, bool, str | None]]:
        if self._config.get("select", "fixed") != "aicc":
            return [("add", bool(self._config.get("damped", True)), None)]
        m = int(self._config.get("m", 12))
        return [c for c in ETS_GRID if c[2] is None or n >= 3 * m]

    def fit(self, y: np.ndarray, periods: list[date]) -> ETS:
        import pandas as pd
        from statsmodels.tsa.exponential_smoothing.ets import ETSModel

        freq = validate_history(y, periods)
        self._n = len(y)
        m = int(self._config.get("m", 12))
        index = pd.date_range(periods[0], periods=len(y), freq="MS" if freq == "M" else "QS-JAN")
        series = pd.Series(np.asarray(y, float), index=index)
        best, best_score, tried, errors = None, np.inf, [], []
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for trend, damped, seasonal in self._candidates(len(y)):
                try:
                    res = ETSModel(series, error="add", trend=trend, damped_trend=damped and trend is not None,
                                   seasonal=seasonal, seasonal_periods=m if seasonal else None).fit(disp=False, maxiter=200)  # fmt: skip
                except Exception as exc:  # a candidate that cannot be fitted is skipped, and recorded
                    errors.append(f"{_ets_label(trend, damped, seasonal)}: {type(exc).__name__}")
                    continue
                score = _finite_aicc(res)
                tried.append((_ets_label(trend, damped, seasonal), round(score, 3)))
                if score < best_score:
                    best, best_score, chosen = res, score, (trend, damped, seasonal)
        if best is None:
            raise ForecastError(f"ETS fit failed for every candidate: {'; '.join(errors)[:200]}")
        self._res = best
        trend, damped, seasonal = chosen
        self.diagnostics = {
            "label": _ets_label(trend, damped, seasonal),
            "trend": trend, "damped": bool(damped and trend is not None), "seasonal": seasonal,
            "seasonal_periods": m if seasonal else None, "selection": self._config.get("select", "fixed"),
            "candidates": tried, "warnings": _record(caught), "aic": float(best.aic), "aicc": best_score,
        }  # fmt: skip
        return self

    def predict(self, h: int) -> ForecastResult:
        try:
            pred = self._res.get_prediction(start=self._n, end=self._n + h - 1)
            point = np.asarray(pred.predicted_mean, float)
            intervals = {}
            for lv in LEVELS:
                frame = pred.summary_frame(alpha=1 - lv / 100)
                intervals[lv] = (np.asarray(frame["pi_lower"], float), np.asarray(frame["pi_upper"], float))
        except Exception as exc:
            raise ForecastError(f"ETS prediction failed: {type(exc).__name__}: {exc}") from exc
        return ForecastResult(point, intervals, "ets_state_space")


# ---- (S)ARIMA -------------------------------------------------------------------------------------


def arima_label(order: tuple, seasonal: tuple, trend: str = "n") -> str:
    p, d, q = order
    base = f"ARIMA({p},{d},{q})"
    if len(seasonal) == 4 and seasonal[3]:
        P, D, Q, s = seasonal
        base = f"SARIMA({p},{d},{q})({P},{D},{Q}){s}"
    return base + (" with drift" if trend == "t" else "")


class SARIMA(ForecastModel):
    """SARIMA(p,1,q)(P,1,Q)_m through statsmodels' state-space SARIMAX (Gaussian intervals).

    Config: m (12 monthly, 4 quarterly); select='aicc' searches p,q in {0,1} and (P,Q) in {(0,1),(1,0)} with
    d = D = 1; or pass `order` and `seasonal_order` for one fixed model (the V1-V3 runs).
    """

    id = "sarima"
    family = "statistical"
    DEFAULT = {"order": (1, 1, 0), "seasonal_order": (0, 1, 0, 12)}
    GRID_PQ = ((0, 0), (1, 0), (0, 1), (1, 1))
    GRID_SEASONAL = ((0, 1), (1, 0))

    @classmethod
    def _m(cls, config: dict[str, Any]) -> int:
        if "seasonal_order" in config and config.get("select") != "aicc":
            return int(tuple(config["seasonal_order"])[3])
        return int(config.get("m", 12))

    @classmethod
    def _orders(cls, config: dict[str, Any]) -> tuple[tuple, tuple]:
        return tuple(config.get("order", cls.DEFAULT["order"])), tuple(
            config.get("seasonal_order", cls.DEFAULT["seasonal_order"])
        )

    @classmethod
    def _candidates(cls, config: dict[str, Any]) -> list[tuple[tuple, tuple, str]]:
        if config.get("select") != "aicc":
            order, seasonal = cls._orders(config)
            return [(order, seasonal, "n")]
        m = cls._m(config)
        return [((p, 1, q), (P, 1, Q, m), "n") for (p, q), (P, Q) in product(cls.GRID_PQ, cls.GRID_SEASONAL)]

    @staticmethod
    def _need(order: tuple, seasonal: tuple, trend: str) -> int:
        """Observations a candidate needs: >= 3 full seasons when seasonal, and >= 10 post-differencing points
        beyond its parameter count."""
        m = seasonal[3] if len(seasonal) == 4 else 0
        lost = order[1] + (seasonal[1] * m if m else 0)
        k = order[0] + order[2] + (seasonal[0] + seasonal[2] if m else 0) + (trend == "t")
        return max(3 * m if m else 0, lost + 10 + k)

    @classmethod
    def min_train(cls, **config: Any) -> int:
        """The smallest window on which at least one candidate may run. Longer windows search the full grid; the
        candidates actually tried at each origin are recorded in diagnostics."""
        return min(cls._need(*c) for c in cls._candidates(config))

    def fit(self, y: np.ndarray, periods: list[date]) -> SARIMA:
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        validate_history(y, periods)
        auto = self._config.get("select") == "aicc"
        best, best_score, tried, errors = None, np.inf, [], []
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for order, seasonal, trend in self._candidates(self._config):
                if self._need(order, seasonal, trend) > len(y):
                    continue  # too few observations for this candidate's parameters
                try:
                    res = SARIMAX(
                        np.asarray(y, float), order=order, seasonal_order=seasonal, trend=trend,
                        # automatic selection keeps the fitted model stationary and invertible, so no candidate
                        # with an explosive AR part can win; fixed legacy models keep their original settings
                        enforce_stationarity=auto, enforce_invertibility=auto,
                    ).fit(disp=False, maxiter=200)  # fmt: skip
                except Exception as exc:
                    errors.append(f"{arima_label(order, seasonal, trend)}: {type(exc).__name__}")
                    continue
                score = _finite_aicc(res)
                if not np.isfinite(score):
                    errors.append(f"{arima_label(order, seasonal, trend)}: non-finite AICc")
                    continue
                tried.append((arima_label(order, seasonal, trend), round(score, 3)))
                if score < best_score:
                    best, best_score, chosen = res, score, (order, seasonal, trend)
        if best is None:
            raise ForecastError(
                f"{self.id.upper()} fit failed for every candidate: {'; '.join(errors)[:200]}"
            )
        self._res = best
        order, seasonal, trend = chosen
        retvals = getattr(best, "mle_retvals", None) or {}
        self.diagnostics = {
            "label": arima_label(order, seasonal, trend),
            "order": list(order), "seasonal_order": list(seasonal), "trend": trend,
            "selection": "aicc" if auto else "fixed", "candidates": tried,
            "warnings": _record(caught), "converged": bool(retvals.get("converged", True)),
            "aic": float(best.aic), "aicc": best_score, **self._ar_stability(),
        }  # fmt: skip
        return self

    def _ar_stability(self) -> dict[str, Any]:
        """RECORD (never alter) whether the fitted AR part is explosive. Legacy fixed models are fitted with
        enforce_stationarity=False, so after a sudden level shift the AR coefficient can exceed 1 and
        multi-step forecasts diverge. Scores are not changed by this; it only makes the cause visible."""
        try:
            roots = np.asarray(self._res.arroots, dtype=complex)
        except Exception:  # no AR terms, or statsmodels cannot provide roots
            return {"explosive_ar": False, "ar_min_root_modulus": None}
        if roots.size == 0:
            return {"explosive_ar": False, "ar_min_root_modulus": None}
        m = float(np.min(np.abs(roots)))
        return {"explosive_ar": m < 1.0 - 1e-6, "ar_min_root_modulus": m}

    def predict(self, h: int) -> ForecastResult:
        try:
            fc = self._res.get_forecast(steps=h)
            point = np.asarray(fc.predicted_mean, float)
            intervals = {}
            for lv in LEVELS:
                ci = np.asarray(fc.conf_int(alpha=1 - lv / 100), float)
                intervals[lv] = (ci[:, 0], ci[:, 1])
        except Exception as exc:
            raise ForecastError(f"{self.id.upper()} prediction failed: {type(exc).__name__}: {exc}") from exc
        return ForecastResult(point, intervals, "sarimax_state_space")


class ARIMA(SARIMA):
    """Non-seasonal ARIMA(p,1,q), optionally with drift.

    Config: select='aicc' searches p in {0,1,2}, q in {0,1}, with or without drift (12 candidates, d = 1);
    or a fixed `order` (the V1-V3 runs used (1,1,0))."""

    id = "arima"
    DEFAULT = {"order": (1, 1, 0), "seasonal_order": (0, 0, 0, 0)}

    @classmethod
    def _candidates(cls, config: dict[str, Any]) -> list[tuple[tuple, tuple, str]]:
        if config.get("select") != "aicc":
            order, seasonal = cls._orders(config)
            return [(order, seasonal, "n")]
        return [((p, 1, q), (0, 0, 0, 0), t) for p, q, t in product((0, 1, 2), (0, 1), ("n", "t"))]
