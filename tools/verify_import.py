# ruff: noqa: E501, SIM115, B007
"""Verify a target database after the import (READ ONLY): pre-existing rows untouched, forecasting tables untouched,
no duplicates/orphans, and every series/period equal to the verified local reference database.

    TARGET_URL_FILE=<file> ARTHASENSE_DATABASE_URL=<local reference> python tools/verify_import.py <baseline-fingerprint.json> <report.json>

baseline-fingerprint.json = per-table [count, md5] of production BEFORE the import (COLLATE "C" ordering, see staging_replica.py).
Pre-existing observations are checked by fingerprinting exactly the rows whose id <= the baseline maximum.
"""

from __future__ import annotations

import json
import os
import sys

import psycopg

sys.path.insert(0, os.getcwd())
from tools.import_plan import read_url  # noqa: E402

FP = "SELECT count(*), coalesce(md5(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text COLLATE \"C\")), '') FROM {t} t {where}"
LATEST = """SELECT DISTINCT ON (s.code, o.period_date) s.code, o.period_date, o.value
  FROM observations o JOIN series s ON s.id=o.series_id JOIN releases r ON r.id=o.release_id
 ORDER BY s.code, o.period_date, r.retrieved_at DESC, r.id DESC"""


def main() -> int:
    base = json.load(open(sys.argv[1], encoding="utf-8"))
    target = read_url(os.environ["TARGET_URL_FILE"])
    rep: dict = {"checks": {}}
    with (
        psycopg.connect(target, connect_timeout=10) as t,
        psycopg.connect(os.environ["ARTHASENSE_DATABASE_URL"], connect_timeout=5) as ref,
    ):
        t.execute("SET TRANSACTION READ ONLY")
        ref.execute("SET TRANSACTION READ ONLY")
        for tbl in ("forecast_runs", "forecasts", "scores", "linking_factors"):
            got = list(t.execute(FP.format(t=tbl, where="")).fetchone())
            rep["checks"][f"{tbl} unchanged"] = got == base[tbl]
        for tbl, n in (
            ("sources", base["sources"][0]),
            ("series", base["series"][0]),
            ("releases", base["releases"][0]),
            ("observations", base["observations"][0]),
        ):
            got = list(
                t.execute(
                    FP.format(
                        t=tbl,
                        where=f"WHERE id <= (SELECT max(id) FROM (SELECT id FROM {tbl} ORDER BY id LIMIT {n}) x)",
                    )
                ).fetchone()
            )
            rep["checks"][f"pre-existing {tbl} rows unchanged"] = got == base[tbl]
        q = lambda sql: t.execute(sql).fetchone()[0]  # noqa: E731
        rep["checks"]["no duplicate (series, release, period)"] = (
            q(
                "SELECT count(*) FROM (SELECT 1 FROM observations GROUP BY series_id, release_id, period_date HAVING count(*)>1) d"
            )
            == 0
        )
        rep["checks"]["no orphan observations"] = (
            q(
                "SELECT count(*) FROM observations o LEFT JOIN series s ON s.id=o.series_id LEFT JOIN releases r ON r.id=o.release_id WHERE s.id IS NULL OR r.id IS NULL"
            )
            == 0
        )
        rep["checks"]["GDP/GVA quarterly only"] = (
            q(
                "SELECT count(*) FROM observations o JOIN series s ON s.id=o.series_id WHERE s.code LIKE 'mospi.nas%' AND (s.frequency<>'quarterly' OR extract(month from o.period_date) NOT IN (1,4,7,10))"
            )
            == 0
        )
        rep["checks"]["no zero written for a missing value (only the 4 published 0.0 IIP growth figures)"] = (
            q("SELECT count(*) FROM observations WHERE value = 0") == 4
        )
        mig = [r[0] for r in t.execute("SELECT version FROM schema_migrations ORDER BY version")]
        rep["migrations"] = mig
        tv = {(c, p): v for c, p, v in t.execute(LATEST)}
        rv = {(c, p): v for c, p, v in ref.execute(LATEST)}
        diff = [f"{c} {p}" for (c, p) in rv if tv.get((c, p)) != rv[(c, p)]]
        extra = [f"{c} {p}" for (c, p) in tv if (c, p) not in rv]
        rep["checks"]["every local series/period present with the same value"] = not diff
        rep["checks"]["no rows beyond the verified local dataset"] = not extra
        rep["differences"] = diff[:20]
        rep["extra_rows"] = extra[:20]
        by = t.execute(
            "SELECT s.indicator, count(DISTINCT s.id), count(o.id) FROM series s JOIN observations o ON o.series_id=s.id GROUP BY 1 ORDER BY 1"
        ).fetchall()
        rep["counts"] = {i: {"series": a, "observations": b} for i, a, b in by}
        rep["totals"] = {"series": q("SELECT count(*) FROM series"), "releases": q("SELECT count(*) FROM releases"), "observations": q("SELECT count(*) FROM observations"),
                         "forecast_runs": q("SELECT count(*) FROM forecast_runs"), "forecasts": q("SELECT count(*) FROM forecasts"), "scores": q("SELECT count(*) FROM scores")}  # fmt: skip
    rep["all_passed"] = all(rep["checks"].values())
    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=1, default=str)
    print(
        json.dumps(
            {k: v for k, v in rep.items() if k not in ("differences", "extra_rows")}, indent=1, default=str
        )
    )
    return 0 if rep["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
