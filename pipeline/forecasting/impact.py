# ruff: noqa: E501
"""Read-only forecast data-impact report: which stored runs are still reproducible, which sit on an older
data vintage, and what more history would (and would not) change. Never writes and never trains.

    python -m pipeline.forecasting.impact --out reports/forecast-data-impact.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import psycopg

from pipeline.forecasting.experiments import (
    INDICATORS,
    MIN_INITIAL_TRAIN,
    dataset_fingerprint,
    load_indicator,
)
from pipeline.ingest.config import database_url
from pipeline.ingest.safety import RemoteTargetRefused, require_allowed_host

RUNS_SQL = """
SELECT fr.id, s.code, fr.model_name, fr.kind, fr.status, fr.horizon, fr.snapshot_policy,
       fr.dataset_fingerprint, fr.training_cutoff, fr.n_origins, fr.created_at
  FROM forecast_runs fr JOIN series s ON s.id = fr.series_id
 ORDER BY fr.id
"""


def evaluable_origins(n_months: int, horizon: int, initial: int = MIN_INITIAL_TRAIN) -> int:
    """Number of one-step-stride backtest origins a series of n_months allows (arithmetic, not a promise)."""
    return max(0, n_months - initial - horizon + 1)


def classify(row: tuple[Any, ...], current_fp: dict[tuple[str, str], str | None], asof_fp: str | None) -> str:
    _, _, _, _, status, _, policy, stored, _, _, _ = row
    if status != "completed":
        return "no_action_not_completed"
    if stored is None:
        return "not_reproducible_no_fingerprint"
    if current_fp.get((row[1], policy)) == stored:
        return "reproducible_on_current_data"
    if asof_fp == stored:
        return "older_vintage_reproducible_as_of_creation"
    return "not_reproducible_data_changed"


def build(conn: psycopg.Connection) -> dict[str, Any]:
    code_to_ind = {v: k for k, v in INDICATORS.items()}
    runs = conn.execute(RUNS_SQL).fetchall()
    current: dict[tuple[str, str], str | None] = {}
    series_state: dict[str, Any] = {}
    for code, ind in code_to_ind.items():
        for pol in sorted({r[6] for r in runs if r[1] == code and r[6]}):
            try:
                current[(code, pol)] = dataset_fingerprint(load_indicator(conn, ind, policy=pol))
            except Exception as exc:  # gap or loader error: report, do not hide
                current[(code, pol)] = None
                series_state.setdefault(code, {})["current_load_error"] = str(exc)[:160]
        latest = conn.execute(
            "SELECT count(DISTINCT period_date), max(period_date) FROM observations o JOIN series s ON s.id = o.series_id WHERE s.code = %s",
            (code,),
        ).fetchone()
        series_state.setdefault(code, {}).update(months_now=latest[0], latest_period=str(latest[1]))
    buckets: dict[str, Counter[str]] = defaultdict(Counter)
    off_scope = Counter()
    for row in runs:
        code = row[1]
        if code not in code_to_ind:
            off_scope[code] += 1
            continue
        asof_fp = None
        if row[6] and row[7] and current.get((code, row[6])) != row[7] and row[4] == "completed":
            try:
                asof_fp = dataset_fingerprint(
                    load_indicator(conn, code_to_ind[code], policy=row[6], as_of=row[10])
                )
            except Exception:  # noqa: BLE001
                asof_fp = None
        buckets[code][classify(row, current, asof_fp)] += 1
    horizons = (1, 3, 6, 12)
    table = {
        code: {f"h{h}": evaluable_origins(st["months_now"], h) for h in horizons}
        for code, st in series_state.items()
    }
    return {
        "runs_total": len(runs),
        "by_series": {c: dict(b) for c, b in buckets.items()},
        "runs_on_series_outside_the_forecast_registry": dict(off_scope),
        "series_state": series_state,
        "origins_upper_bound_now": table,
        "origins_upper_bound_if_cpi_had_166_months": {f"h{h}": evaluable_origins(166, h) for h in horizons},
        "upper_bound_note": (
            "Upper bounds from n - 12 - h + 1. Real models need more initial training than 12 months: the stored "
            "CPI runs recorded 0 usable origins and were skipped ('at least 5 needed'). Do not read these as promises."
        ),
        "note": (
            "More history makes more backtest origins possible; it does not by itself improve accuracy. A CPI "
            "series that joins Back and Current is a separate, approval-gated decision."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.forecasting.impact")
    p.add_argument("--out", type=Path)
    p.add_argument("--allow-host", default=None)
    a = p.parse_args(argv)
    url = database_url()
    if not url:
        print("Error: ARTHASENSE_DATABASE_URL is not set", file=sys.stderr)
        return 2
    try:
        require_allowed_host(url, a.allow_host)
    except RemoteTargetRefused as exc:
        print(str(exc), file=sys.stderr)
        return 2
    with psycopg.connect(url, connect_timeout=5) as conn:
        conn.read_only = True
        report = build(conn)
    text = json.dumps(report, indent=1, default=str) + "\n"
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text, encoding="utf-8")
        print(f"Wrote {a.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
