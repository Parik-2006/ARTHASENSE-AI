"""Generic CLI for one indicator: MoSPI API -> validation -> (optionally) PostgreSQL.

An indicator plugs in by providing an `Ingester` (see wpi.py, iip.py, cpi.py). The same Ingester
is reused by pipeline.ingest.history for bounded, resumable multi-year loads.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
import psycopg

from pipeline.ingest.common import FetchError, PagedResult, ValidationError, resolve_years
from pipeline.ingest.config import database_url
from pipeline.ingest.safety import RemoteTargetRefused, require_allowed_host
from pipeline.ingest.store_common import IngestStats
from pipeline.sources.mospi import USER_AGENT, MospiClient


@dataclass(frozen=True)
class Ingester:
    name: str  # e.g. "WPI"
    prog: str  # e.g. "python -m pipeline.ingest.wpi"
    doc: str
    add_args: Callable[[argparse.ArgumentParser], None]
    first_year: Callable[[argparse.Namespace], int]
    header: Callable[[argparse.Namespace], list[str]]
    fetch_year: Callable[[MospiClient, int, float, argparse.Namespace], PagedResult]
    validate: Callable[[list[dict[str, Any]], int, int, argparse.Namespace], list[Any]]
    summary: Callable[[list[Any], argparse.Namespace], list[str]]
    store: Callable[[psycopg.Connection, list[Any], int, int, datetime, argparse.Namespace], IngestStats]
    key_prefix: Callable[[int, int, argparse.Namespace], str]
    source_code: str = "mospi"


def build_parser(ing: Ingester) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog=ing.prog, description=ing.doc, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--year", type=int, help="a single calendar year, e.g. 2025")
    p.add_argument("--start-year", type=int, help="first year of a range (use with --end-year)")
    p.add_argument("--end-year", type=int, help="last year of a range (inclusive)")
    p.add_argument("--dry-run", action="store_true", help="fetch and validate only; do not touch PostgreSQL")
    p.add_argument(
        "--delay", type=float, default=0.5, help="seconds to wait between API requests (default 0.5)"
    )
    p.add_argument("--allow-host", default=None, help="comma list of DB hosts accepted (default: local only)")
    ing.add_args(p)
    return p


def fetch_range(
    ing: Ingester, client: MospiClient, start: int, end: int, delay_s: float, args: argparse.Namespace
) -> tuple[list[Any], int, datetime]:
    """Fetch year by year, validate everything together. Returns (records, raw count, first retrieval)."""
    raw: list[dict[str, Any]] = []
    retrieved_at: datetime | None = None
    for i, year in enumerate(range(start, end + 1)):
        if i:
            time.sleep(delay_s)
        result = ing.fetch_year(client, year, delay_s, args)
        if not result.records:
            raise FetchError(f"MoSPI returned no records for {year}")
        retrieved_at = retrieved_at or result.retrieved_at
        raw.extend(result.records)
    return ing.validate(raw, start, end, args), len(raw), retrieved_at or datetime.now(UTC)


def make_client() -> MospiClient:
    return MospiClient(
        httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    )


def run_cli(ing: Ingester, argv: list[str] | None = None, client: MospiClient | None = None) -> int:
    args = build_parser(ing).parse_args(argv)
    try:
        if args.delay < 0:
            raise ValueError("--delay must not be negative")
        start, end = resolve_years(args.year, args.start_year, args.end_year, first_year=ing.first_year(args))
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    print(f"ArthaSense AI - {ing.name} Ingestion")
    print("Source: MoSPI")
    for line in ing.header(args):
        print(line)
    print(f"Requested year: {start if start == end else f'{start}-{end}'}")

    url = None
    if not args.dry_run:
        url = database_url()
        if not url:
            print("Error: ARTHASENSE_DATABASE_URL is not set (see .env.example)", file=sys.stderr)
            return 2
        try:
            require_allowed_host(url, args.allow_host)
        except RemoteTargetRefused as exc:
            print(str(exc), file=sys.stderr)
            return 2

    own_client = client is None
    mospi = client or make_client()
    try:
        records, fetched, retrieved_at = fetch_range(ing, mospi, start, end, args.delay, args)
    except (FetchError, ValidationError) as exc:
        print(f"Status: FAILED ({exc})", file=sys.stderr)
        return 1
    finally:
        if own_client:
            mospi.close()

    print(f"Fetched records: {fetched}")
    print(f"Validated records: {len(records)}")
    for line in ing.summary(records, args):
        print(line)

    if args.dry_run:
        print("Database: not touched (dry run)")
        print("Status: SUCCESS (dry run)")
        return 0
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            stats = ing.store(conn, records, start, end, retrieved_at, args)
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
