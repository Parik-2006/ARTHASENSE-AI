"""Cross-page consistency: forecasts are trained on exactly the series the Indicators API serves by default.

If these ever diverge, the Forecasts page would show a latest official value (and a forecast) from a different
base year than the Indicators page. Pure constant checks: no database needed.
"""

from app import forecasting, indicators


def test_forecasting_trains_on_the_indicators_default_series():
    expected = {
        "cpi": indicators.cpi_codes("current")[0],
        "wpi": indicators.wpi_code(indicators.DEFAULT_WPI_BASE),
        "iip": indicators.iip_codes(indicators.DEFAULT_IIP_BASE, "general")[0],
    }
    assert expected == forecasting.INDICATOR_SERIES


def test_default_base_years_match_the_trained_series():
    assert forecasting.INDICATOR_SERIES["cpi"] == indicators.CPI_INDEX_SERIES
    assert f".{indicators.DEFAULT_WPI_BASE}." in forecasting.INDICATOR_SERIES["wpi"]
    assert f".{indicators.DEFAULT_IIP_BASE}." in forecasting.INDICATOR_SERIES["iip"]


def test_no_legacy_or_back_series_is_ever_a_training_series():
    codes = set(forecasting.INDICATOR_SERIES.values())
    wpi_old = [b for b in indicators.WPI_BASES if b != indicators.DEFAULT_WPI_BASE]
    iip_old = [b for b in indicators.IIP_BASES if b != indicators.DEFAULT_IIP_BASE]
    for legacy in (
        indicators.cpi_codes("back")[0],
        indicators.cpi_codes(indicators.CPI_LEGACY)[0],
        *(indicators.wpi_code(b) for b in wpi_old),
        *(indicators.iip_codes(b, "general")[0] for b in iip_old),
    ):
        assert legacy not in codes
