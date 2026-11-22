# ruff: noqa: E501
"""Deterministic import manifest of the local database (read-only).

    python -m pipeline.ingest.manifest            -> reports/import-manifest.json

For every stored series: code, base year, rows, first/last month and a SHA-256 over its newest-snapshot
(period, value) pairs. The same data always yields the same manifest, so a production preview can compare
hashes instead of trusting row counts. Each series carries its verification level; a series is only
"verified_live_full" when every stored month was compared with the live source (pipeline.ingest.preview) and
none differed. This script never connects to anything but a LOCAL database and writes nothing to it.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

# Verified by comparing EVERY stored month with the live source on 2026-11-21/22 (zero revisions, zero additions).
VERIFIED_LIVE_FULL = (
    "mospi.cpi.2012.",
    "mospi.wpi.2004-05.",
    "mospi.wpi.1993-94.",
    "mospi.iip.2004-05.",
    "mospi.iip.1993-94.",
)
# Verified by the source-audit monitor dry runs and sampled cross-checks (see docs).
VERIFIED_AUDIT = (
    "mospi.cpi.2024.",
    "mospi.wpi.2022-23.",
    "mospi.wpi.2011-12.",
    "mospi.iip.2022-23.",
    "mospi.iip.2011-12.",
)

SQL = """
SELECT series_code, array_agg(period_date ORDER BY period_date), array_agg(value::text ORDER BY period_date)
  FROM current_observations GROUP BY series_code ORDER BY series_code
"""


def level(code: str) -> str:
    if code.startswith(VERIFIED_LIVE_FULL):
        return "verified_live_full"
    if code.startswith(VERIFIED_AUDIT):
        return "verified_audit_monitor"
    return "unverified"


def series_hash(periods, values) -> str:
    h = hashlib.sha256()
    for p, v in zip(periods, values, strict=True):
        h.update(f"{p.isoformat()}|{v}\n".encode())
    return h.hexdigest()


def build(rows) -> dict:
    series = []
    for code, periods, values in rows:
        series.append(
            {
                "code": code,
                "rows": len(periods),
                "first": periods[0].isoformat(),
                "last": periods[-1].isoformat(),
                "sha256": series_hash(periods, values),
                "verification": level(code),
            }
        )
    return {
        "series": series,
        "total_rows": sum(s["rows"] for s in series),
        "note": "unverified series must be excluded from any import",
    }


def main() -> int:
    import psycopg

    from pipeline.ingest.config import database_url
    from pipeline.ingest.safety import LOCAL_HOSTS, host_of

    url = database_url()
    if not url or host_of(url) not in LOCAL_HOSTS:
        print("Refusing: a local ARTHASENSE_DATABASE_URL is required.", file=sys.stderr)
        return 2
    with psycopg.connect(url, connect_timeout=5) as conn:
        conn.read_only = True
        rows = conn.execute(SQL).fetchall()
    m = build(rows)
    Path("reports").mkdir(exist_ok=True)
    Path("reports/import-manifest.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    bad = [s["code"] for s in m["series"] if s["verification"] == "unverified"]
    print(f"{len(m['series'])} series, {m['total_rows']} rows; unverified: {bad or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
