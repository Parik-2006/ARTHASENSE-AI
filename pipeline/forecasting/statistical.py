"""Statistical models via statsmodels: damped-trend ETS and (S)ARIMA.

Small, fixed model orders on purpose: with 3 to 4 years of monthly data a wide automated search
would overfit and cost time. Warnings from the optimiser are RECORDED (diagnostics), not hidden.
"""

from __future__ import annotations

import warnings
from datetime import date
from typing import Any

import numpy as np

from pipeline.forecasting.interfaces import (
    LEVELS,
    ForecastError,
    ForecastModel,
    ForecastResult,
    validate_history,
)
from pipeline.forecasting.intervals import z_value


def _record(caught: list[warnings.WarningMessage]) -> list[str]:
    return sorted({f"{w.category.__name__}: {str(w.message)[:120]}" for w in caught})


class ETS(ForecastModel):
    """Additive-error ETS(A,Ad,N): exponential smoothing with a damped additive trend.

    Level l_t = l_{t-1} + phi*b_{t-1} + alpha*e_t ; trend b_t = phi*b_{t-1} + beta*e_t ; the damping
    phi < 1 stops the trend extrapolating forever. Intervals come from the state-space model.
    """

    id = "ets"
    family = "statistical"

    @classmethod
    def min_train(cls, **config: Any) -> int:
        return 12

    def fit(self, y: np.ndarray, periods: list[date]) -> ETS:
        import pandas as pd
        from statsmodels.tsa.exponential_smoothing.ets import ETSModel

        validate_history(y, periods)
        self._n = len(y)
        series = pd.Series(np.asarray(y, float), index=pd.date_range(periods[0], periods=len(y), freq="MS"))
        damped = bool(self._config.get("damped", True))
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                self._res = ETSModel(series, error="add", trend="add", damped_trend=damped).fit(
                    disp=False, maxiter=200
                )
            except Exception as exc:  # numerical failure: report, never fabricate
                raise ForecastError(f"ETS fit failed: {type(exc).__name__}: {exc}") from exc
        self.diagnostics = {"warnings": _record(caught), "aic": float(self._res.aic)}
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


class SARIMA(ForecastModel):
    """SARIMA(p,d,q)(P,D,Q)_12 through statsmodels' state-space SARIMAX (Gaussian intervals)."""

    id = "sarima"
    family = "statistical"
    DEFAULT = {"order": (1, 1, 0), "seasonal_order": (0, 1, 0, 12)}

    @classmethod
    def _orders(cls, config: dict[str, Any]) -> tuple[tuple, tuple]:
        return tuple(config.get("order", cls.DEFAULT["order"])), tuple(
            config.get("seasonal_order", cls.DEFAULT["seasonal_order"])
        )

    @classmethod
    def min_train(cls, **config: Any) -> int:
        order, seasonal = cls._orders(config)
        m = seasonal[3] if len(seasonal) == 4 else 0
        lost = order[1] + (seasonal[1] * m if m else 0)
        # need >= 3 full seasons when seasonal, and enough post-differencing points for the parameters
        return max(3 * m if m else 0, lost + 10 + order[0] + order[2])

    def fit(self, y: np.ndarray, periods: list[date]) -> SARIMA:
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        validate_history(y, periods)
        order, seasonal = self._orders(self._config)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                model = SARIMAX(
                    np.asarray(y, float),
                    order=order,
                    seasonal_order=seasonal,
                    enforce_stationarity=False,
                    enforce_invertibility=False,
                )
                self._res = model.fit(disp=False, maxiter=200)
            except Exception as exc:
                raise ForecastError(f"SARIMA fit failed: {type(exc).__name__}: {exc}") from exc
        retvals = getattr(self._res, "mle_retvals", None) or {}
        self.diagnostics = {
            "warnings": _record(caught),
            "converged": bool(retvals.get("converged", True)),
            "aic": float(self._res.aic),
            **self._ar_stability(),
        }
        return self

    def _ar_stability(self) -> dict[str, Any]:
        """RECORD (never alter) whether the fitted AR part is explosive. The model is fitted with
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
        fc = self._res.get_forecast(steps=h)
        point = np.asarray(fc.predicted_mean, float)
        intervals = {}
        for lv in LEVELS:
            ci = np.asarray(fc.conf_int(alpha=1 - lv / 100), float)
            intervals[lv] = (ci[:, 0], ci[:, 1])
        _ = z_value  # (documented: statsmodels uses the same Gaussian quantiles)
        return ForecastResult(point, intervals, "sarimax_state_space")


class ARIMA(SARIMA):
    """Non-seasonal ARIMA(1,1,0): the sensible choice when there are fewer than three full years."""

    id = "arima"
    DEFAULT = {"order": (1, 1, 0), "seasonal_order": (0, 0, 0, 0)}
