"""Apply db/migrations/*.sql in filename order, once each.

Usage:  python -m db.migrate            (uses ARTHASENSE_DATABASE_URL)
        python -m db.migrate --status

An applied migration whose file has since changed is an error: write a new migration instead
of editing an old one.
"""

import argparse
import hashlib
import os
import sys
from pathlib import Path

import psycopg

from db.target import connect

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def _migrations() -> list[tuple[str, str, str]]:
    out = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        out.append((path.stem, sql, hashlib.sha256(sql.encode()).hexdigest()))
    return out


def _applied(conn: psycopg.Connection) -> dict[str, str]:
    exists = conn.execute("SELECT to_regclass('schema_migrations') IS NOT NULL").fetchone()[0]
    if not exists:
        return {}
    return dict(conn.execute("SELECT version, sha256 FROM schema_migrations").fetchall())


def migrate(database_url: str) -> list[str]:
    applied_now = []
    with connect(database_url) as conn:
        done = _applied(conn)
        for version, sql, digest in _migrations():
            if version in done:
                if done[version] != digest:
                    raise RuntimeError(f"Migration {version} was edited after being applied")
                continue
            with conn.transaction():
                conn.execute(sql)
                conn.execute(
                    "INSERT INTO schema_migrations (version, sha256) VALUES (%s, %s)",
                    (version, digest),
                )
            applied_now.append(version)
    return applied_now


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true", help="list migrations and exit")
    args = parser.parse_args()
    url = os.environ.get("ARTHASENSE_DATABASE_URL")
    if not url:
        print("ARTHASENSE_DATABASE_URL is not set (see .env.example)", file=sys.stderr)
        return 2
    if args.status:
        with connect(url) as conn:
            done = _applied(conn)
        for version, _, _ in _migrations():
            print(f"{'applied' if version in done else 'pending':8} {version}")
        return 0
    applied = migrate(url)
    print("Applied: " + (", ".join(applied) if applied else "nothing (up to date)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
