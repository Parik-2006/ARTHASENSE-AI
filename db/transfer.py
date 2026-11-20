"""Copy the ArthaSense data from one PostgreSQL database to another (for example local -> Supabase).

    $env:ARTHASENSE_DATABASE_URL        = "<source: your local database>"
    $env:ARTHASENSE_TARGET_DATABASE_URL = "<target: the hosted database>"
    python -m db.migrate                                   # run against the TARGET first (schema only)
    python -m db.transfer                                  # DRY RUN (default): prints the plan, writes nothing
    python -m db.transfer --apply --confirm-target-db <name-of-the-target-database>

Safety rules (all enforced in code):
  * The source is only read. The default is a dry run.
  * The target must already have EXACTLY the same applied migrations (same file hashes).
  * Rows are copied only into a target whose data tables are ALL empty. A non-empty target is never
    modified: if it already equals the source the tool says so and exits 0; otherwise it stops.
  * --apply needs --confirm-target-db with the target's real database name (guards against a wrong URL).
  * Everything is written in ONE transaction and verified (row counts and a content fingerprint of
    every table) before it is committed; any mismatch rolls everything back.
  * Primary keys are preserved so relationships stay valid; sequences are reset afterwards.
  * Nothing is deleted, truncated or overwritten, and credentials are never printed.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from dataclasses import dataclass

import psycopg
from psycopg.types.json import Jsonb

from db.target import connect, friendly_error, identity, same_target, url_from_env
from db.verify_target import DATA_TABLES, local_migration_hashes

# Parents before children (foreign keys).
ORDER = [
    "sources",
    "series",
    "releases",
    "observations",
    "linking_factors",
    "forecast_runs",
    "forecasts",
    "scores",
]
assert sorted(ORDER) == sorted(DATA_TABLES)


class TransferError(RuntimeError):
    """The transfer must not proceed (nothing has been written)."""


@dataclass
class TableState:
    count: int
    fingerprint: str


def columns(conn: psycopg.Connection, table: str) -> list[tuple[str, str]]:
    return conn.execute(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' "
        "AND table_name = %s ORDER BY ordinal_position",
        (table,),
    ).fetchall()


def fingerprint(conn: psycopg.Connection, table: str, cols: list[str]) -> TableState:
    """Hash of every row, ordered by id, over every column (timestamps and numerics round-trip exactly)."""
    h = hashlib.sha256()
    n = 0
    with conn.cursor(name=None) as cur:
        cur.execute(f"SELECT {', '.join(cols)} FROM {table} ORDER BY id")
        for row in cur:
            h.update(repr(row).encode())
            n += 1
    return TableState(n, h.hexdigest()[:24])


def state(conn: psycopg.Connection) -> dict[str, TableState]:
    return {t: fingerprint(conn, t, [c for c, _ in columns(conn, t)]) for t in ORDER}


def applied_migrations(conn: psycopg.Connection) -> dict[str, str]:
    if not conn.execute("SELECT to_regclass('schema_migrations') IS NOT NULL").fetchone()[0]:
        return {}
    return dict(conn.execute("SELECT version, sha256 FROM schema_migrations").fetchall())


def check_preconditions(src: psycopg.Connection, dst: psycopg.Connection) -> None:
    local = local_migration_hashes()
    for name, conn in (("source", src), ("target", dst)):
        got = applied_migrations(conn)
        if got != local:
            missing = sorted(set(local) - set(got))
            differ = sorted(v for v in got if v in local and got[v] != local[v])
            raise TransferError(
                f"{name} migrations do not match the repository (missing: {missing or 'none'}; differing: {differ or 'none'}). "
                "Run python -m db.migrate against that database first."
            )
    for t in ORDER:
        if columns(src, t) != columns(dst, t):
            raise TransferError(f"table {t} has different columns in source and target")


def plan(src_state: dict[str, TableState], dst_state: dict[str, TableState]) -> str:
    """'copy' (target empty), 'in-sync' (already identical) or raises TransferError."""
    if all(s.count == 0 for s in dst_state.values()):
        if all(s.count == 0 for s in src_state.values()):
            raise TransferError("the source has no data to copy")
        return "copy"
    if all(src_state[t] == dst_state[t] for t in ORDER):
        return "in-sync"
    raise TransferError(
        "the target already contains data that differs from the source. Nothing was changed. "
        "This tool never merges, overwrites or deletes; inspect with python -m db.verify_target."
    )


def copy_all(src: psycopg.Connection, dst: psycopg.Connection) -> None:
    """Insert every row with its original id. Runs inside the caller's transaction."""
    for t in ORDER:
        cols = columns(src, t)
        names = [c for c, _ in cols]
        json_cols = {i for i, (_, typ) in enumerate(cols) if typ in ("jsonb", "json")}
        rows = src.execute(f"SELECT {', '.join(names)} FROM {t} ORDER BY id").fetchall()
        if not rows:
            continue
        marks = ", ".join(["%s"] * len(names))
        sql = f"INSERT INTO {t} ({', '.join(names)}) VALUES ({marks})"
        with dst.cursor() as cur:
            cur.executemany(
                sql,
                [
                    tuple(Jsonb(v) if i in json_cols and v is not None else v for i, v in enumerate(r))
                    for r in rows
                ],
            )
        dst.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), (SELECT max(id) FROM {t}))")


