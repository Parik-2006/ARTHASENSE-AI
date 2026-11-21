"""One place that decides whether a database may be written to by ingestion tooling.

Ingestion, backfill and scheduler commands write only to a LOCAL PostgreSQL by default. A remote host
(for example the hosted production database) is refused unless it is named explicitly with
--allow-host. The URL itself is never printed: only the host name is.
"""

from __future__ import annotations

from psycopg.conninfo import conninfo_to_dict

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


class RemoteTargetRefused(RuntimeError):
    """The database host is not on the allow-list."""


def host_of(url: str) -> str:
    return conninfo_to_dict(url).get("host") or "(unix socket)"


def parse_allow(allow_host: str | None) -> frozenset[str]:
    if not allow_host:
        return LOCAL_HOSTS
    return frozenset(h.strip() for h in allow_host.split(",") if h.strip())


def require_allowed_host(url: str, allow_host: str | None = None) -> str:
    """Return the host if allowed, else raise. The message never contains the URL."""
    host = host_of(url)
    if host not in parse_allow(allow_host):
        raise RemoteTargetRefused(
            f"Refusing: database host {host!r} is not local. Ingestion writes to a local database only; "
            "name a host explicitly with --allow-host if you really intend otherwise."
        )
    return host
