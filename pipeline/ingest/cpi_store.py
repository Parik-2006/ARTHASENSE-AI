"""Store validated CPI records as an auditable retrieval snapshot (see store_common.py).

CPI index and year-on-year inflation are separate series. The "Current" and the official "Back"
series (MoSPI's back series on the same 2024 base) are separate series too: never merged here.
"""

from __future__ import annotations

from datetime import datetime

import psycopg

from pipeline.ingest.cpi_records import (
    BASE_YEAR,
    DIVISION,
    SECTOR,
    SERIES_NAME,
    SOURCE_CODE,
    SOURCE_NAME,
    STATE,
    CpiRecord,
    filters,
    series_codes,
)
from pipeline.ingest.store_common import (
    IngestStats,
    SeriesSpec,
    canonical_sha256,
    dec_str,
    store_snapshot,
)
from pipeline.sources.mospi import BASE_URL, ENDPOINTS

__all__ = ["IngestStats", "release_key", "snapshot_sha256", "source_url", "store_cpi"]


def snapshot_sha256(
    records: list[CpiRecord], start_year: int, end_year: int, series_name: str = SERIES_NAME
) -> str:
    """Hash of exactly what we would store, independent of API ordering or page size."""
    body = {
        "filters": {k: str(v) for k, v in sorted(filters(series_name).items())},
        "years": [start_year, end_year],
        "records": [
            [r.period.isoformat(), dec_str(r.index), dec_str(r.inflation)]
            for r in sorted(records, key=lambda r: r.period)
        ],
    }
    return canonical_sha256(body)


def release_key(start_year: int, end_year: int, sha256: str, series_name: str = SERIES_NAME) -> str:
    return f"mospi-cpi2024-{series_name.lower()}-{start_year}-{end_year}-{sha256[:16]}"


def source_url(start_year: int, end_year: int, series_name: str = SERIES_NAME) -> str:
    query = "&".join(f"{k}={v}" for k, v in filters(series_name).items())
    years = str(start_year) if start_year == end_year else f"{start_year}..{end_year}"
    return f"{BASE_URL}{ENDPOINTS['cpi_2024']}?{query}&year={years}"


def specs(series_name: str = SERIES_NAME) -> dict[str, SeriesSpec]:
    idx, infl = series_codes(series_name)
    label = f"CPI (2024 base, {series_name} series), {STATE} / {SECTOR} / {DIVISION}"
    return {
        idx: SeriesSpec(idx, f"{label}: index", "CPI", "index (2024=100)", BASE_YEAR, STATE),
        infl: SeriesSpec(infl, f"{label}: year-on-year inflation", "CPI", "percent", BASE_YEAR, STATE),
    }


def store_cpi(
    conn: psycopg.Connection,
    records: list[CpiRecord],
    *,
    start_year: int,
    end_year: int,
    retrieved_at: datetime,
    series_name: str = SERIES_NAME,
) -> IngestStats:
    """All-or-nothing: one transaction; any failure rolls everything back."""
    sha = snapshot_sha256(records, start_year, end_year, series_name)
    idx, infl = series_codes(series_name)
    obs = [(code, r.period, v) for r in records for code, v in ((idx, r.index), (infl, r.inflation))]
    return store_snapshot(
        conn,
        source_code=SOURCE_CODE,
        source_name=SOURCE_NAME,
        base_url=BASE_URL,
        release_key=release_key(start_year, end_year, sha, series_name),
        sha256=sha,
        retrieved_at=retrieved_at,
        source_url=source_url(start_year, end_year, series_name),
        specs=specs(series_name),
        observations=obs,
    )
