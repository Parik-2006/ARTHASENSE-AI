# ruff: noqa: E501, SIM115, B007
"""Build an isolated STAGING replica of production from a READ-ONLY production export (all public data tables).

    ARTHASENSE_DATABASE_URL=<staging url, must be a local host> python tools/staging_replica.py <export-file> [fingerprint.json]

1. Applies ONLY the migrations production has applied (taken from the export's schema_migrations rows; the file hashes are
   checked against the repository), so the replica has production's schema exactly.
2. Loads every row of every table with its original primary key (json_populate_recordset) and resets the sequences.
3. Prints a per-table count + content fingerprint (md5 of the ordered rows as JSON) to compare with production.
Refuses any non-local target. Prints no credentials.
"""

from __future__ import annotations

import json
import os
import sys

import psycopg

sys.path.insert(0, os.getcwd())
from db.migrate import _migrations  # noqa: E402
from pipeline.ingest.safety import require_allowed_host  # noqa: E402

TABLES = [
    "sources",
    "series",
    "releases",
    "observations",
    "linking_factors",
    "forecast_runs",
    "forecasts",
    "scores",
]

FINGERPRINT_SQL = "SELECT count(*), coalesce(md5(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text COLLATE \"C\")), '') FROM {t} t"


def load_export(path: str) -> dict:
    outer = json.loads(open(path, encoding="utf-8").read())
    txt = outer["result"]
    inner = txt[txt.index("[") : txt.rindex("]") + 1]
    # The export casts observations.value to TEXT so NUMERIC keeps its exact scale (113.30, 99.0); the connector's JSON
    # layer would otherwise normalise 113.30 to 113.3. PostgreSQL parses that text per column type on load.
    return json.loads(inner)[0]["replica"]


def main() -> int:
    url = os.environ["ARTHASENSE_DATABASE_URL"]
    print("staging host:", require_allowed_host(url))  # local hosts only
    data = load_export(sys.argv[1])
    applied = {m["version"]: m["sha256"] for m in data["schema_migrations"]}
    repo = {v: (sql, h) for v, sql, h in _migrations()}
    with psycopg.connect(url, autocommit=False) as conn:
        if conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone()[0]:
            print("refusing: staging database is not empty")
            return 2
        for v in sorted(applied):
            sql, h = repo[v]
            if h != applied[v]:
                print(f"refusing: hash mismatch for {v}")
                return 2
            conn.execute(sql)
        for m in data["schema_migrations"]:
            conn.execute(
                "INSERT INTO schema_migrations (version, sha256, applied_at) VALUES (%s, %s, %s) ON CONFLICT (version) DO NOTHING",
                (m["version"], m["sha256"], m["applied_at"]),
            )
        for t in TABLES:
            rows = data.get(t) or []
            if rows:
                conn.execute(
                    f"INSERT INTO {t} SELECT * FROM json_populate_recordset(NULL::{t}, %s::json)",
                    (json.dumps(rows),),
                )
            seq = conn.execute("SELECT pg_get_serial_sequence(%s, 'id')", (t,)).fetchone()[0]
            if seq:
                conn.execute(
                    f"SELECT setval('{seq}', GREATEST((SELECT coalesce(max(id), 0) FROM {t}), 1), (SELECT count(*) > 0 FROM {t}))"
                )
        conn.commit()
        fp = {t: list(conn.execute(FINGERPRINT_SQL.format(t=t)).fetchone()) for t in TABLES}
    print(json.dumps(fp))
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as fh:
            json.dump(fp, fh, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
