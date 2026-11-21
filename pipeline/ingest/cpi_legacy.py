"""CPI base 2012 (legacy) ingestion: All India / Combined / General index and official YoY inflation.

    python -m pipeline.ingest.history cpi2012 --start-year 2013 --end-year 2025 --resume
    python -m pipeline.ingest.preview cpi2012 --start-year 2013 --end-year 2025

MoSPI's CPI 2012=100 series ends in December 2025 (the 2024 base replaces it) and holds one continuous,
comparable index for Jan 2013 - Dec 2025, which is the only single-base official CPI history long enough
for a five-year view. It is a SEPARATE series from the 2024-base Current and Back series: nothing here is
linked or merged with them (no linking factor is applied).

Verified live (see docs/GOVDATA-DISCOVERY.md): endpoint /api/cpi/getCPIIndex with state_code=99,
sector_code=3, group_code=0 returns one row per month; rows carry `status` (the source's finality flag,
F = final), which is stored per observation. The first year (2013) has no YoY inflation (null, never filled).
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

from pipeline.ingest.common import PagedResult, ValidationError, fetch_paginated, parse_decimal, parse_month, parse_year
from pipeline.ingest.runner import Ingester
from pipeline.ingest.store_common import IngestStats, SeriesSpec, canonical_sha256, dec_str, store_snapshot
from pipeline.sources.mospi import BASE_URL, ENDPOINTS, MospiClient

SOURCE_CODE = "mospi"
SOURCE_NAME = "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki"
BASE_YEAR = "2012"
STATE, SECTOR, GROUP = "All India", "Combined", "General"
FIRST_YEAR = 2013
PAGE_SIZE = 100  # the API's documented cap for this endpoint family
INDEX_CODE = "mospi.cpi.2012.current.all_india.combined.general.index"
INFLATION_CODE = "mospi.cpi.2012.current.all_india.combined.general.inflation_yoy"

FILTERS: dict[str, str | int] = {"base_year": BASE_YEAR, "series": "Current", "state_code": 99, "sector_code": 3, "group_code": 0}

STATUS_LABEL = {"F": "source_final", "P": "source_provisional"}


def status_of(flag: str | None) -> str:
    """The source's own flag, kept visible. Unknown flags are preserved verbatim, never mapped to final."""
    f = (flag or "").strip()
    return STATUS_LABEL.get(f.upper(), f"source_status_{f}" if f else "retrieved")


@dataclass(frozen=True)
class LegacyCpiRecord:
    period: date
    index: Decimal | None
    inflation: Decimal | None
    status: str  # raw source flag, e.g. "F"


def validate_record(raw: dict[str, Any], start_year: int, end_year: int) -> LegacyCpiRecord:
    for key, want in (("baseyear", BASE_YEAR), ("state", STATE), ("sector", SECTOR), ("group", GROUP)):
        if raw.get(key) != want:
            raise ValidationError(f"{key}: expected {want!r}, got {raw.get(key)!r}")
    flag = raw.get("status")
    if not isinstance(flag, str) or not flag.strip():
        raise ValidationError(f"status: expected a finality flag, got {flag!r}")
    return LegacyCpiRecord(
        date(parse_year(raw.get("year"), start_year, end_year), parse_month(raw.get("month")), 1),
        parse_decimal(raw.get("index"), "index"),
        parse_decimal(raw.get("inflation"), "inflation"),
        flag.strip(),
    )


def validate_records(raws: list[dict[str, Any]], start_year: int, end_year: int) -> list[LegacyCpiRecord]:
    seen: set[date] = set()
    out: list[LegacyCpiRecord] = []
    for i, raw in enumerate(raws):
        try:
            rec = validate_record(raw, start_year, end_year)
        except ValidationError as exc:
            raise ValidationError(f"record {i}: {exc}") from None
        if rec.period in seen:
            raise ValidationError(f"duplicate period {rec.period.isoformat()}")
        seen.add(rec.period)
        out.append(rec)
    return sorted(out, key=lambda r: r.period)


def fetch_year(client: MospiClient, year: int, delay_s: float, args: argparse.Namespace | None = None) -> PagedResult:
    return fetch_paginated(
        client, "cpi_group_legacy", {**FILTERS, "year": year},
        key_fn=lambda r: (r.get("year"), r.get("month")), page_size=PAGE_SIZE, delay_s=delay_s,
    )  # fmt: skip


def specs() -> dict[str, SeriesSpec]:
    label = f"CPI (2012 base, legacy), {STATE} / {SECTOR} / {GROUP}"
    return {
        INDEX_CODE: SeriesSpec(INDEX_CODE, f"{label}: index", "CPI", "index (2012=100)", BASE_YEAR, STATE),
        INFLATION_CODE: SeriesSpec(INFLATION_CODE, f"{label}: year-on-year inflation", "CPI", "percent", BASE_YEAR, STATE),
    }


def key_prefix(start_year: int, end_year: int) -> str:
    return f"mospi-cpi2012-current-{start_year}-{end_year}-"


def source_url(start_year: int, end_year: int) -> str:
    query = "&".join(f"{k}={v}" for k, v in FILTERS.items())
    years = str(start_year) if start_year == end_year else f"{start_year}..{end_year}"
    return f"{BASE_URL}{ENDPOINTS['cpi_group_legacy']}?{query}&year={years}"


def snapshot_sha256(records: list[LegacyCpiRecord], start_year: int, end_year: int) -> str:
    body = {
        "filters": {k: str(v) for k, v in sorted(FILTERS.items())},
        "years": [start_year, end_year],
        "records": [[r.period.isoformat(), dec_str(r.index), dec_str(r.inflation), r.status] for r in sorted(records, key=lambda r: r.period)],
    }
    return canonical_sha256(body)


def store_cpi_legacy(conn: psycopg.Connection, records: list[LegacyCpiRecord], *, start_year: int, end_year: int, retrieved_at: datetime) -> IngestStats:
    sha = snapshot_sha256(records, start_year, end_year)
    obs = [(code, r.period, v, status_of(r.status)) for r in records for code, v in ((INDEX_CODE, r.index), (INFLATION_CODE, r.inflation))]
    return store_snapshot(
        conn, source_code=SOURCE_CODE, source_name=SOURCE_NAME, base_url=BASE_URL,
        release_key=key_prefix(start_year, end_year) + sha[:16], sha256=sha, retrieved_at=retrieved_at,
        source_url=source_url(start_year, end_year), specs=specs(), observations=obs,
    )  # fmt: skip


INGESTER = Ingester(
    name="CPI2012",
    prog="python -m pipeline.ingest.history cpi2012",
    doc=__doc__ or "",
    add_args=lambda p: None,
    first_year=lambda a: FIRST_YEAR,
    header=lambda a: [f"CPI series: Current (legacy)", f"Base year: {BASE_YEAR}", f"Coverage: {STATE} / {SECTOR} / {GROUP}"],
    fetch_year=lambda client, year, delay, a: fetch_year(client, year, delay, a),
    validate=lambda raws, s, e, a: validate_records(raws, s, e),
    summary=lambda recs, a: [
        f"Period range: {recs[0].period} to {recs[-1].period}",
        f"Missing index values: {sum(r.index is None for r in recs)}",
        f"Missing inflation values: {sum(r.inflation is None for r in recs)}",
        f"Source status flags: {sorted({r.status for r in recs})}",
    ],
    store=lambda conn, recs, s, e, at, a: store_cpi_legacy(conn, recs, start_year=s, end_year=e, retrieved_at=at),
    key_prefix=lambda s, e, a: key_prefix(s, e),
)

_ = time  # (kept for parity with sibling modules that sleep between pages)