def run(src_url: str, dst_url: str, *, apply: bool, confirm_db: str | None, out=print) -> int:
    if same_target(src_url, dst_url):
        raise TransferError("source and target are the same database")
    s_id, d_id = identity(src_url), identity(dst_url)
    out(f"Source: {s_id}")
    out(f"Target: {d_id}")
    with connect(src_url, read_only=True) as src, connect(dst_url) as dst:
        check_preconditions(src, dst)
        out("Migrations: source and target match the repository.")
        src_state, dst_state = state(src), state(dst)
        out(f"{'table':16} {'source rows':>12} {'target rows':>12}")
        for t in ORDER:
            out(f"{t:16} {src_state[t].count:>12} {dst_state[t].count:>12}")
        decision = plan(src_state, dst_state)
        if decision == "in-sync":
            out("Result: the target already holds identical data. Nothing to do.")
            return 0
        total = sum(s.count for s in src_state.values())
        if not apply:
            out(
                f"DRY RUN: would copy {total} rows in {len(ORDER)} tables into the EMPTY target in one transaction."
            )
            out("Nothing was written. To execute: add --apply --confirm-target-db " + d_id.database)
            return 0
        if confirm_db != d_id.database:
            raise TransferError(
                f"--confirm-target-db must equal the target database name ('{d_id.database}')"
            )
        try:
            with dst.transaction():
                copy_all(src, dst)
                after = state(dst)
                for t in ORDER:
                    if after[t] != src_state[t]:
                        raise TransferError(f"verification failed for {t}; rolling back")
        except TransferError:
            raise
        out(
            f"APPLIED and verified: {total} rows copied; every table's count and content fingerprint match the source."
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m db.transfer", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    p.add_argument("--source-env", default="ARTHASENSE_DATABASE_URL")
    p.add_argument("--target-env", default="ARTHASENSE_TARGET_DATABASE_URL")
    p.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    p.add_argument("--confirm-target-db", help="the target database name, required with --apply")
    args = p.parse_args(argv)
    try:
        return run(
            url_from_env(args.source_env),
            url_from_env(args.target_env),
            apply=args.apply,
            confirm_db=args.confirm_target_db,
        )
    except TransferError as exc:
        print(f"STOPPED (nothing written): {exc}", file=sys.stderr)
        return 1
    except psycopg.OperationalError as exc:
        print(f"STOPPED (nothing written): {friendly_error(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
