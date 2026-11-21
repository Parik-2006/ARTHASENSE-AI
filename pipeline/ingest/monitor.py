"""Check the official source for new or revised releases (and optionally store them).

    python -m pipeline.ingest.monitor                      # DRY RUN: prints a JSON report, writes nothing
    python -m pipeline.ingest.monitor --apply              # stores new / revised snapshots (local DB only)
    python -m pipeline.ingest.monitor --only wpi:2011-12   # one target

Safe by default:
  * Dry run is the default and opens a READ ONLY connection.
  * --apply refuses non-local database hosts unless --allow-host names them (see pipeline.ingest.safety).
  * One run at a time (PostgreSQL advisory lock). A second run exits with status "skipped_locked".
  * A failing source (HTTP error, changed format, failed validation) stops that target, stores nothing for
    it, and is logged. Other targets still run.
  * Revisions never overwrite: a changed value arrives as a NEW snapshot (release); older snapshots remain.
  * Nothing here is scheduled. Wire it to cron or a platform scheduler yourself (see docs/DATA-FOUNDATION.md).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import psycopg

from pipeline.ingest import cpi, iip, wpi
from pipeline.ingest.common import FetchError, ValidationError
from pipeline.ingest.config import database_url
from pipeline.ingest.preview import SeriesPreview, capture_store, preview_year
from pipeline.ingest.runner import Ingester, fetch_range, make_client
from pipeline.ingest.safety import RemoteTargetRefused, require_allowed_host
from pipeline.sources.mospi import MospiClient

LOCK_KEY = "arthasense.ingest.monitor"
LARGE_MOVE_PCT = 5.0  # a month-on-month index move beyond this is flagged for review, not rejected


@dataclass(frozen=True)
class Target:
    key: str  # e.g. "wpi:2011-12"
    indicator: str  # CPI | WPI | IIP (matches freshness_policy.indicator)
    ingester: Ingester
    argv: tuple[str, ...]  # indicator-specific options
    base_year: str
    last_year: int | None = None  # closed series (e.g. CPI Back ends in 2024) are not re-fetched beyond this


TARGETS: tuple[Target, ...] = (
    Target("cpi:current", "CPI", cpi.INGESTER, ("--series", "Current"), "2024"),
    Target("cpi:back", "CPI", cpi.INGESTER, ("--series", "Back"), "2024", last_year=2024),
    Target("wpi:2022-23", "WPI", wpi.INGESTER, ("--base-year", "2022-23"), "2022-23"),
    Target("wpi:2011-12", "WPI", wpi.INGESTER, ("--base-year", "2011-12"), "2011-12"),
    Target("iip:2022-23", "IIP", iip.INGESTER, ("--base-year", "2022-23"), "2022-23"),
    Target("iip:2011-12", "IIP", iip.INGESTER, ("--base-year", "2011-12"), "2011-12"),
)


# ---- pure logic (unit tested) ----------------------------------------------------------------


def _month_index(d: date) -> int:
    return d.year * 12 + d.month - 1


def expected_latest_period(today: date, lag_months: int, grace_days: int) -> date:
    """Newest reference month we should already be able to see. A grace period allows for publication
    day-of-month, so we do not flag data as late on the day before it is normally released."""
    ref = today - timedelta(days=grace_days)
    n = _month_index(ref) - lag_months
    return date(n // 12, n % 12 + 1, 1)


def freshness(latest: date | None, today: date, lag_months: int, grace_days: int) -> dict[str, Any]:
    exp = expected_latest_period(today, lag_months, grace_days)
    if latest is None:
        return {
            "status": "no_data",
            "latest_period": None,
            "expected_period": exp.isoformat(),
            "months_behind": None,
        }
    behind = max(0, _month_index(exp) - _month_index(latest))
    return {
        "status": "stale" if behind else "current",
        "latest_period": latest.isoformat(),
        "expected_period": exp.isoformat(),
        "months_behind": behind,
    }


def quality_checks(sp: SeriesPreview, values: dict[date, Decimal]) -> list[dict[str, str]]:
    """Checks on one fetched series. Returns [{name,status,message}] (status pass|warn|fail)."""
    out: list[dict[str, str]] = []

    def add(name: str, ok: bool, msg_ok: str, msg_bad: str, bad: str = "warn") -> None:
        out.append({"name": name, "status": "pass" if ok else bad, "message": msg_ok if ok else msg_bad})

    add(
        "no_duplicate_periods",
        not sp.duplicates,
        "no duplicate months",
        f"duplicate months: {len(sp.duplicates)}",
        "fail",
    )
    add(
        "periods_normalised",
        not sp.problems,
        "all periods are first-of-month",
        "; ".join(sp.problems),
        "fail",
    )
    add(
        "no_missing_months_in_span",
        not sp.missing_months,
        "no gaps between first and last month",
        f"{len(sp.missing_months)} missing month(s): "
        + ", ".join(f"{m:%Y-%m}" for m in sp.missing_months[:6]),
    )
    add(
        "no_revisions_vs_stored",
        not sp.revised,
        "matches stored values",
        f"{len(sp.revised)} value(s) differ from stored",
    )
    jumps = []
    # Month-on-month change is only meaningful for index levels, never for rates (inflation, growth).
    for p in sorted(values) if sp.code.endswith(".index") else []:
        prev = date(p.year - 1, 12, 1) if p.month == 1 else date(p.year, p.month - 1, 1)
        if prev in values and values[prev] not in (0, None):
            pct = (float(values[p]) / float(values[prev]) - 1) * 100
            if abs(pct) > LARGE_MOVE_PCT:
                jumps.append(f"{p:%Y-%m} {pct:+.1f}%")
    add(
        "no_extreme_monthly_moves",
        not jumps,
        f"no month-on-month move above {LARGE_MOVE_PCT:.0f}%",
        "review: " + ", ".join(jumps[:5]),
    )
    return out


# ---- orchestration ---------------------------------------------------------------------------


def _args_for(t: Target, delay: float) -> argparse.Namespace:
    p = argparse.ArgumentParser()
    t.ingester.add_args(p)
    ns = p.parse_args(list(t.argv))
    ns.delay = delay
    return ns


def check_target(
    t: Target, client: MospiClient, conn: psycopg.Connection, years: list[int], delay: float, apply: bool
) -> dict[str, Any]:
    """Compare (and optionally store) the given calendar years for one target. Raises nothing for source
    failures: they are returned in the report so one broken source never hides the others."""
    args = _args_for(t, delay)
    report: dict[str, Any] = {
        "target": t.key, "indicator": t.indicator, "base_year": t.base_year,
        "years": years, "fetched": 0, "new": 0, "unchanged": 0, "revised": 0, "rejected": 0,
        "stored_snapshots": [], "checks": [], "failures": [],
    }  # fmt: skip
    first_year = t.ingester.first_year(args)
    for i, year in enumerate(
        y for y in years if y >= first_year and (t.last_year is None or y <= t.last_year)
    ):
        if i:
            time.sleep(delay)
        try:
            records, _, at = fetch_range(t.ingester, client, year, year, delay, args)
            cap = capture_store(t.ingester, records, year, at, args)
        except (FetchError, ValidationError) as exc:
            report["rejected"] += 1
            report["failures"].append(f"{year}: {exc}")
            continue
        previews = preview_year(conn, cap)
        for sp in previews:
            vals = {p: v for c, p, v in cap.observations if c == sp.code and v is not None}
            report["fetched"] += sp.fetched
            report["new"] += len(sp.new)
            report["unchanged"] += sp.unchanged
            report["revised"] += len(sp.revised)
            report["checks"] += [{"series": sp.code, "year": year, **c} for c in quality_checks(sp, vals)]
            report.setdefault("revisions", []).extend(
                {"series": sp.code, "period": f"{p:%Y-%m}", "stored": str(old), "fetched": str(new)}
                for p, old, new in sp.revised
            )
        if apply and any(sp.new or sp.revised for sp in previews):
            stats = t.ingester.store(conn, records, year, year, at, args)
            report["stored_snapshots"].append(stats.release_key)
    return report


def latest_periods(conn: psycopg.Connection, indicator: str) -> date | None:
    """Newest stored reference month across the indicator's series (a freshness input)."""
    row = conn.execute(
        "SELECT max(o.period_date) FROM observations o JOIN series s ON s.id = o.series_id "
        "WHERE s.indicator = %s",
        (indicator,),
    ).fetchone()
    return row[0]


