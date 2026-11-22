"""Write validated observations to PostgreSQL as an auditable retrieval snapshot (all indicators).

Rules (see also cpi_store.py):
  * One `releases` row per distinct *content* retrieved; its key embeds a SHA-256 of the data.
    Same data again -> same release, nothing changes. Changed data -> a new release; old snapshots
    are never overwritten.
  * `published_at` stays NULL: MoSPI's API gives no publication date, so none is invented.
  * Every series is registered separately (index vs growth/inflation, sector vs headline, base
    year in the code). A missing value is simply not stored; it is never turned into 0.
  * Everything happens in one transaction.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

OBSERVATION_STATUS = "retrieved"  # not "published": we cannot verify an official release date


@dataclass(frozen=True)
class SeriesSpec:
    code: str
    name: str
    indicator: str
    unit: str
    base_year: str
    geography: str


@dataclass
class IngestStats:
    release_key: str
    release_created: bool
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped_missing: int = 0


def canonical_sha256(body: Any) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def dec_str(v: Decimal | None) -> str | None:
    return None if v is None else str(v)


def _id(conn: psycopg.Connection, sql: str, params: tuple) -> int:
    return conn.execute(sql, params).fetchone()[0]


def _upsert_series(conn: psycopg.Connection, source_id: int, spec: SeriesSpec) -> int:
    # DO UPDATE SET code=code is a no-op that lets RETURNING give us the id of an existing row
    # without altering it.
    return _id(
        conn,
        """INSERT INTO series (source_id, code, name, indicator, frequency, unit, base_year, geography)
           VALUES (%s, %s, %s, %s, 'monthly', %s, %s, %s)
           ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id""",
        (source_id, spec.code, spec.name, spec.indicator, spec.unit, spec.base_year, spec.geography),
    )


class ConflictingObservation(RuntimeError):
    """A stored official value differs from the incoming one inside the SAME release. Never overwritten."""


def _upsert_observation(
    conn: psycopg.Connection,
    series_id: int,
    rel_id: int,
    period: date,
    value: Decimal,
    status: str = OBSERVATION_STATUS,
) -> str:
    """Insert one observation. An existing identical value is 'unchanged'; a different value for the
    same (series, release, period) is refused, never overwritten. Revisions arrive as a NEW release."""
    row = conn.execute(
        """INSERT INTO observations (series_id, release_id, period_date, value, status)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (series_id, release_id, period_date) DO NOTHING
           RETURNING id""",
        (series_id, rel_id, period, value, status),
    ).fetchone()
    if row is not None:
        return "inserted"
    stored = conn.execute(
        "SELECT value FROM observations WHERE series_id = %s AND release_id = %s AND period_date = %s",
        (series_id, rel_id, period),
    ).fetchone()[0]
    if stored != value:
        raise ConflictingObservation(
            f"refusing to overwrite stored value for {period.isoformat()} in an existing release"
        )
    return "unchanged"


def store_snapshot(
    conn: psycopg.Connection,
    *,
    source_code: str,
    source_name: str,
    base_url: str,
    release_key: str,
    sha256: str,
    retrieved_at: datetime,
    source_url: str,
    specs: dict[str, SeriesSpec],
    observations: Iterable[tuple],
) -> IngestStats:
    """All-or-nothing. `observations` = (series code, period, value or None[, status]).

    The optional 4th element is the SOURCE's own finality flag (for example CPI 2012 `status`); when it is
    absent the observation is marked 'retrieved' (we cannot verify an official release date)."""
    obs = list(observations)
    with conn.transaction():
        source_id = _id(
            conn,
            """INSERT INTO sources (code, name, base_url) VALUES (%s, %s, %s)
               ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id""",
            (source_code, source_name, base_url),
        )
        # Only register series that actually have at least one value.
        with_data = {o[0] for o in obs if o[2] is not None}
        series_ids = {
            code: _upsert_series(conn, source_id, specs[code]) for code in specs if code in with_data
        }
        created = conn.execute(
            """INSERT INTO releases (source_id, release_key, published_at, retrieved_at, source_url,
                                     content_sha256)
               VALUES (%s, %s, NULL, %s, %s, %s)
               ON CONFLICT (source_id, release_key) DO NOTHING RETURNING id""",
            (source_id, release_key, retrieved_at, source_url, sha256),
        ).fetchone()
        rel_id = (
            created[0]
            if created
            else _id(
                conn,
                "SELECT id FROM releases WHERE source_id = %s AND release_key = %s",
                (source_id, release_key),
            )
        )
        stats = IngestStats(release_key=release_key, release_created=created is not None)
        expected = 0
        for item in obs:
            code, period, value = item[0], item[1], item[2]
            status = item[3] if len(item) > 3 and item[3] else OBSERVATION_STATUS
            if value is None:
                stats.skipped_missing += 1
                continue
            expected += 1
            outcome = _upsert_observation(conn, series_ids[code], rel_id, period, value, status)
            setattr(stats, outcome, getattr(stats, outcome) + 1)
        stored = _id(conn, "SELECT count(*) FROM observations WHERE release_id = %s", (rel_id,))
        if stored != expected:  # integrity check; raising rolls the transaction back
            raise RuntimeError(f"integrity check failed: release has {stored} rows, expected {expected}")
    return stats


def release_exists(conn: psycopg.Connection, source_code: str, key_prefix: str) -> bool:
    """True if a snapshot whose key starts with `key_prefix` is already stored (used to resume)."""
    row = conn.execute(
        """SELECT 1 FROM releases r JOIN sources s ON s.id = r.source_id
            WHERE s.code = %s AND r.release_key LIKE %s LIMIT 1""",
        (source_code, key_prefix.replace("%", r"\%").replace("_", r"\_") + "%"),
    ).fetchone()
    return row is not None
