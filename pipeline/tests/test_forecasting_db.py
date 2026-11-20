"""Persistence tests (need ARTHASENSE_TEST_DATABASE_URL: a throwaway database named *test*)."""

from datetime import UTC, date, datetime
from decimal import Decimal

import numpy as np
import psycopg
import pytest

from pipeline.forecasting.experiments import backtest_records, forecast_record, load_indicator
from pipeline.forecasting.persistence import count_runs, store_run
from pipeline.ingest.wpi import store_wpi
from pipeline.ingest.wpi_records import WpiRecord

pytestmark = pytest.mark.integration
NOW = datetime(2026, 1, 5, tzinfo=UTC)


def seed(url, n=40):
    rng = np.random.default_rng(0)
    vals = 100 + np.cumsum(rng.normal(0.3, 1.0, n))
    base = 2023 * 12 + 3  # Apr 2023
    recs = [
        WpiRecord(date((base + k) // 12, (base + k) % 12 + 1, 1), Decimal(f"{v:.1f}"))
        for k, v in enumerate(vals)
    ]
    with psycopg.connect(url) as conn:
        for year in sorted({r.period.year for r in recs}):
            part = [r for r in recs if r.period.year == year]
            store_wpi(conn, part, start_year=year, end_year=year, retrieved_at=NOW)


def source_snapshot(conn):
    return conn.execute("SELECT count(*), coalesce(sum(value),0) FROM observations").fetchone()


def test_store_backtest_is_idempotent_and_never_touches_observations(migrated_db_url):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        before = source_snapshot(conn)
        ts = load_indicator(conn, "wpi")
        recs = backtest_records(ts, "wpi", "ets", (1, 3), initial_train=18, suite="t")
        assert all(r.status == "completed" for r in recs)
        states = [store_run(conn, r)[0] for r in recs]
        assert states == ["stored", "stored"]
        first = count_runs(conn)
        assert first["runs"] == 2 and first["forecasts"] > 0 and first["scores"] > 0
        again = [store_run(conn, r)[0] for r in recs]  # same experiment ids
        assert again == ["exists", "exists"] and count_runs(conn) == first
        assert source_snapshot(conn) == before  # government observations untouched


def test_run_rows_carry_provenance_and_unique_targets(migrated_db_url):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        ts = load_indicator(conn, "wpi")
        rec = backtest_records(ts, "wpi", "naive", (3,), initial_train=18)[0]
        _, run_id = store_run(conn, rec)
        run = conn.execute(
            "SELECT kind, status, horizon, dataset_fingerprint, origins_fingerprint, snapshot_policy, random_seed,"
            " n_origins, model_name FROM forecast_runs WHERE id=%s", (run_id,)
        ).fetchone()  # fmt: skip
        assert run[:3] == ("backtest", "completed", 3) and run[3] == rec.dataset_fingerprint
        assert run[4] == rec.origins_fingerprint and run[5] == "latest" and run[6] == 0 and run[8] == "naive"
        rows = conn.execute(
            "SELECT origin_date, target_date, step, actual_value FROM forecasts WHERE run_id=%s", (run_id,)
        ).fetchall()
        assert len(rows) == rec.n_origins and all(r[2] == 3 for r in rows)
        assert len({r[1] for r in rows}) == len(rows)  # (run, target) unique
        # actuals stored for a backtest equal the stored government observation for that month
        obs = dict(conn.execute("SELECT period_date, value FROM observations").fetchall())
        assert all(Decimal(str(r[3])) == obs[r[1]] for r in rows)


def test_future_forecast_is_stored_as_kind_forecast_without_actuals(migrated_db_url):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        ts = load_indicator(conn, "wpi")
        _, run_id = store_run(conn, forecast_record(ts, "wpi", "ets", 3))
        kind, n = conn.execute(
            "SELECT kind, (SELECT count(*) FROM forecasts WHERE run_id=%s) FROM forecast_runs WHERE id=%s",
            (run_id, run_id),
        ).fetchone()
        assert kind == "forecast" and n == 3
        assert (
            conn.execute(
                "SELECT count(*) FROM forecasts WHERE run_id=%s AND actual_value IS NOT NULL", (run_id,)
            ).fetchone()[0]
            == 0
        )


def test_failed_store_rolls_back_the_whole_run(migrated_db_url, monkeypatch):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        ts = load_indicator(conn, "wpi")
        rec = backtest_records(ts, "wpi", "naive", (1,), initial_train=18)[0]
        rec.metrics["mae"]["value"] = float("nan")  # poison the last-written table
        with pytest.raises(ValueError, match="NaN"):
            store_run(conn, rec)
        assert count_runs(conn) == {"runs": 0, "forecasts": 0, "scores": 0}  # nothing half-written


def test_database_rejects_invalid_numbers_and_intervals(migrated_db_url):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url, autocommit=True) as conn:
        sid = conn.execute("SELECT id FROM series LIMIT 1").fetchone()[0]
        run = conn.execute(
            "INSERT INTO forecast_runs (series_id, model_name, training_cutoff, horizon) VALUES (%s,'x','2026-01-01',1) RETURNING id",
            (sid,),
        ).fetchone()[0]
        bad = [
            (
                "INSERT INTO forecasts (run_id, target_date, point_forecast) VALUES (%s,'2026-02-01','NaN')",
                (run,),
            ),
            (
                "INSERT INTO forecasts (run_id, target_date, point_forecast, lower_80, upper_80) VALUES (%s,'2026-02-01',1,5,2)",
                (run,),
            ),
            ("INSERT INTO scores (run_id, metric, metric_value) VALUES (%s,'mae','NaN')", (run,)),
            ("INSERT INTO scores (run_id, metric, metric_value) VALUES (%s,'mae','Infinity')", (run,)),
        ]
        for sql, params in bad:
            with pytest.raises(psycopg.errors.CheckViolation):
                conn.execute(sql, params)
        conn.execute(
            "INSERT INTO forecasts (run_id, target_date, point_forecast) VALUES (%s,'2026-02-01',1)", (run,)
        )
        with pytest.raises(psycopg.errors.UniqueViolation):  # (run, target) is unique
            conn.execute(
                "INSERT INTO forecasts (run_id, target_date, point_forecast) VALUES (%s,'2026-02-01',2)",
                (run,),
            )


def test_skipped_runs_are_recorded_with_their_reason(migrated_db_url):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        ts = load_indicator(conn, "wpi")
        rec = backtest_records(ts, "wpi", "chronos2", (1,), initial_train=18)[0]
        _, run_id = store_run(conn, rec)
        status, error = conn.execute(
            "SELECT status, error FROM forecast_runs WHERE id=%s", (run_id,)
        ).fetchone()
        assert status == "skipped" and error.startswith("unavailable")
        assert conn.execute("SELECT count(*) FROM forecasts WHERE run_id=%s", (run_id,)).fetchone()[0] == 0
