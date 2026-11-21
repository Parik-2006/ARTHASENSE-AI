# ruff: noqa: E501
"""Raw-response evidence for ingestion: record every response, archive its bytes, link it to a release.

Usage: pass a RecordingClient where a MospiClient is expected, store as usual, then call
attach_evidence(conn, release_key, client.take()). Raw bytes go to <evidence_dir>/raw/<sha256> (kept out of
Git; see docs/DATABASE-PRODUCTION-SAFETY.md for retention). Only the request URL and parameters are
recorded; no credentials are involved because the API is keyless.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import psycopg

from pipeline.sources.mospi import MospiClient

PARSER_VERSION = "ingest-2026.11"
VALIDATION_VERSION = "validate-2026.11"
DEFAULT_DIR = Path("data/evidence")


@dataclass(frozen=True)
class Captured:
    url: str
    status: int
    content_type: str | None
    size: int
    sha256: str
    retrieved_at: datetime


class RecordingClient(MospiClient):
    """A MospiClient that remembers the raw bytes of every response it returns."""

    def __init__(self, *a: Any, evidence_dir: Path = DEFAULT_DIR, **k: Any) -> None:
        super().__init__(*a, **k)
        self._dir = evidence_dir
        self._log: list[Captured] = []

    def get(self, endpoint: str, params: dict[str, Any] | None = None) -> httpx.Response:
        resp = super().get(endpoint, params)
        sha = hashlib.sha256(resp.content).hexdigest()
        raw = self._dir / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        if not (raw / sha).exists():
            (raw / sha).write_bytes(resp.content)
        self._log.append(
            Captured(
                str(resp.request.url),
                resp.status_code,
                resp.headers.get("content-type"),
                len(resp.content),
                sha,
                datetime.now(UTC),
            )  # fmt: skip
        )
        return resp

    def take(self) -> list[Captured]:
        """Responses captured since the last call (then cleared)."""
        out, self._log = self._log, []
        return out


def attach_evidence(
    conn: psycopg.Connection, release_key: str, items: list[Captured], source_code: str = "mospi"
) -> int:
    """Link captured responses to an existing release. Idempotent. Only successful (HTTP 200) pages are kept."""
    row = conn.execute(
        """SELECT r.id, r.content_sha256 FROM releases r JOIN sources s ON s.id = r.source_id
            WHERE s.code = %s AND r.release_key = %s""",
        (source_code, release_key),
    ).fetchone()
    if row is None:
        raise LookupError("release not found; store the snapshot before attaching evidence")
    rel_id, normalized = row
    n = 0
    for it in (i for i in items if i.status == 200):
        cur = conn.execute(
            """INSERT INTO source_artifacts (release_id, request_url, http_status, content_type, size_bytes,
                   raw_sha256, normalized_sha256, storage_path, parser_version, validation_version, retrieved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (release_id, raw_sha256, request_url) DO NOTHING""",
            (rel_id, it.url, it.status, it.content_type, it.size, it.sha256, normalized, f"raw/{it.sha256}",
             PARSER_VERSION, VALIDATION_VERSION, it.retrieved_at),
        )  # fmt: skip
        n += cur.rowcount
    return n


def make_recording_client(evidence_dir: Path = DEFAULT_DIR) -> RecordingClient:
    from pipeline.sources.mospi import USER_AGENT

    return RecordingClient(
        httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}),
        evidence_dir=evidence_dir,
    )
