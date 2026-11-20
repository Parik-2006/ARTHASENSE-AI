from dataclasses import dataclass
from typing import Literal

import psycopg

DbStatus = Literal["ok", "unavailable", "not_configured"]


@dataclass(frozen=True)
class DbCheck:
    status: DbStatus
    detail: str | None = None


def check_database(database_url: str | None, timeout_s: int = 2) -> DbCheck:
    """Open a short-lived connection and run SELECT 1. Never raises."""
    if not database_url:
        return DbCheck("not_configured", "ARTHASENSE_DATABASE_URL is not set")
    try:
        with psycopg.connect(database_url, connect_timeout=timeout_s) as conn:
            server_version = conn.execute("SHOW server_version").fetchone()[0]
            conn.execute("SELECT 1")
        return DbCheck("ok", f"PostgreSQL {server_version}")
    except Exception as exc:  # report, don't crash the health endpoint
        # First line only (psycopg messages are long). Never echo the URL: it may hold a password.
        message = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        return DbCheck("unavailable", message)
