"""Optional, lazily loaded foundation-model adapters (Chronos-2, TimesFM 2.5).

STATUS: availability checks are real; the inference code follows the models' published quick-start
APIs but is UNTESTED here, because it needs PyTorch and a 0.5-1 GB weight download that has not been
approved. Nothing is imported at module load and nothing is downloaded unless
ARTHASENSE_ALLOW_MODEL_DOWNLOAD=1 is set. If a model cannot run it raises ModelUnavailable with the
exact reason; the rest of the pipeline is unaffected and no output is ever invented.

Verified metadata (Hugging Face API, 2026-11-20): amazon/chronos-2 (Apache-2.0, ~120M params,
pip `chronos-forecasting`); google/timesfm-2.5-200m-pytorch (Apache-2.0, ~231M params, pip `timesfm`).
"""

from __future__ import annotations

import importlib.util
import os
from datetime import date
from typing import Any

import numpy as np

from pipeline.forecasting.interfaces import (
    ForecastModel,
    ForecastResult,
    ModelUnavailable,
    validate_history,
)

DOWNLOAD_FLAG = "ARTHASENSE_ALLOW_MODEL_DOWNLOAD"


def _missing(*modules: str) -> list[str]:
    return [m for m in modules if importlib.util.find_spec(m) is None]


def _gate(pip_name: str, modules: tuple[str, ...], size: str) -> None:
    missing = _missing(*modules)
    if missing:
        raise ModelUnavailable(
            f"python package(s) {', '.join(missing)} not installed (pip install {pip_name} torch; "
            f"roughly {size} of weights plus ~200 MB for CPU PyTorch). Needs explicit approval."
        )
    if os.environ.get(DOWNLOAD_FLAG) != "1":
        raise ModelUnavailable(f"weights ({size}) are not downloaded: set {DOWNLOAD_FLAG}=1 to allow it")


class Chronos2(ForecastModel):
    id = "chronos2"
    family = "foundation"
    MODEL_ID = "amazon/chronos-2"

    @classmethod
    def min_train(cls, **config: Any) -> int:
        return 12

    @classmethod
    def availability(cls) -> tuple[bool, str | None]:
        try:
            _gate("chronos-forecasting", ("torch", "chronos"), "~0.5 GB")
        except ModelUnavailable as exc:
            return False, str(exc)
        return True, None

    def fit(self, y: np.ndarray, periods: list[date]) -> Chronos2:
        validate_history(y, periods)
        _gate("chronos-forecasting", ("torch", "chronos"), "~0.5 GB")
        self._y, self._periods = np.asarray(y, float), periods
        return self

    def predict(self, h: int) -> ForecastResult:  # pragma: no cover - needs weights
        import pandas as pd
        from chronos import Chronos2Pipeline

        pipe = Chronos2Pipeline.from_pretrained(self.MODEL_ID, device_map="cpu")
        ctx = pd.DataFrame({"id": "s", "timestamp": pd.to_datetime(self._periods), "target": self._y})
        out = pipe.predict_df(
            ctx, prediction_length=h, quantile_levels=[0.025, 0.1, 0.5, 0.9, 0.975],
            id_column="id", timestamp_column="timestamp", target="target",
        )  # fmt: skip
        out = out.sort_values("timestamp")
        q = {k: out[k].to_numpy(float) for k in ("0.025", "0.1", "0.5", "0.9", "0.975")}
        return ForecastResult(
            q["0.5"], {80: (q["0.1"], q["0.9"]), 95: (q["0.025"], q["0.975"])}, "chronos2_quantiles"
        )


class TimesFM25(ForecastModel):
    id = "timesfm25"
    family = "foundation"
    MODEL_ID = "google/timesfm-2.5-200m-pytorch"

    @classmethod
    def min_train(cls, **config: Any) -> int:
        return 12

    @classmethod
    def availability(cls) -> tuple[bool, str | None]:
        try:
            _gate("timesfm", ("torch", "timesfm"), "~0.9 GB")
        except ModelUnavailable as exc:
            return False, str(exc)
        return True, None

    def fit(self, y: np.ndarray, periods: list[date]) -> TimesFM25:
        validate_history(y, periods)
        _gate("timesfm", ("torch", "timesfm"), "~0.9 GB")
        self._y = np.asarray(y, float)
        return self

    def predict(self, h: int) -> ForecastResult:  # pragma: no cover - needs weights
        import timesfm

        model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(self.MODEL_ID)
        model.compile(timesfm.ForecastConfig(max_context=512, max_horizon=max(h, 12), normalize_inputs=True))
        point, _quantiles = model.forecast(horizon=h, inputs=[self._y])
        return ForecastResult(np.asarray(point[0], float))  # point forecast only: no intervals claimed
