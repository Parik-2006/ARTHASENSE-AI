# ruff: noqa: E501
"""Read-only import preview: what WOULD change if fetched official data were stored.

    python -m pipeline.ingest.preview wpi --start-year 2023 --end-year 2026
    python -m pipeline.ingest.preview iip --start-year 2023 --end-year 2026 --base-year 2022-23
    python -m pipeline.ingest.preview cpi --series Back --start-year 2013 --end-year 2024

It fetches from the MoSPI API exactly like `pipeline.ingest.history --dry-run`, then compares each
(series, month, value) with what the database already holds using a READ ONLY transaction.
No write is ever issued: the store step is intercepted before it reaches SQL, and the connection is
opened read-only, so the database refuses writes even if that interception were bypassed.

Report per series: existing rows, proposed additions, unchanged, revisions (same month, different
value), duplicate records inside the fetch, missing months inside the fetched span, base-year
mismatches, validation failures, and source evidence (endpoint URL, SHA-256, retrieval time).
Only the HOST of the target database is printed, never credentials.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from unittest import mock

import psycopg

from pipeline.ingest.common import FetchError, ValidationError
from pipeline.ingest.config import database_url
from pipeline.ingest.history import INGESTERS, MAX_HISTORY_YEARS
from pipeline.ingest.runner import fetch_range, make_client
from pipeline.ingest.store_common import IngestStats
from pipeline.sources.mospi import MospiClient

_STORE_MODULES = (
    "pipeline.ingest.wpi",
    "pipeline.ingest.iip",
    "pipeline.ingest.cpi_store",
    "pipeline.ingest.cpi_legacy",
)

LATEST_SQL = """
SELECT DISTINCT ON (o.period_date) o.period_date, o.value
  FROM observations o JOIN series s ON s.id = o.series_id JOIN releases r ON r.id = o.release_id
 WHERE s.code = %s AND o.period_date BETWEEN %s AND %s
 ORDER BY o.period_date, r.retrieved_at DESC, r.id DESC
"""


@dataclass
class SeriesPreview:
    code: str
    base_year: str
    fetched: int = 0
    new: list[date] = field(default_factory=list)
    unchanged: int = 0
    revised: list[tuple[date, Decimal, Decimal]] = field(default_factory=list)  # month, stored, fetched
    duplicates: list[date] = field(default_factory=list)
    missing_months: list[date] = field(default_factory=list)
    existing_in_span: int = 0
    problems: list[str] = field(default_factory=list)


@dataclass
class Capture:
    """What the intercepted store step would have written."""

    specs: dict[str, Any]
    observations: list[tuple]
    release_key: str
    sha256: str
    source_url: str
    retrieved_at: datetime


from pipeline.ingest.safety import host_of  # noqa: E402  (shared guard)


def capture_store(ing, records: list[Any], year: int, at: datetime, args: argparse.Namespace) -> Capture:
    """Run the indicator's own store function against a fake snapshot writer that only records."""
    captured: list[Capture] = []

    def fake_store_snapshot(conn, **kw):  # noqa: ANN001 - mirrors store_snapshot's keyword API
        captured.append(
            Capture(
                specs=kw["specs"],
                observations=list(kw["observations"]),
                release_key=kw["release_key"],
                sha256=kw["sha256"],
                source_url=kw["source_url"],
                retrieved_at=kw["retrieved_at"],
            )
        )
        return IngestStats(release_key=kw["release_key"], release_created=False)

    patches = [mock.patch(f"{m}.store_snapshot", fake_store_snapshot) for m in _STORE_MODULES]
    for p in patches:
        p.start()
    try:
        ing.store(None, records, year, year, at, args)  # conn is never touched by the fake
    finally:
        for p in patches:
            p.stop()
    if not captured:
        raise RuntimeError("store step produced no snapshot")
    return captured[0]


