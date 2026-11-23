"""Store experiment runs in forecast_runs / forecasts / scores (migration 0002).

* Idempotent: a run is identified by its deterministic experiment_id. Storing the same experiment
  again does nothing (it is never overwritten); changed data or settings give a new id.
* One transaction per run: all rows or none.
* Source observations are only read, never written.
"""

from __future__ import annotations

import math
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from pipeline.forecasting.experiments import RunRecord


def _num(v: float | None) -> float | None:
    if v is None:
        return None
    if not math.isfinite(v):
        raise ValueError("refusing to store NaN/infinity")
    return float(v)


def store_run(conn: psycopg.Connection, rec: RunRecord) -> tuple[str, int]:
    """Returns ('stored'|'exists', run_id)."""
    with conn.transaction():
        row = conn.execute(
            "SELECT id FROM forecast_runs WHERE experiment_id = %s", (rec.experiment_id,)
        ).fetchone()
        if row:
            return "exists", row[0]
        code = (
            rec.target_series_code or rec.series_code
        )  # a composite history is stored against its target series
        sid = conn.execute("SELECT id FROM series WHERE code = %s", (code,)).fetchone()
        if sid is None:
            raise ValueError(f"series {code!r} is not in the database")
        run_id = conn.execute(
            """INSERT INTO forecast_runs
                 (series_id, model_name, model_version, training_cutoff, horizon, configuration,
                  experiment_id, kind, status, error, random_seed, dataset_fingerprint, origins_fingerprint,
                  snapshot_policy, training_start, n_origins, runtime_seconds, suite)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (sid[0], rec.model_id, rec.model_version, rec.training_cutoff, rec.horizon, Jsonb(rec.config),
             rec.experiment_id, rec.kind, rec.status, rec.error, rec.seed, rec.dataset_fingerprint,
             rec.origins_fingerprint, rec.snapshot_policy, rec.training_start, rec.n_origins,
             _num(rec.runtime_seconds), rec.suite),
        ).fetchone()[0]  # fmt: skip
        for r in rec.rows:
            conn.execute(
                """INSERT INTO forecasts
                     (run_id, target_date, point_forecast, origin_date, step, actual_value,
                      lower_80, upper_80, lower_95, upper_95, interval_method)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (run_id, r["target_date"], _num(r["point"]), r["origin_date"], r["step"], _num(r["actual"]),
                 _num(r.get("lower_80")), _num(r.get("upper_80")), _num(r.get("lower_95")),
                 _num(r.get("upper_95")), r.get("interval_method")),
            )  # fmt: skip
        for name, m in rec.metrics.items():
            conn.execute(
                "INSERT INTO scores (run_id, metric, metric_value, evaluation_start, evaluation_end, n_samples, note)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (run_id, name, _num(m["value"]), rec.rows[0]["target_date"] if rec.rows else None,
                 rec.rows[-1]["target_date"] if rec.rows else None, m["n"], m.get("note")),
            )  # fmt: skip
    return "stored", run_id


def count_runs(conn: psycopg.Connection) -> dict[str, Any]:
    return {
        "runs": conn.execute("SELECT count(*) FROM forecast_runs").fetchone()[0],
        "forecasts": conn.execute("SELECT count(*) FROM forecasts").fetchone()[0],
        "scores": conn.execute("SELECT count(*) FROM scores").fetchone()[0],
    }
