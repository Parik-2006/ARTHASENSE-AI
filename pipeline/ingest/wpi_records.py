"""Validate raw MoSPI WPI records (headline index only). Pure functions, no I/O.

Verified live (Phase 4 discovery, /api/wpi/getWpiRecords + /api/wpi/getWpiData):
  * Headline = major_group_code 1000000000, labelled "Wholesale Price Index"; group/sub_group/
    sub_sub_group/item are all null for that row.
  * Only `index_value` is exposed. There is NO inflation field and NO provisional/final flag.
  * WPI is a national (all-India) index published by the Office of the Economic Adviser (DPIIT),
    served here through the MoSPI eSankhyiki API.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from pipeline.ingest.common import (
    ValidationError,
    parse_decimal,
    parse_month,
    parse_year,
)

SOURCE_CODE = "mospi"
SOURCE_NAME = "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki"
PUBLISHER_NOTE = "Compiled and published by the Office of the Economic Adviser, DPIIT; served via MoSPI"
GEOGRAPHY = "India"
COVERAGE = "All commodities (headline)"


@dataclass(frozen=True)
class WpiBase:
    major_group_code: str
    headline_label: str  # compared case-insensitively
    first_year: int


# Only bases whose headline code was read from the live metadata endpoint are registered.
WPI_BASES: dict[str, WpiBase] = {
    "2022-23": WpiBase("1000000000", "Wholesale Price Index", 2023),
    "2011-12": WpiBase("1000000000", "Wholesale price index", 2012),
}
DEFAULT_BASE = "2022-23"


def series_code(base_year: str) -> str:
    return f"mospi.wpi.{base_year}.india.all_commodities.index"


@dataclass(frozen=True)
class WpiRecord:
    period: date
    index: Decimal | None


def validate_record(raw: dict[str, Any], start_year: int, end_year: int, base_year: str) -> WpiRecord:
    base = WPI_BASES[base_year]
    if raw.get("base_year") != base_year:
        raise ValidationError(f"base_year: expected {base_year!r}, got {raw.get('base_year')!r}")
    # The 2022-23 base names its fields major_group / sub_group / sub_sub_group; the 2011-12 base uses
    # majorgroup / subgroup / sub_subgroup (verified live). Either spelling, same meaning.
    label = raw.get("major_group", raw.get("majorgroup"))
    if not isinstance(label, str) or label.strip().casefold() != base.headline_label.casefold():
        raise ValidationError(f"major_group: expected headline {base.headline_label!r}, got {label!r}")
    for level in ("group", "sub_group", "subgroup", "sub_sub_group", "sub_subgroup", "item"):
        if raw.get(level) not in (None, ""):
            raise ValidationError(f"{level}: expected empty for the headline row, got {raw.get(level)!r}")
    year = parse_year(raw.get("year"), start_year, end_year)
    month = parse_month(raw.get("month"))
    return WpiRecord(date(year, month, 1), parse_decimal(raw.get("index_value"), "index_value"))


def validate_records(
    raws: list[dict[str, Any]], start_year: int, end_year: int, base_year: str = DEFAULT_BASE
) -> list[WpiRecord]:
    seen: set[date] = set()
    out: list[WpiRecord] = []
    for i, raw in enumerate(raws):
        try:
            rec = validate_record(raw, start_year, end_year, base_year)
        except ValidationError as exc:
            raise ValidationError(f"record {i}: {exc}") from None
        if rec.period in seen:
            raise ValidationError(f"duplicate period {rec.period.isoformat()}")
        seen.add(rec.period)
        out.append(rec)
    return sorted(out, key=lambda r: r.period)
