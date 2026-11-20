"""Read-only check of a database: who is it, is TLS on, which migrations, how many rows.

    $env:ARTHASENSE_DATABASE_URL = "<connection string>"      # typed in YOUR shell, never in chat or files
    python -m db.verify_target                                  # checks ARTHASENSE_DATABASE_URL
    python -m db.verify_target --env-var ARTHASENSE_TARGET_DATABASE_URL

Nothing is written (the session is read-only). Credentials are never printed.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import psycopg

from db.target import connect, friendly_error, identity, url_from_env

MIGRATIONS = Path(__file__).parent / "migrations"
DATA_TABLES = [
    "sources",
    "series",
    "releases",
    "observations",
    "linking_factors",
    "forecast_runs",
    "forecasts",
    "scores",
]


def local_migration_hashes() -> dict[str, str]:
    return {
        p.stem: hashlib.sha256(p.read_text(encoding="utf-8").encode()).hexdigest()
        for p in sorted(MIGRATIONS.glob("*.sql"))
    }


def inspect(conn: psycopg.Connection) -> dict:
    out: dict = {}
    out["server_version"] = conn.execute("SHOW server_version").fetchone()[0]
    ssl = conn.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()").fetchone()
    out["tls"] = bool(ssl and ssl[0])
    out["read_only_session"] = conn.execute("SHOW transaction_read_only").fetchone()[0]
    exists = conn.execute("SELECT to_regclass('schema_migrations') IS NOT NULL").fetchone()[0]
    out["migrations"] = (
        dict(conn.execute("SELECT version, sha256 FROM schema_migrations ORDER BY 1").fetchall())
        if exists
        else {}
    )
    out["counts"] = {}
    for t in DATA_TABLES:
        present = conn.execute("SELECT to_regclass(%s) IS NOT NULL", (t,)).fetchone()[0]
        out["counts"][t] = conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] if present else None
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m db.verify_target", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    p.add_argument(
        "--env-var", default="ARTHASENSE_DATABASE_URL", help="environment variable holding the URL"
    )
    args = p.parse_args(argv)
    url = url_from_env(args.env_var)
    ident = identity(url)
    print(f"Target: {ident}")
    try:
        with connect(url, read_only=True) as conn:
            info = inspect(conn)
    except Exception as exc:
        print(f"Connection: FAILED: {friendly_error(exc)}")
        return 1
    print(
        f"Connection: OK (PostgreSQL {info['server_version']}; TLS {'on' if info['tls'] else 'OFF'}; read-only session {info['read_only_session']})"
    )
    if not info["tls"] and ident.kind != "local":
        print("WARNING: TLS is off on a remote database.")
    local = local_migration_hashes()
    print("Migrations:")
    for v, h in local.items():
        state = (
            "missing"
            if v not in info["migrations"]
            else ("applied" if info["migrations"][v] == h else "APPLIED BUT DIFFERS FROM THE FILE")
        )
        print(f"  {v:22} {state}")
    extra = sorted(set(info["migrations"]) - set(local))
    if extra:
        print(f"  unknown applied migrations: {extra}")
    print("Row counts:")
    for t, n in info["counts"].items():
        print(f"  {t:16} {'(table missing)' if n is None else n}")
    c = info["counts"]
    if all(v is None for v in c.values()):
        print("State: EMPTY (no tables yet). Next: python -m db.migrate")
    elif all((v or 0) == 0 for v in c.values()):
        print("State: schema present, no data. Next: python -m db.transfer (dry run first)")
    else:
        print("State: contains data. Do not copy into it; compare with a dry run instead.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
