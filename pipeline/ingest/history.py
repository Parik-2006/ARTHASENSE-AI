"""Bounded, resumable multi-year ingestion for CPI, WPI and IIP.

    python -m pipeline.ingest.history wpi --start-year 2023 --end-year 2026 --dry-run
    python -m pipeline.ingest.history iip --start-year 2023 --end-year 2026 --resume
    python -m pipeline.ingest.history cpi --series Back --start-year 2013 --end-year 2024 --resume

Loads ONE YEAR AT A TIME. Each year is fetched, validated and stored in its own transaction as its
own release, so a failure never leaves a half-written year. Years already stored are skipped with
--resume, and re-running is idempotent. Nothing is downloaded unless you give an explicit range.
Extra options (--base-year, --sectors, --series) are the same as for the single-indicator commands.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime

import psycopg

from pipeline.ingest import cpi, iip, wpi
from pipeline.ingest.common import FetchError, ValidationError
from pipeline.ingest.config import database_url
from pipeline.ingest.runner import Ingester, fetch_range, make_client
from pipeline.ingest.store_common import release_exists
from pipeline.sources.mospi import MospiClient

INGESTERS: dict[str, Ingester] = {"cpi": cpi.INGESTER, "wpi": wpi.INGESTER, "iip": iip.INGESTER}
MAX_HISTORY_YEARS = 20


def run(argv: list[str] | None = None, client: MospiClient | None = None) -> int:
    top = argparse.ArgumentParser(prog="python -m pipeline.ingest.history", description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    top.add_argument("indicator", choices=sorted(INGESTERS))
    first, rest = top.parse_known_args(argv)
    ing = INGESTERS[first.indicator]
    p = argparse.ArgumentParser(prog=f"history {first.indicator}")
    p.add_argument("--start-year", type=int, required=True)
    p.add_argument("--end-year", type=int, required=True)
    p.add_argument("--dry-run", action="store_true", help="fetch and validate every year; DB untouched")
    p.add_argument("--resume", action="store_true", help="skip years whose snapshot is already stored")
    p.add_argument("--delay", type=float, default=0.5)
    ing.add_args(p)
    a = p.parse_args(rest)

    last = datetime.now(UTC).year
    lo = ing.first_year(a)
    if not (lo <= a.start_year <= a.end_year <= last):
        print(f"Error: years must satisfy {lo} <= start <= end <= {last}", file=sys.stderr)
        return 2
    if a.end_year - a.start_year + 1 > MAX_HISTORY_YEARS:
        print(f"Error: at most {MAX_HISTORY_YEARS} years per run", file=sys.stderr)
        return 2
    url = None
    if not a.dry_run:
        url = database_url()
        if not url:
            print("Error: ARTHASENSE_DATABASE_URL is not set (see .env.example)", file=sys.stderr)
            return 2

    print(
        f"ArthaSense AI - {ing.name} history {a.start_year}-{a.end_year}"
        + ("  [dry run]" if a.dry_run else "")
    )
    for line in ing.header(a):
        print(line)
    own = client is None
    mospi = client or make_client()
    done = skipped = 0
    try:
        for year in range(a.start_year, a.end_year + 1):
            if a.resume and url:
                with psycopg.connect(url, connect_timeout=5) as conn:
                    if release_exists(conn, ing.source_code, ing.key_prefix(year, year, a)):
                        print(f"{year}: skipped (already stored)")
                        skipped += 1
                        continue
            if done or skipped:
                time.sleep(a.delay)
            try:
                records, fetched, at = fetch_range(ing, mospi, year, year, a.delay, a)
                line = f"{year}: fetched {fetched}, validated {len(records)}"
                if a.dry_run:
                    print(line + " (dry run)")
                else:
                    with psycopg.connect(url, connect_timeout=5) as conn:
                        st = ing.store(conn, records, year, year, at, a)
                    counts = f"inserted {st.inserted}, unchanged {st.unchanged}"
                    print(f"{line}, {counts}, skipped missing {st.skipped_missing}")
                done += 1
            except (FetchError, ValidationError) as exc:
                print(f"{year}: FAILED ({exc})", file=sys.stderr)
                print(
                    f"Status: FAILED after {done} year(s) done; re-run with --resume to continue",
                    file=sys.stderr,
                )
                return 1
            except psycopg.Error as exc:
                text = str(exc).strip().splitlines()
                print(f"{year}: FAILED (database error: {text[0] if text else 'unknown'})", file=sys.stderr)
                return 1
    finally:
        if own:
            mospi.close()
    print(f"Years processed: {done}, skipped: {skipped}")
    print("Status: SUCCESS" + (" (dry run)" if a.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
