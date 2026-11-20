"""CPI (2024 base) ingestion: MoSPI API -> validation -> PostgreSQL.

    python -m pipeline.ingest.cpi --year 2025 --dry-run     # fetch + validate, DB untouched
    python -m pipeline.ingest.cpi --year 2025               # also writes to PostgreSQL
    python -m pipeline.ingest.cpi --start-year 2025 --end-year 2026

Only All India / Combined / CPI (General), base 2024, series "Current" is requested.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime

import httpx
import psycopg

from pipeline.ingest.config import database_url
from pipeline.ingest.cpi_fetch import FetchError, fetch_year
from pipeline.ingest.cpi_records import (
    BASE_YEAR,
    DIVISION,
    SECTOR,
    STATE,
    CpiRecord,
    ValidationError,
    validate_records,
)
from pipeline.ingest.cpi_store import store_cpi
from pipeline.ingest.runner import Ingester
from pipeline.sources.mospi import USER_AGENT, MospiClient

FIRST_YEARS = {"Current": 2024, "Back": 2013}  # earliest years verified live in Phase 6
MAX_YEARS = 5  # keep every run small


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m pipeline.ingest.cpi",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--year", type=int, help="a single calendar year, e.g. 2025")
    p.add_argument("--start-year", type=int, help="first year of a range (use with --end-year)")
    p.add_argument("--end-year", type=int, help="last year of a range (inclusive)")
    p.add_argument("--dry-run", action="store_true", help="fetch and validate only; do not touch PostgreSQL")
    p.add_argument(
        "--delay", type=float, default=0.5, help="seconds to wait between API requests (default 0.5)"
    )
    p.add_argument(
        "--series",
        choices=("Current", "Back"),
        default="Current",
        help='"Current" (2025 onwards) or the official "Back" series on the same 2024 base (2013-2024)',
    )
    return p  # fmt: skip


def resolve_years(args: argparse.Namespace, today_year: int | None = None) -> tuple[int, int]:
    """Turn CLI flags into a bounded (start, end) year range, or raise ValueError."""
    last_year = today_year or datetime.now(UTC).year
    if args.year is not None:
        if args.start_year is not None or args.end_year is not None:
            raise ValueError("use either --year, or --start-year with --end-year")
        start = end = args.year
    elif args.start_year is not None and args.end_year is not None:
        start, end = args.start_year, args.end_year
    else:
        raise ValueError("give --year, or both --start-year and --end-year")
    if start > end:
        raise ValueError("--start-year must not be after --end-year")
    first_year = FIRST_YEARS[getattr(args, "series", "Current")]
    if start < first_year or end > last_year:
        raise ValueError(f"years must be between {first_year} and {last_year}")
    if end - start + 1 > MAX_YEARS:
        raise ValueError(f"at most {MAX_YEARS} years per run")
    if args.delay < 0:
        raise ValueError("--delay must not be negative")
    return start, end


def fetch_and_validate(
    client: MospiClient, start: int, end: int, delay_s: float, series_name: str = "Current"
) -> tuple[list[CpiRecord], int, datetime]:
    """Returns (validated records, raw record count, retrieval time)."""
    raw: list[dict] = []
    retrieved_at = datetime.now(UTC)
    for i, year in enumerate(range(start, end + 1)):
        if i:
            time.sleep(delay_s)
        result = fetch_year(client, year, delay_s=delay_s, series_name=series_name)
        if not result.records:
            raise FetchError(f"MoSPI returned no records for {year}")
        if i == 0:
            retrieved_at = result.retrieved_at
        raw.extend(result.records)
    return validate_records(raw, start, end, series_name), len(raw), retrieved_at


def main(argv: list[str] | None = None, client: MospiClient | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        start, end = resolve_years(args)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    requested = str(start) if start == end else f"{start}-{end}"
    print("ArthaSense AI - CPI Ingestion")
    print("Source: MoSPI")
    print(f"Base year: {BASE_YEAR}")
    print(f"Coverage: {STATE} / {SECTOR} / {DIVISION}")
    print(f"CPI series: {args.series}")
    print(f"Requested year: {requested}")

    url = None
    if not args.dry_run:
        url = database_url()
        if not url:
            print("Error: ARTHASENSE_DATABASE_URL is not set (see .env.example)", file=sys.stderr)
            return 2

    own_client = client is None
    mospi = client or MospiClient(
        httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    )
    try:
        records, fetched, retrieved_at = fetch_and_validate(mospi, start, end, args.delay, args.series)
    except (FetchError, ValidationError) as exc:
        print(f"Status: FAILED ({exc})", file=sys.stderr)
        return 1
    finally:
        if own_client:
            mospi.close()

    missing_index = sum(r.index is None for r in records)
    missing_inflation = sum(r.inflation is None for r in records)
    print(f"Fetched records: {fetched}")
    print(f"Validated records: {len(records)}")
    print(f"Period range: {records[0].period} to {records[-1].period}")
    print(f"Missing index values: {missing_index}")
    print(f"Missing inflation values: {missing_inflation}")

    if args.dry_run:
        print("Database: not touched (dry run)")
        print("Status: SUCCESS (dry run)")
        return 0

    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            stats = store_cpi(
                conn,
                records,
                start_year=start,
                end_year=end,
                retrieved_at=retrieved_at,
                series_name=args.series,
            )
    except Exception as exc:  # never echo the URL; first line of the message only
        text = str(exc).strip().splitlines()
        print(f"Status: FAILED (database error: {text[0] if text else type(exc).__name__})", file=sys.stderr)
        return 1
    print(f"Release: {stats.release_key} ({'new' if stats.release_created else 'already existed'})")
    print(f"Inserted observations: {stats.inserted}")
    print(f"Updated observations: {stats.updated}")
    print(f"Unchanged observations: {stats.unchanged}")
    print(f"Skipped missing values: {stats.skipped_missing}")
    print("Status: SUCCESS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# Adapter so pipeline.ingest.history can load CPI year by year (one release per year).
INGESTER = Ingester(
    name="CPI",
    prog="python -m pipeline.ingest.cpi",
    doc=__doc__ or "",
    add_args=lambda p: p.add_argument("--series", choices=("Current", "Back"), default="Current"),
    first_year=lambda a: FIRST_YEARS[a.series],
    header=lambda a: [
        f"CPI series: {a.series}",
        f"Base year: {BASE_YEAR}",
        f"Coverage: {STATE} / {SECTOR} / {DIVISION}",
    ],
    fetch_year=lambda client, year, delay, a: fetch_year(client, year, delay_s=delay, series_name=a.series),
    validate=lambda raws, s, e, a: validate_records(raws, s, e, a.series),
    summary=lambda recs, a: [
        f"Period range: {recs[0].period} to {recs[-1].period}",
        f"Missing index values: {sum(r.index is None for r in recs)}",
        f"Missing inflation values: {sum(r.inflation is None for r in recs)}",
    ],
    store=lambda conn, recs, s, e, at, a: store_cpi(
        conn, recs, start_year=s, end_year=e, retrieved_at=at, series_name=a.series
    ),
    key_prefix=lambda s, e, a: f"mospi-cpi2024-{a.series.lower()}-{s}-{e}-",
)
