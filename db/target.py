"""Helpers shared by the database deployment tools. Nothing here ever returns a password or full URL."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.conninfo import conninfo_to_dict

LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}


def connection_kwargs(url: str, timeout_s: int = 10) -> dict[str, Any]:
    """TLS for any non-local host, prepared statements off (poolers), bounded connect time."""
    info = conninfo_to_dict(url)
    kw: dict[str, Any] = {"connect_timeout": timeout_s, "prepare_threshold": None}
    host = (info.get("host") or "").lower()
    if "sslmode" not in info and host not in LOCAL_HOSTS and not host.startswith("/"):
        kw["sslmode"] = "require"
    return kw


def connect(url: str, timeout_s: int = 10, *, read_only: bool = False) -> psycopg.Connection:
    conn = psycopg.connect(url, **connection_kwargs(url, timeout_s))
    if read_only:
        conn.read_only = True
    return conn


@dataclass(frozen=True)
class Identity:
    """Safe-to-print description of a database target (no user name, no password)."""

    kind: str  # local | supabase-pooler | supabase-direct | other-remote
    database: str
    port: str
    host_label: str  # a short label, never the full host for remote targets

    def __str__(self) -> str:
        return f"{self.kind} (database '{self.database}', port {self.port})"


def identity(url: str) -> Identity:
    info = conninfo_to_dict(url)
    host = (info.get("host") or "").lower()
    if host in LOCAL_HOSTS or host.startswith("/"):
        kind, label = "local", "local"
    elif ".pooler.supabase.com" in host:
        kind, label = "supabase-pooler", "Supabase pooler"
    elif host.startswith("db.") and host.endswith(".supabase.co"):
        kind, label = "supabase-direct", "Supabase direct (IPv6 only)"
    else:
        kind, label = "other-remote", "remote host"
    return Identity(kind, info.get("dbname") or "", str(info.get("port") or "5432"), label)


def same_target(a: str, b: str) -> bool:
    """True if two URLs point at the same host, port and database (the user may differ)."""
    x, y = conninfo_to_dict(a), conninfo_to_dict(b)
    key = lambda d: ((d.get("host") or "").lower(), str(d.get("port") or "5432"), d.get("dbname") or "")  # noqa: E731
    return key(x) == key(y)


def url_from_env(var: str) -> str:
    value = os.environ.get(var)
    if not value:
        raise SystemExit(f"{var} is not set in this PowerShell session (see docs/DEPLOYMENT.md)")
    return value


def friendly_error(exc: BaseException) -> str:
    """A connection failure described without host, IP, port or user name."""
    msg = str(exc).lower()
    if "network is unreachable" in msg:
        return (
            "network unreachable (an IPv6-only host such as Supabase's direct host needs the IPv4 pooler URL)"
        )
    if (
        "password authentication" in msg
        or "tenant or user not found" in msg
        or "authentication failed" in msg
    ):
        return (
            "authentication failed (check the user name and password; special characters must be URL-encoded)"
        )
    if "timeout" in msg or "timed out" in msg:
        return "connection timed out"
    if "could not translate host name" in msg or "name or service not known" in msg:
        return "host name could not be resolved"
    if "ssl" in msg or "tls" in msg:
        return "TLS/SSL negotiation failed"
    return f"connection failed ({type(exc).__name__})"
