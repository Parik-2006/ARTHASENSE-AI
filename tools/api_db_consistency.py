# ruff: noqa: E501
"""Read-only end-to-end check: PostgreSQL → FastAPI. For every stored series, the API must serve exactly the newest
snapshot's value for every period (no duplicates, no missing or invented periods).

    ARTHASENSE_DATABASE_URL=... python tools/api_db_consistency.py http://127.0.0.1:8770 [report.json]

The database session is READ ONLY (SET TRANSACTION READ ONLY); nothing is written. Prints no credentials.
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from decimal import Decimal

import httpx
import psycopg

LATEST_SQL = """
SELECT DISTINCT ON (s.code, o.period_date) s.code, o.period_date, o.value
  FROM observations o JOIN series s ON s.id = o.series_id JOIN releases r ON r.id = o.release_id
 ORDER BY s.code, o.period_date, r.retrieved_at DESC, r.id DESC
"""


def endpoints_for(code: str) -> tuple[str, str] | None:
    """(API path, JSON field) that serves this series code."""
    p = code.split(".")
    if p[1] == "cpi":
        series = {"2012": "legacy2012"}.get(p[2]) or p[3]  # current | back | legacy2012
        field = "index" if p[-1] == "index" else "inflation"
        return f"/api/v1/indicators/cpi?limit=240&series={series}", field
    if p[1] == "wpi":
        return f"/api/v1/indicators/wpi?limit=240&base_year={p[2]}", "index"
    if p[1] == "iip":
        return f"/api/v1/indicators/iip?limit=240&base_year={p[2]}&sector={p[4]}", "index" if p[
            -1
        ] == "index" else "growth"
    if p[1] == "nas":
        field = "level" if p[-1] == "level" else "growth_yoy"
        if p[4] == "gdp":
            return "/api/v1/indicators/gdp?limit=80", field
        return f"/api/v1/indicators/gdp/gva?limit=80#{p[5]}", field
    return None


def main() -> int:
    api = sys.argv[1].rstrip("/")
    out = sys.argv[2] if len(sys.argv) > 2 else None
    db: dict[str, dict[str, Decimal]] = defaultdict(dict)
    with psycopg.connect(os.environ["ARTHASENSE_DATABASE_URL"], connect_timeout=5) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        for code, period, value in conn.execute(LATEST_SQL):
            db[code][period.isoformat()] = value
        dupes = conn.execute(
            "SELECT count(*) FROM (SELECT series_id, release_id, period_date FROM observations GROUP BY 1,2,3 HAVING count(*) > 1) d"
        ).fetchone()[0]
    cache: dict[str, dict] = {}
    results = []
    with httpx.Client(timeout=60) as c:
        for code, want in sorted(db.items()):
            ep = endpoints_for(code)
            if ep is None:
                results.append({"series": code, "ok": False, "why": "no endpoint"})
                continue
            path, field = ep
            url, _, gva_key = path.partition("#")
            if url not in cache:
                r = c.get(api + url)
                cache[url] = r.json() if r.status_code == 200 else {"_status": r.status_code}
            body = cache[url]
            rows = body.get("observations", [])
            if gva_key:
                rows = next(
                    (i["observations"] for i in body.get("industries", []) if i["key"] == gva_key), []
                )
            got: dict[str, float] = {}
            dup = 0
            for o in rows:
                if o.get(field) is None:
                    continue
                dup += o["period"] in got
                got[o["period"]] = o[field]
            missing = sorted(set(want) - set(got))
            extra = sorted(set(got) - set(want))
            wrong = [p for p in want if p in got and abs(float(want[p]) - got[p]) > 1e-9]
            ok = not (missing or extra or wrong or dup)
            results.append(
                {
                    "series": code,
                    "ok": ok,
                    "periods": len(want),
                    "served": len(got),
                    "missing": missing[:5],
                    "extra": extra[:5],
                    "mismatched": wrong[:5],
                    "duplicates": dup,
                }
            )
    passed = sum(r["ok"] for r in results)
    summary = {
        "series": len(results),
        "passed": passed,
        "observations_checked": sum(r.get("periods", 0) for r in results),
        "duplicate_rows_in_db": dupes,
    }
    print(json.dumps(summary))
    for r in results:
        if not r["ok"]:
            print("FAIL", json.dumps(r))
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"summary": summary, "results": results}, fh, indent=1)
    return 0 if passed == len(results) and dupes == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