def run(argv: list[str] | None = None, client: MospiClient | None = None, today: date | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.ingest.monitor", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    p.add_argument("--apply", action="store_true", help="store new/revised snapshots (default: dry run)")
    p.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="TARGET",
        help=f"one of: {', '.join(t.key for t in TARGETS)}",
    )
    p.add_argument(
        "--years-back", type=int, default=1, help="also re-check this many previous years (revisions)"
    )
    p.add_argument("--delay", type=float, default=0.5)
    p.add_argument("--trigger", choices=("manual", "scheduled"), default="manual")
    p.add_argument("--allow-host", default=None)
    a = p.parse_args(argv)

    unknown = [k for k in a.only if k not in {t.key for t in TARGETS}]
    if unknown or a.years_back < 0 or a.years_back > 5:
        print(f"Error: unknown target(s) {unknown} or --years-back outside 0..5", file=sys.stderr)
        return 2
    url = database_url()
    if not url:
        print("Error: ARTHASENSE_DATABASE_URL is not set (see .env.example)", file=sys.stderr)
        return 2
    try:
        host = require_allowed_host(url, a.allow_host)
    except RemoteTargetRefused as exc:
        print(str(exc), file=sys.stderr)
        return 2

    today = today or datetime.now(UTC).date()
    years = list(range(today.year - a.years_back, today.year + 1))
    targets = [t for t in TARGETS if not a.only or t.key in a.only]
    own = client is None
    mospi = client or make_client()
    summary: dict[str, Any] = {
        "mode": "apply" if a.apply else "dry_run", "database_host": host,
        "started_at": datetime.now(UTC).isoformat(timespec="seconds"), "targets": [], "freshness": {},
    }  # fmt: skip
    exit_code = 0
    try:
        with psycopg.connect(url, connect_timeout=5, autocommit=True) as lock_conn:
            if a.apply:
                got = lock_conn.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (LOCK_KEY,)).fetchone()[
                    0
                ]
                if not got:
                    print(json.dumps({**summary, "status": "skipped_locked"}, indent=2))
                    print("Another monitor run holds the lock; skipping.", file=sys.stderr)
                    return 3
            try:
                with psycopg.connect(url, connect_timeout=5) as conn:
                    conn.read_only = not a.apply
                    for t in targets:
                        # Run logging uses the autocommit connection, so a failed or rolled-back data
                        # transaction can never erase the record that the run happened.
                        run_id = _log_start(lock_conn, t, a, years) if a.apply else None
                        try:
                            rep = check_target(t, mospi, conn, years, a.delay, a.apply)
                            status = (
                                "failed"
                                if rep["failures"] and not rep["fetched"]
                                else ("success" if rep["stored_snapshots"] else "no_change")
                            )
                            if rep["failures"]:
                                exit_code = 1
                            if a.apply:
                                conn.commit()
                                _log_finish(lock_conn, run_id, status, rep)
                            else:
                                conn.rollback()
                        except Exception as exc:  # noqa: BLE001 - one broken target must not stop the others
                            conn.rollback()
                            text = str(exc).strip().splitlines()
                            rep = {
                                "target": t.key,
                                "failures": [f"{type(exc).__name__}: {text[0] if text else 'no detail'}"],
                            }
                            exit_code = 1
                            if a.apply:
                                _log_finish(lock_conn, run_id, "failed", rep)
                        summary["targets"].append(rep)
                    rows = conn.execute(
                        "SELECT indicator, expected_lag_months, grace_days FROM freshness_policy"
                    ).fetchall()
                    pol = {r[0]: (r[1], r[2]) for r in rows}
                    for ind, (lag, grace) in pol.items():
                        summary["freshness"][ind] = freshness(latest_periods(conn, ind), today, lag, grace)
                    conn.rollback()
            finally:
                if a.apply:
                    lock_conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", (LOCK_KEY,))
    except psycopg.Error as exc:
        print(f"Database error: {str(exc).splitlines()[0]}", file=sys.stderr)
        return 1
    finally:
        if own:
            mospi.close()
    summary["finished_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    summary["stale"] = sorted(k for k, v in summary["freshness"].items() if v["status"] != "current")
    print(json.dumps(summary, indent=2, default=str))
    return exit_code


def _log_start(conn: psycopg.Connection, t: Target, a: argparse.Namespace, years: list[int]) -> int:
    row = conn.execute(
        """INSERT INTO ingestion_runs (indicator, mode, trigger, base_year, year_from, year_to)
           VALUES (%s, 'apply', %s, %s, %s, %s) RETURNING id""",
        (t.key, a.trigger, t.base_year, years[0], years[-1]),
    ).fetchone()
    return row[0]


def _log_finish(conn: psycopg.Connection, run_id: int | None, status: str, rep: dict[str, Any]) -> None:
    if run_id is None:
        return
    conn.execute(
        """UPDATE ingestion_runs SET status = %s, finished_at = now(), records_fetched = %s, rows_new = %s,
               rows_unchanged = %s, rows_revised = %s, rows_rejected = %s, error = %s, details = %s
         WHERE id = %s""",
        (
            status, rep.get("fetched"), rep.get("new"), rep.get("unchanged"), rep.get("revised"),
            rep.get("rejected"), "; ".join(rep.get("failures", []))[:2000] or None,
            json.dumps({"stored_snapshots": rep.get("stored_snapshots", [])}),
            run_id,
        ),
    )  # fmt: skip
    for c in rep.get("checks", []):
        conn.execute(
            """INSERT INTO quality_checks (run_id, series_id, check_name, status, message, details)
               VALUES (%s, (SELECT id FROM series WHERE code = %s), %s, %s, %s, %s)""",
            (run_id, c["series"], c["name"], c["status"], c["message"], json.dumps({"year": c["year"]})),
        )


if __name__ == "__main__":
    raise SystemExit(run())
