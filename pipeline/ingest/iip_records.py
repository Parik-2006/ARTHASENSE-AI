"""Validate raw MoSPI IIP records (General + sectoral category totals). Pure functions, no I/O.

Verified live (Phase 5 discovery, /api/iip/getIipData + /api/iip/getIipFilter):
  * `index` is the index level, `growth_rate` is MoSPI's official year-on-year growth (%). They are
    stored as two separate series.
  * type "General" -> category "General", sub_category "".
  * type "Sectoral" -> one row per sub-category plus ONE row with an empty sub_category. We treat
    the empty-sub_category row as the category total (inferred from the data structure: its value
    lies between the sub-category values and is the only such row per month). Duplicates would be
    rejected. Sub-category rows are validated but not stored.
  * `growth_rate` is year-on-year ONLY from the 13th served month on. For the first 12 served months
    of a base (Apr 2023 to Mar 2024 for 2022-23; Apr 2012 to Mar 2013 for 2011-12) MoSPI reports the
    change from the base-year level, i.e. exactly index - 100 (verified live against computed YoY).
    Those values are withheld (stored as missing), never labelled as YoY growth.
  * 2022-23 base: Mining & Quarrying (12), Manufacturing (2), Electricity & Gas Supply (13),
    Water Supply, Sewerage & Waste Management (14), General (4). 2011-12 base: Mining (1),
    Manufacturing (2), Electricity (3), General (4). Use-based categories are not ingested.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from pipeline.ingest.common import ValidationError, parse_decimal, parse_month, parse_year

SOURCE_CODE = "mospi"
SOURCE_NAME = "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki"
GEOGRAPHY = "India"


@dataclass(frozen=True)
class IipCategory:
    key: str  # stable id used in series codes and the API: general | mining | ...
    type: str  # "General" or "Sectoral" (the API's `type` filter)
    code: int  # the API's category_code
    label: str  # category name in the records (compared case-insensitively)


@dataclass(frozen=True)
class IipBase:
    first_year: int
    categories: tuple[IipCategory, ...]
    rate_valid_from: date  # first month whose growth_rate is a genuine year-on-year change


IIP_BASES: dict[str, IipBase] = {
    "2022-23": IipBase(
        2023,
        (
            IipCategory("general", "General", 4, "General"),
            IipCategory("mining", "Sectoral", 12, "Mining & Quarrying"),
            IipCategory("manufacturing", "Sectoral", 2, "Manufacturing"),
            IipCategory("electricity", "Sectoral", 13, "Electricity & Gas Supply"),
            IipCategory("water", "Sectoral", 14, "Water Supply, Sewerage & Waste Management"),
        ),
        date(2024, 4, 1),
    ),
    "2011-12": IipBase(
        2012,
        (
            IipCategory("general", "General", 4, "General"),
            IipCategory("mining", "Sectoral", 1, "Mining"),
            IipCategory("manufacturing", "Sectoral", 2, "Manufacturing"),
            IipCategory("electricity", "Sectoral", 3, "Electricity"),
        ),
        date(2013, 4, 1),
    ),
}
# Archive bases: General only, index only. Official growth is withheld (rate_valid_from far in the future)
# because how the source defines growth in a base's first served year was not verified for these bases.
_NEVER = date(9999, 12, 1)
IIP_BASES["2004-05"] = IipBase(2005, (IipCategory("general", "General", 4, "General"),), _NEVER)
IIP_BASES["1993-94"] = IipBase(1994, (IipCategory("general", "General", 4, "General"),), _NEVER)
DEFAULT_BASE = "2022-23"


def categories(base_year: str, keys: list[str] | None = None) -> list[IipCategory]:
    cats = IIP_BASES[base_year].categories
    if not keys:
        return list(cats)
    by_key = {c.key: c for c in cats}
    unknown = [k for k in keys if k not in by_key]
    if unknown:
        raise ValueError(f"unknown sector(s) for base {base_year}: {', '.join(unknown)}")
    return [by_key[k] for k in keys]


def series_codes(base_year: str, key: str) -> tuple[str, str]:
    """(index code, official growth code)."""
    stem = f"mospi.iip.{base_year}.india.{key}"
    return f"{stem}.index", f"{stem}.growth_yoy"


@dataclass(frozen=True)
class IipRecord:
    category: str  # IipCategory.key
    period: date
    index: Decimal | None
    growth: Decimal | None  # official year-on-year growth, %


def validate_records(
    raws: list[dict[str, Any]],
    start_year: int,
    end_year: int,
    base_year: str,
    cats: list[IipCategory],
) -> list[IipRecord]:
    """Keep category totals only; reject anything inconsistent. Chronological per category."""
    by_label = {c.label.casefold(): c for c in cats}
    seen: set[tuple[str, date]] = set()
    out: list[IipRecord] = []
    for i, raw in enumerate(raws):
        try:
            if raw.get("base_year") != base_year:
                raise ValidationError(f"base_year: expected {base_year!r}, got {raw.get('base_year')!r}")
            label = raw.get("category")
            cat = by_label.get(label.strip().casefold()) if isinstance(label, str) else None
            if cat is None:
                raise ValidationError(f"unexpected category {label!r}")
            if raw.get("type") != cat.type:
                raise ValidationError(f"type: expected {cat.type!r}, got {raw.get('type')!r}")
            year = parse_year(raw.get("year"), start_year, end_year)
            month = parse_month(raw.get("month"))
            index = parse_decimal(raw.get("index"), "index")
            growth = parse_decimal(raw.get("growth_rate"), "growth_rate")
        except ValidationError as exc:
            raise ValidationError(f"record {i}: {exc}") from None
        if (raw.get("sub_category") or "").strip():
            if cat.key == "general":
                raise ValidationError(f"record {i}: General must not have a sub_category")
            continue  # a sub-category detail row: valid, but not stored in this phase
        period = date(year, month, 1)
        if (cat.key, period) in seen:
            raise ValidationError(f"duplicate period {period.isoformat()} for {cat.key}")
        seen.add((cat.key, period))
        if period < IIP_BASES[base_year].rate_valid_from:
            growth = None  # base-year-relative figure, not year-on-year: withheld
        out.append(IipRecord(cat.key, period, index, growth))
    missing = [c.key for c in cats if not any(r.category == c.key for r in out)]
    if missing:
        raise ValidationError(f"no category-total rows found for: {', '.join(missing)}")
    return sorted(out, key=lambda r: (r.category, r.period))
