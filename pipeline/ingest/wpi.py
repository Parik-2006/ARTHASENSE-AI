"""WPI ingestion (headline index): MoSPI API -> validation -> PostgreSQL.

    python -m pipeline.ingest.wpi --year 2025 --dry-run
    python -m pipeline.ingest.wpi --year 2025
    python -m pipeline.ingest.wpi --start-year 2023 --end-year 2026 --base-year 2022-23

Requests only the headline index (major_group_code=1000000000) for the chosen base year.
WPI inflation is not offered by this API, so only the index series is stored.
"""

from __future__ import annotations

import argparse
from datetime import datetime

import psycopg

from pipeline.ingest.common import PagedResult, fetch_paginated
from pipeline.ingest.runner import Ingester, run_cli
from pipeline.ingest.store_common import (
    IngestStats,
    SeriesSpec,
    canonical_sha256,
    dec_str,
    store_snapshot,
)
from pipeline.ingest.wpi_records import (
    COVERAGE,
    DEFAULT_BASE,
    GEOGRAPHY,
    SOURCE_CODE,
    SOURCE_NAME,
    WPI_BASES,
    WpiRecord,
    series_code,
    validate_records,
)
from pipeline.sources.mospi import BASE_URL, ENDPOINTS, MospiClient

PAGE_SIZE = 50  # a year of headline rows is at most 12


def filters(base_year: str) -> dict[str, str]:
    return {"base_year": base_year, "major_group_code": WPI_BASES[base_year].major_group_code}


def snapshot_sha256(records: list[WpiRecord], start_year: int, end_year: int, base_year: str) -> str:
    return canonical_sha256(
        {
            "filters": filters(base_year),
            "years": [start_year, end_year],
            "records": [
                [r.period.isoformat(), dec_str(r.index)] for r in sorted(records, key=lambda r: r.period)
            ],
        }
    )


def key_prefix(start_year: int, end_year: int, base_year: str) -> str:
    return f"mospi-wpi-{base_year}-{start_year}-{end_year}-"


def spec(base_year: str) -> SeriesSpec:
    code = series_code(base_year)
    return SeriesSpec(
        code,
        f"WPI (base {base_year}), {GEOGRAPHY} / {COVERAGE}: index",
        "WPI",
        f"index ({base_year}=100)",
        base_year,
        GEOGRAPHY,
    )


def source_url(start_year: int, end_year: int, base_year: str) -> str:
    query = "&".join(f"{k}={v}" for k, v in filters(base_year).items())
    years = str(start_year) if start_year == end_year else f"{start_year}..{end_year}"
    return f"{BASE_URL}{ENDPOINTS['wpi']}?{query}&year={years}"


def store_wpi(
    conn: psycopg.Connection,
    records: list[WpiRecord],
    *,
    start_year: int,
    end_year: int,
    retrieved_at: datetime,
    base_year: str = DEFAULT_BASE,
) -> IngestStats:
    sha = snapshot_sha256(records, start_year, end_year, base_year)
    code = series_code(base_year)
    return store_snapshot(
        conn,
        source_code=SOURCE_CODE,
        source_name=SOURCE_NAME,
        base_url=BASE_URL,
        release_key=key_prefix(start_year, end_year, base_year) + sha[:16],
        sha256=sha,
        retrieved_at=retrieved_at,
        source_url=source_url(start_year, end_year, base_year),
        specs={code: spec(base_year)},
        observations=[(code, r.period, r.index) for r in records],
    )


# ---- plumbing for the generic CLI / history runner -------------------------------------------


def _add_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--base-year", choices=sorted(WPI_BASES), default=DEFAULT_BASE, help="WPI base year")


def _fetch_year(client: MospiClient, year: int, delay_s: float, a: argparse.Namespace) -> PagedResult:
    return fetch_paginated(
        client,
        "wpi",
        {**filters(a.base_year), "year": year},
        key_fn=lambda r: (r.get("year"), r.get("month"), r.get("major_group"), r.get("item")),
        page_size=PAGE_SIZE,
        delay_s=delay_s,
    )


INGESTER = Ingester(
    name="WPI",
    prog="python -m pipeline.ingest.wpi",
    doc=__doc__ or "",
    add_args=_add_args,
    first_year=lambda a: WPI_BASES[a.base_year].first_year,
    header=lambda a: [f"Base year: {a.base_year}", f"Coverage: {GEOGRAPHY} / {COVERAGE}"],
    fetch_year=_fetch_year,
    validate=lambda raws, s, e, a: validate_records(raws, s, e, a.base_year),
    summary=lambda recs, a: [
        f"Period range: {recs[0].period} to {recs[-1].period}",
        f"Missing index values: {sum(r.index is None for r in recs)}",
        "Inflation: not provided by the API (index only)",
    ],
    store=lambda conn, recs, s, e, at, a: store_wpi(
        conn, recs, start_year=s, end_year=e, retrieved_at=at, base_year=a.base_year
    ),
    key_prefix=lambda s, e, a: key_prefix(s, e, a.base_year),
)


def main(argv: list[str] | None = None, client: MospiClient | None = None) -> int:
    return run_cli(INGESTER, argv, client)


if __name__ == "__main__":
    raise SystemExit(main())
