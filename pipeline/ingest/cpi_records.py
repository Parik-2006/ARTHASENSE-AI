"""Validate and convert raw MoSPI CPI (2024 base) records. Pure functions, no I/O."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from pipeline.ingest.common import (  # noqa: F401  (re-exported for existing callers)
    MONTHS,
    ValidationError,
    parse_decimal,
    parse_month,
    parse_year,
)

# --- Identity of the one series this module ingests -------------------------------------------
SOURCE_CODE = "mospi"
SOURCE_NAME = "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki"
BASE_YEAR = "2024"
SERIES_NAME = "Current"
STATE = "All India"
SECTOR = "Combined"
DIVISION = "CPI (General)"

# Verified live request filters (see README "CPI ingestion").
FILTERS: dict[str, str | int] = {
    "base_year": BASE_YEAR,
    "series": SERIES_NAME,
    "state_code": 1,
    "sector_code": 3,
    "division_code": 0,
}

SERIES_INDEX_CODE = "mospi.cpi.2024.current.all_india.combined.general.index"
SERIES_INFLATION_CODE = "mospi.cpi.2024.current.all_india.combined.general.inflation_yoy"
CPI_SERIES_NAMES = ("Current", "Back")  # "Back" = MoSPI's official back series on the 2024 base


def series_codes(series_name: str = SERIES_NAME) -> tuple[str, str]:
    """(index code, inflation code). Current and Back are different series: never merged."""
    if series_name not in CPI_SERIES_NAMES:
        raise ValueError(f"unknown CPI series {series_name!r}")
    tag = series_name.lower()
    return (
        f"mospi.cpi.2024.{tag}.all_india.combined.general.index",
        f"mospi.cpi.2024.{tag}.all_india.combined.general.inflation_yoy",
    )


def filters(series_name: str = SERIES_NAME) -> dict[str, str | int]:
    return {**FILTERS, "series": series_name}


EXPECTED_TEXT = {
    "base_year": BASE_YEAR,
    "series": SERIES_NAME,
    "state": STATE,
    "sector": SECTOR,
    "division": DIVISION,
}


@dataclass(frozen=True)
class CpiRecord:
    period: date  # first day of the month
    index: Decimal | None
    inflation: Decimal | None  # year-on-year %, exactly as MoSPI reports it


def validate_record(
    raw: dict[str, Any], start_year: int, end_year: int, series_name: str = SERIES_NAME
) -> CpiRecord:
    for key, expected in {**EXPECTED_TEXT, "series": series_name}.items():
        if raw.get(key) != expected:
            raise ValidationError(f"{key}: expected {expected!r}, got {raw.get(key)!r}")
    year = parse_year(raw.get("year"), start_year, end_year)
    month = parse_month(raw.get("month"))
    return CpiRecord(
        period=date(year, month, 1),
        index=parse_decimal(raw.get("index"), "index"),
        inflation=parse_decimal(raw.get("inflation"), "inflation"),
    )


def validate_records(
    raws: list[dict[str, Any]], start_year: int, end_year: int, series_name: str = SERIES_NAME
) -> list[CpiRecord]:
    """Validate every record; return them in chronological order. Duplicate periods are an error."""
    seen: set[date] = set()
    out: list[CpiRecord] = []
    for i, raw in enumerate(raws):
        try:
            rec = validate_record(raw, start_year, end_year, series_name)
        except ValidationError as exc:
            raise ValidationError(f"record {i}: {exc}") from None
        if rec.period in seen:
            raise ValidationError(f"duplicate period {rec.period.isoformat()}")
        seen.add(rec.period)
        out.append(rec)
    return sorted(out, key=lambda r: r.period)