def _months(lo: date, hi: date) -> list[date]:
    out, y, m = [], lo.year, lo.month
    while (y, m) <= (hi.year, hi.month):
        out.append(date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def diff_series(
    code: str,
    base_year: str,
    fetched: list[tuple[date, Decimal | None]],
    stored: dict[date, Decimal],
) -> SeriesPreview:
    """Pure comparison of fetched observations against the stored latest values."""
    sp = SeriesPreview(code=code, base_year=base_year)
    seen: Counter[date] = Counter(p for p, _ in fetched)
    sp.duplicates = sorted(p for p, n in seen.items() if n > 1)
    values = {p: v for p, v in fetched if v is not None}
    sp.fetched = len(values)
    for period in sorted(values):
        if period.day != 1:
            sp.problems.append(f"{period}: not normalised to the first of the month")
        if period not in stored:
            sp.new.append(period)
        elif stored[period] == values[period]:
            sp.unchanged += 1
        else:
            sp.revised.append((period, stored[period], values[period]))
    sp.existing_in_span = len(stored)
    if values:
        have = set(values)
        sp.missing_months = [m for m in _months(min(have), max(have)) if m not in have]
    if base_year and base_year not in code:
        sp.problems.append(f"base year {base_year!r} is not part of series code {code!r}")
    return sp


def preview_year(conn: psycopg.Connection, cap: Capture) -> list[SeriesPreview]:
    by_code: dict[str, list[tuple[date, Decimal | None]]] = defaultdict(list)
    for o in cap.observations:  # (code, period, value[, source status])
        code, period, value = o[0], o[1], o[2]
        by_code[code].append((period, value))
    out = []
    for code, fetched in sorted(by_code.items()):
        spec = cap.specs[code]
        periods = [p for p, _ in fetched]
        stored = dict(conn.execute(LATEST_SQL, (code, min(periods), max(periods))).fetchall())
        out.append(diff_series(code, spec.base_year, fetched, stored))
    return out


def render(previews: list[SeriesPreview], evidence: list[Capture], failures: list[str]) -> list[str]:
    lines = ["", "IMPORT PREVIEW (read-only; nothing was written)", "=" * 60]
    for p in previews:
        lines += [
            f"Series {p.code}  [base {p.base_year}]",
            f"  fetched values: {p.fetched}   already stored in span: {p.existing_in_span}",
            f"  proposed additions: {len(p.new)}"
            + (f"  ({p.new[0]:%Y-%m} .. {p.new[-1]:%Y-%m})" if p.new else ""),
            f"  unchanged: {p.unchanged}   revisions: {len(p.revised)}   duplicates in fetch: {len(p.duplicates)}",
            f"  missing months inside fetched span: {len(p.missing_months)}"
            + (f"  ({', '.join(f'{m:%Y-%m}' for m in p.missing_months[:12])})" if p.missing_months else ""),
        ]
        for period, old, new in p.revised[:10]:
            lines.append(f"    revision {period:%Y-%m}: stored {old} -> fetched {new}")
        lines += [f"  PROBLEM: {x}" for x in p.problems]
    lines.append("Source evidence (one snapshot per fetched year):")
    lines += [f"  {c.retrieved_at:%Y-%m-%d %H:%M}Z  sha256 {c.sha256[:16]}  {c.source_url}" for c in evidence]
    lines.append(f"Validation failures: {len(failures)}")
    lines += [f"  {f}" for f in failures]
    lines.append(
        "Rollback strategy: each import is additive and keyed by a content-hash release; revert a bad "
        "import by deleting that release_key's observations and release row (never by editing old ones)."
    )
    return lines


def run(argv: list[str] | None = None, client: MospiClient | None = None) -> int:
    top = argparse.ArgumentParser(prog="python -m pipeline.ingest.preview", description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    top.add_argument("indicator", choices=sorted(INGESTERS))
    first, rest = top.parse_known_args(argv)
    ing = INGESTERS[first.indicator]
    p = argparse.ArgumentParser(prog=f"preview {first.indicator}")
    p.add_argument("--start-year", type=int, required=True)
    p.add_argument("--end-year", type=int, required=True)
    p.add_argument("--delay", type=float, default=0.5)
    p.add_argument("--allow-host", default="127.0.0.1,localhost", help="comma list of DB hosts accepted")
    ing.add_args(p)
    a = p.parse_args(rest)

    last = datetime.now(UTC).year
    lo = ing.first_year(a)
    if not (lo <= a.start_year <= a.end_year <= last) or a.end_year - a.start_year + 1 > MAX_HISTORY_YEARS:
        print(
            f"Error: need {lo} <= start <= end <= {last}, at most {MAX_HISTORY_YEARS} years", file=sys.stderr
        )
        return 2
    url = database_url()
    if not url:
        print(
            "Error: ARTHASENSE_DATABASE_URL is not set; a preview needs a database to compare with",
            file=sys.stderr,
        )
        return 2
    host = host_of(url)
    print(f"ArthaSense AI - {ing.name} import preview {a.start_year}-{a.end_year}")
    print(f"Comparing against database host: {host}")
    if host not in {h.strip() for h in a.allow_host.split(",")}:
        print(
            f"Refusing: host {host!r} is not in --allow-host. Previews default to local databases only.",
            file=sys.stderr,
        )
        return 2

    own = client is None
    mospi = client or make_client()
    evidence: list[Capture] = []
    failures: list[str] = []
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            conn.read_only = True  # the server rejects any write on this connection
            for i, year in enumerate(range(a.start_year, a.end_year + 1)):
                if i:
                    time.sleep(a.delay)
                try:
                    records, _, at = fetch_range(ing, mospi, year, year, a.delay, a)
                    cap = capture_store(ing, records, year, at, a)
                    evidence.append(cap)
                except (FetchError, ValidationError) as exc:
                    failures.append(f"{year}: {exc}")
            if evidence:
                combined = Capture(
                    specs={k: v for c in evidence for k, v in c.specs.items()},
                    observations=[o for c in evidence for o in c.observations],
                    release_key="", sha256="", source_url="", retrieved_at=evidence[0].retrieved_at,
                )  # fmt: skip
                previews = preview_year(conn, combined)
            else:
                previews = []
            conn.rollback()
    except psycopg.Error as exc:
        print(f"Database error: {str(exc).strip().splitlines()[0]}", file=sys.stderr)
        return 1
    finally:
        if own:
            mospi.close()
    for line in render(previews, evidence, failures):
        print(line)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(run())
