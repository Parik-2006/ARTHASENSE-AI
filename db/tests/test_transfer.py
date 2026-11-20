"""Tests for db.verify_target and db.transfer. Database-backed tests use a throwaway second database."""

import os
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import numpy as np
import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from db import transfer, verify_target
from db.migrate import migrate
from db.target import connection_kwargs, friendly_error, identity, same_target

NOW = datetime(2026, 1, 5, tzinfo=UTC)


# ---- pure helpers (no database) ----------------------------------------------------------------------


def test_identity_classifies_targets_and_never_exposes_user_or_password():
    pooler = identity(
        "postgresql://postgres.abcdef:Sup3rSecret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
    )
    assert pooler.kind == "supabase-pooler" and pooler.port == "6543" and pooler.database == "postgres"
    direct = identity("postgresql://postgres:Sup3rSecret@db.abcdef.supabase.co:5432/postgres")
    assert direct.kind == "supabase-direct"
    assert identity("postgresql://u:p@127.0.0.1:5432/arthasense").kind == "local"
    assert identity("postgresql://u:p@db.example.com/x").kind == "other-remote"
    for ident in (pooler, direct):
        text = str(ident) + ident.host_label
        for leaked in ("Sup3rSecret", "postgres.abcdef", "abcdef", "aws-0"):
            assert leaked not in text, leaked


def test_same_target_ignores_the_user_but_not_the_database():
    a = "postgresql://u1:p@h.example.com:5432/db1"
    assert same_target(a, "postgresql://u2:x@h.example.com:5432/db1")
    assert not same_target(a, "postgresql://u1:p@h.example.com:5432/db2")
    assert not same_target(a, "postgresql://u1:p@h.example.com:6543/db1")


def test_connection_kwargs_and_friendly_errors_match_the_api_rules():
    assert connection_kwargs("postgresql://u:p@db.example.com/x")["sslmode"] == "require"
    assert "sslmode" not in connection_kwargs("postgresql://u:p@127.0.0.1/x")
    assert connection_kwargs("postgresql://u:p@db.example.com/x")["prepare_threshold"] is None
    msg = friendly_error(
        Exception('connection to server at "2406:da14::1", port 5432 failed: Network is unreachable')
    )
    assert "IPv4 pooler" in msg and "2406" not in msg and "5432" not in msg


def test_plan_rules():
    z = transfer.TableState(0, "e")
    some = {t: transfer.TableState(2, f"h{t}") for t in transfer.ORDER}
    empty = {t: z for t in transfer.ORDER}
    assert transfer.plan(some, empty) == "copy"
    assert transfer.plan(some, dict(some)) == "in-sync"
    with pytest.raises(transfer.TransferError, match="no data to copy"):
        transfer.plan(empty, empty)
    differs = dict(some)
    differs["scores"] = transfer.TableState(2, "other")
    with pytest.raises(transfer.TransferError, match="differs"):
        transfer.plan(some, differs)
    with pytest.raises(transfer.TransferError, match="differs"):
        transfer.plan(
            some, {**empty, "sources": transfer.TableState(1, "x")}
        )  # partially filled: never merged


def test_same_source_and_target_is_refused_before_connecting():
    with pytest.raises(transfer.TransferError, match="same database"):
        transfer.run("postgresql://a:b@h/db", "postgresql://c:d@h/db", apply=True, confirm_db="db")


def test_missing_env_variable_is_a_clear_message(monkeypatch, capsys):
    monkeypatch.delenv("ARTHASENSE_TARGET_DATABASE_URL", raising=False)
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")
    with pytest.raises(SystemExit) as e:
        transfer.main([])
    assert "ARTHASENSE_TARGET_DATABASE_URL is not set" in str(e.value)


