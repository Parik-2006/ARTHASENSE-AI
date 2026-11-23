"""Read-only reproduction of stored forecasting runs: refits every run in memory and diffs it with the DB.

    ARTHASENSE_DATABASE_URL=<local db> python tools/forecast_reproduce.py > reproduce.json


The session is forced read-only (default_transaction_read_only=on), so any accidental write fails.
"""

from __future__ import annotations

import json
import os
import sys

import psycopg

sys.path.insert(0, os.environ.get("REPO") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.forecasting.experiments import (  # noqa: E402
    FUTURE_HORIZON,
    FUTURE_MODELS,
    LINKED_SUITES,
    SUITES,
    dataset_fingerprint,
    forecast_record,
    load_training,
    suite_records,
    target_code,
)

url = os.environ["ARTHASENSE_DATABASE_URL"]


def _all_fps(conn: psycopg.Connection, code: str) -> list[str]:
    """Stored dataset fingerprints of the current-series runs (original behaviour); linked runs excluded."""
    return [
        r[0]
        for r in conn.execute(
            "select distinct fr.dataset_fingerprint from forecast_runs fr join series s on s.id=fr.series_id"
            " where s.code=%s and not (fr.configuration ? 'training_data')",
            (code,),
        )
    ]


out: dict = {"indicators": {}}
with psycopg.connect(url, options="-c default_transaction_read_only=on") as conn:
    assert conn.execute("show default_transaction_read_only").fetchone()[0] == "on"
    # (key, indicator, training history, suites); "cpi_linked" = CPI on the official linked history
    for key, ind, history, suites in (
        ("cpi", "cpi", "current", SUITES),
        ("wpi", "wpi", "current", SUITES),
        ("iip", "iip", "current", SUITES),
        ("cpi_linked", "cpi", "linked", LINKED_SUITES),
    ):
        rep: dict = {"history": history}
        ts = load_training(conn, ind, history)
        fp = dataset_fingerprint(ts)
        rep["n_obs"] = len(ts)
        rep["span"] = [str(ts.periods[0]), str(ts.periods[-1])]
        rep["current_fingerprint"] = fp
        stored = {
            eid: (rid, st, kind)
            for eid, rid, st, kind in conn.execute(
                "select fr.experiment_id, fr.id, fr.status, fr.kind from forecast_runs fr"
                " join series s on s.id=fr.series_id where s.code=%s and fr.dataset_fingerprint = any(%s)",
                (target_code(ts), [fp] if history == "linked" else _all_fps(conn, target_code(ts))),
            )
        }
        rep["stored_runs"] = len(stored)
        recs = []
        for name in suites:
            recs += suite_records(ts, ind, name)
        for mid in FUTURE_MODELS:
            try:
                recs.append(forecast_record(ts, ind, mid, FUTURE_HORIZON))
            except ValueError as exc:
                rep.setdefault("future_refused", []).append(f"{mid}: {exc}")
        matched, missing, metric_diffs, row_diffs, status_diffs = 0, [], [], [], []
        max_point_diff = 0.0
        max_metric_diff = 0.0
        for r in recs:
            if r.experiment_id not in stored:
                missing.append(f"{r.kind} {r.model_id} h={r.horizon} status={r.status}")
                continue
            rid, st, _ = stored[r.experiment_id]
            matched += 1
            if st != r.status:
                status_diffs.append((rid, st, r.status))
            db_scores = dict(
                conn.execute("select metric, metric_value from scores where run_id=%s", (rid,)).fetchall()
            )
            for k, v in r.metrics.items():
                d = abs(float(db_scores.get(k, float("nan"))) - v["value"])
                max_metric_diff = max(max_metric_diff, d)
                if not d < 1e-6:
                    metric_diffs.append((rid, k, float(db_scores.get(k, float("nan"))), v["value"]))
            if set(db_scores) != set(r.metrics):
                metric_diffs.append((rid, "metric-set", sorted(db_scores), sorted(r.metrics)))
            db_rows = conn.execute(
                "select origin_date, target_date, point_forecast, lower_80, upper_80, lower_95, upper_95"
                " from forecasts where run_id=%s order by origin_date, target_date",
                (rid,),
            ).fetchall()
            mine = sorted(r.rows, key=lambda x: (x["origin_date"], x["target_date"]))
            if len(db_rows) != len(mine):
                row_diffs.append((rid, "row-count", len(db_rows), len(mine)))
                continue
            for a, b in zip(db_rows, mine, strict=True):
                if (a[0], a[1]) != (b["origin_date"], b["target_date"]):
                    row_diffs.append((rid, "dates", str(a[:2]), str((b["origin_date"], b["target_date"]))))
                    break
                mine_vals = (b["point"], b["lower_80"], b["upper_80"], b["lower_95"], b["upper_95"])
                for x, y in zip(a[2:], mine_vals, strict=True):
                    if x is None and y is None:
                        continue
                    if (x is None) != (y is None):
                        row_diffs.append((rid, "null-mismatch"))
                        break
                    max_point_diff = max(max_point_diff, abs(float(x) - y))
        rep.update(
            recomputed=len(recs),
            matched_by_experiment_id=matched,
            not_in_db=missing,
            status_diffs=status_diffs,
            metric_diffs=metric_diffs[:20],
            n_metric_diffs=len(metric_diffs),
            row_diffs=row_diffs[:20],
            n_row_diffs=len(row_diffs),
            max_abs_forecast_value_diff=max_point_diff,
            max_abs_metric_diff=max_metric_diff,
            completed_recomputed=sum(1 for r in recs if r.status == "completed"),
        )
        out["indicators"][key] = rep
print(json.dumps(out, indent=1, default=str))
