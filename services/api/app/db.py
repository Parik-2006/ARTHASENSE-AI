"""Database access for the API: one place that decides TLS, timeouts and pooler compatibility.

Hosted PostgreSQL (for example Supabase) notes:
  * TLS: for any non-local host `sslmode=require` is added unless the URL already sets an sslmode.
  * Poolers: Supabase's transaction pooler (port 6543) does not support server-side prepared
    statements, so `prepare_threshold=None` turns them off. This is harmless on a direct connection.
  * One short-lived connection per request, closed by the context manager: no connection pool, which
    keeps memory low on a small free instance and avoids exhausting pooler slots.
  * Health output never contains host names, IP addresses, ports or user names.
"""

from dataclasses import dataclass
from typing import Any, Literal

import psycopg
from psycopg.conninfo import conninfo_to_dict

DbStatus = Literal["ok", "unavailable", "not_configured"]
_LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}


@dataclass(frozen=True)
class DbCheck:
    status: DbStatus
    detail: str | None = None


def connection_kwargs(database_url: str, timeout_s: int) -> dict[str, Any]:
    """Extra connection arguments derived from the URL (never contains the URL itself)."""
    info = conninfo_to_dict(database_url)
    kwargs: dict[str, Any] = {"connect_timeout": timeout_s, "prepare_threshold": None}
    host = (info.get("host") or "").lower()
    is_local = host in _LOCAL_HOSTS or host.startswith("/")
    if "sslmode" not in info and not is_local:
        kwargs["sslmode"] = "require"
    return kwargs


def connect(database_url: str, timeout_s: int = 8) -> psycopg.Connection:
    """Open a connection with the settings above. Use as `with connect(url) as conn:`."""
    return psycopg.connect(database_url, **connection_kwargs(database_url, timeout_s))


def classify_failure(exc: BaseException) -> str:
    """A safe, generic reason for a failed connection. Deliberately drops host, IP, port and user."""
    msg = str(exc).lower()
    if (
        "password authentication" in msg
        or "authentication failed" in msg
        or "tenant or user not found" in msg
    ):
        return "authentication failed (check the user name and password in the connection string)"
    if "network is unreachable" in msg:
        return (
            "network unreachable from this server (an IPv6-only database host needs the provider's "
            "IPv4 pooler connection string)"
        )
    if "timeout" in msg or "timed out" in msg:
        return "connection timed out"
    if "could not translate host name" in msg or "name or service not known" in msg or "no such host" in msg:
        return "database host name could not be resolved"
    if "ssl" in msg or "tls" in msg:
        return "TLS/SSL negotiation failed"
    if "too many" in msg or "remaining connection slots" in msg or "max client" in msg:
        return "database connection limit reached"
    if "does not exist" in msg and "database" in msg:
        return "database name does not exist"
    return "connection failed"


def check_database(database_url: str | None, timeout_s: int = 2) -> DbCheck:
    """Open a short-lived connection and run SELECT 1. Never raises and never leaks connection details."""
    if not database_url:
        return DbCheck("not_configured", "ARTHASENSE_DATABASE_URL is not set")
    try:
        with connect(database_url, timeout_s) as conn:
            server_version = conn.execute("SHOW server_version").fetchone()[0]
            conn.execute("SELECT 1")
        return DbCheck("ok", f"PostgreSQL {server_version}")
    except Exception as exc:  # report a classified reason, don't crash the health endpoint
        return DbCheck("unavailable", classify_failure(exc))