def test_verify_target_unreachable_is_friendly_and_leak_free(monkeypatch, capsys):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://someuser:topsecret@127.0.0.1:1/privatedb")
    assert verify_target.main([]) == 1
    out = capsys.readouterr().out
    assert "Connection: FAILED" in out
    for leaked in ("someuser", "topsecret", "127.0.0.1"):
        assert leaked not in out


# ---- database-backed -----------------------------------------------------------------------------------

pytestmark_db = pytest.mark.integration


def _seed(url: str) -> None:
    from pipeline.forecasting.experiments import backtest_records, forecast_record, load_indicator
    from pipeline.forecasting.persistence import store_run
    from pipeline.ingest.wpi import store_wpi
    from pipeline.ingest.wpi_records import WpiRecord

    rng = np.random.default_rng(1)
    vals = 100 + np.cumsum(rng.normal(0.3, 1.0, 40))
    base = 2023 * 12 + 3
    recs = [
        WpiRecord(date((base + k) // 12, (base + k) % 12 + 1, 1), Decimal(f"{v:.1f}"))
        for k, v in enumerate(vals)
    ]
    with psycopg.connect(url) as conn:
        for year in sorted({r.period.year for r in recs}):
            store_wpi(
                conn,
                [r for r in recs if r.period.year == year],
                start_year=year,
                end_year=year,
                retrieved_at=NOW,
            )
        ts = load_indicator(conn, "wpi")
        for rec in backtest_records(ts, "wpi", "ets", (1, 3), initial_train=18, suite="t"):
            store_run(conn, rec)
        store_run(conn, forecast_record(ts, "wpi", "ets", 3))
        store_run(conn, backtest_records(ts, "wpi", "chronos2", (1,), initial_train=18)[0])  # a skipped run


def _admin(url: str, sql: str) -> None:
    info = conninfo_to_dict(url)
    info["dbname"] = "postgres"
    with psycopg.connect(make_conninfo(**info), autocommit=True) as conn:
        conn.execute(sql)


@pytest.fixture
def pair(migrated_db_url):
    """(source_url with data, target_url: a fresh EMPTY database with the same migrations applied)."""
    _seed(migrated_db_url)
    name = f"arthasense_transfer_test_{uuid.uuid4().hex[:8]}"
    assert "test" in name
    _admin(migrated_db_url, f'CREATE DATABASE "{name}"')
    info = conninfo_to_dict(migrated_db_url)
    info["dbname"] = name
    target = make_conninfo(**info)
    migrate(target)
    yield migrated_db_url, target, name
    _admin(migrated_db_url, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def counts(url: str) -> dict[str, int]:
    with psycopg.connect(url) as c:
        return {t: c.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in transfer.ORDER}


@pytest.mark.integration
def test_dry_run_is_the_default_and_writes_nothing(pair):
    src, dst, name = pair
    out: list[str] = []
    assert transfer.run(src, dst, apply=False, confirm_db=None, out=out.append) == 0
    text = "\n".join(out)
    assert "DRY RUN" in text and "Nothing was written" in text and name in text
    assert all(n == 0 for n in counts(dst).values())


@pytest.mark.integration
def test_apply_needs_the_exact_target_database_name(pair):
    src, dst, name = pair
    for wrong in (None, "arthasense", name + "x"):
        with pytest.raises(transfer.TransferError, match="--confirm-target-db"):
            transfer.run(src, dst, apply=True, confirm_db=wrong, out=lambda *_: None)
    assert all(n == 0 for n in counts(dst).values())


@pytest.mark.integration
def test_apply_copies_everything_verifies_and_preserves_keys_and_json(pair):
    src, dst, name = pair
    out: list[str] = []
    assert transfer.run(src, dst, apply=True, confirm_db=name, out=out.append) == 0
    assert "APPLIED and verified" in "\n".join(out)
    assert (
        counts(src) == counts(dst) and counts(dst)["observations"] == 40 and counts(dst)["forecast_runs"] > 0
    )
    with psycopg.connect(src) as s, psycopg.connect(dst) as d:
        a, b = transfer.state(s), transfer.state(d)
        assert a == b  # identical content fingerprint for every table
        cfg_src = s.execute("SELECT configuration FROM forecast_runs ORDER BY id LIMIT 1").fetchone()[0]
        cfg_dst = d.execute("SELECT configuration FROM forecast_runs ORDER BY id LIMIT 1").fetchone()[0]
        assert isinstance(cfg_dst, dict) and cfg_src == cfg_dst
        # foreign keys are intact and the id sequences continue after the copied rows
        assert (
            d.execute(
                "SELECT count(*) FROM observations o LEFT JOIN series s ON s.id=o.series_id WHERE s.id IS NULL"
            ).fetchone()[0]
            == 0
        )
        mx = d.execute("SELECT max(id) FROM sources").fetchone()[0]
        new = d.execute("INSERT INTO sources (code, name) VALUES ('probe','probe') RETURNING id").fetchone()[
            0
        ]
        d.rollback()
        assert new == mx + 1


@pytest.mark.integration
def test_rerun_after_success_is_a_no_op(pair):
    src, dst, name = pair
    transfer.run(src, dst, apply=True, confirm_db=name, out=lambda *_: None)
    before = counts(dst)
    out: list[str] = []
    assert transfer.run(src, dst, apply=True, confirm_db=name, out=out.append) == 0
    assert "already holds identical data" in "\n".join(out) and counts(dst) == before


@pytest.mark.integration
def test_a_different_non_empty_target_is_never_touched(pair):
    src, dst, name = pair
    with psycopg.connect(dst) as c:
        c.execute("INSERT INTO sources (code, name) VALUES ('other', 'Other provider')")
        c.commit()
    before = counts(dst)
    with pytest.raises(transfer.TransferError, match="differs"):
        transfer.run(src, dst, apply=True, confirm_db=name, out=lambda *_: None)
    assert counts(dst) == before  # not merged, not overwritten, not deleted


@pytest.mark.integration
def test_target_without_the_latest_migration_is_refused(pair):
    src, dst, name = pair
    with psycopg.connect(dst, autocommit=True) as c:
        c.execute("DELETE FROM schema_migrations WHERE version = '0002_forecasting'")
    with pytest.raises(transfer.TransferError, match="migrations do not match"):
        transfer.run(src, dst, apply=True, confirm_db=name, out=lambda *_: None)
    assert all(n == 0 for n in counts(dst).values())


@pytest.mark.integration
def test_a_failed_verification_rolls_everything_back(pair, monkeypatch):
    src, dst, name = pair
    real = transfer.copy_all

    def lossy(s, d):
        real(s, d)
        d.execute("DELETE FROM scores")  # simulate a copy that lost rows

    monkeypatch.setattr(transfer, "copy_all", lossy)
    with pytest.raises(transfer.TransferError, match="verification failed"):
        transfer.run(src, dst, apply=True, confirm_db=name, out=lambda *_: None)
    assert all(n == 0 for n in counts(dst).values())  # all-or-nothing


@pytest.mark.integration
def test_verify_target_reports_state_without_writing_or_leaking(migrated_db_url, monkeypatch, capsys):
    _seed(migrated_db_url)
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    assert verify_target.main([]) == 0
    out = capsys.readouterr().out
    assert "Connection: OK" in out and "read-only session on" in out
    assert "0002_forecasting" in out and "applied" in out and "observations" in out and "40" in out
    assert "contains data" in out
    pw = conninfo_to_dict(migrated_db_url).get("password") or "\0"
    assert pw not in out and migrated_db_url not in out
    # the session really is read-only: a write attempt through the tool's connection fails
    from db.target import connect

    with connect(migrated_db_url, read_only=True) as c, pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
        c.execute("INSERT INTO sources (code, name) VALUES ('x', 'x')")
    assert os.environ  # (keeps the fixture import used)
