from datetime import date
from decimal import Decimal

import pytest

from pipeline.ingest.cpi_records import ValidationError, parse_decimal, parse_month, validate_records


def raw(month="December", year="2025", index="104.10", inflation=None, **over):
    base = {
        "base_year": "2024", "series": "Current", "year": year, "month": month,
        "state": "All India", "sector": "Combined", "division": "CPI (General)",
        "index": index, "inflation": inflation,
    }  # fmt: skip
    return {**base, **over}


def test_valid_record_is_converted():
    [rec] = validate_records([raw()], 2025, 2025)
    assert rec.period == date(2025, 12, 1)
    assert rec.index == Decimal("104.10")
    assert rec.inflation is None


def test_month_names():
    assert parse_month("January") == 1
    assert parse_month(" september ") == 9
    for bad in ("Dec", "Smarch", "", None, 7):
        with pytest.raises(ValidationError):
            parse_month(bad)


def test_decimal_is_exact_and_missing_is_none_not_zero():
    assert parse_decimal("104.10", "index") == Decimal("104.10")
    assert str(parse_decimal("104.10", "index")) == "104.10"  # no float rounding
    assert parse_decimal(None, "inflation") is None
    assert parse_decimal("  ", "inflation") is None
    assert parse_decimal("0", "inflation") == Decimal("0")  # a real zero stays zero


@pytest.mark.parametrize("bad", ["abc", "NaN", "Infinity", True, ["1"]])
def test_non_numeric_values_rejected(bad):
    with pytest.raises(ValidationError):
        parse_decimal(bad, "index")


@pytest.mark.parametrize(
    "over",
    [
        {"base_year": "2012"}, {"series": "Back"}, {"state": "Kerala"},
        {"sector": "Rural"}, {"division": "Food and beverages"}, {"year": "2030"},
        {"year": "abc"}, {"month": "Dec"}, {"index": "x"}, {"inflation": "n/a"},
    ],
)  # fmt: skip
def test_invalid_records_rejected(over):
    with pytest.raises(ValidationError):
        validate_records([raw(**over)], 2025, 2025)


def test_sorted_chronologically_and_missing_values_kept():
    recs = validate_records([raw("December"), raw("January", index="100", inflation="1.5")], 2025, 2025)
    assert [r.period.month for r in recs] == [1, 12]
    assert recs[0].inflation == Decimal("1.5") and recs[1].inflation is None


def test_duplicate_period_rejected():
    with pytest.raises(ValidationError, match="duplicate period 2025-12-01"):
        validate_records([raw(), raw()], 2025, 2025)
