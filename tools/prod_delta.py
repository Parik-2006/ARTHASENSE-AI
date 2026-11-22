# ruff: noqa: E501, SIM115, B007
"""Exact production import delta from a READ-ONLY production export and the local database (read-only).

    ARTHASENSE_DATABASE_URL=<local> python tools/prod_delta.py <production-export.txt|json> reports/production-import-preview.json

The export is the JSON object {series, releases, sources, obs:[[code, period, value, status, release_key], ...]} produced by a
SELECT in a READ ONLY transaction on production. Every local row is classified against production by (series code, period):
  identical  — same value in production (nothing to do)
  new        — production has no observation for that series and period (would be added)
  conflict   — production has a DIFFERENT value for that series and period (never overwritten; stops the release)
Production rows absent locally are reported as production_only (they are kept; nothing is deleted).
Prints no credentials.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from decimal import Decimal

import psycopg


def load_export(path: str) -> dict:
    raw = open(path, encoding="utf-8").read()
    m = re.search(r'\{\\?"dump\\?":', raw)
    if m:  # connector output: JSON-encoded string inside a wrapper
        outer = json.loads(raw)
        txt = outer["result"] if isinstance(outer, dict) else raw
        inner = txt[txt.index("[") : txt.rindex("]") + 1]
        return json.loads(inner)[0]["dump"]
    return json.loads(raw)


def indicator(code: str) -> str:
    return {"cpi": "CPI", "wpi": "WPI", "iip": "IIP", "nas": "GDP/GVA"}[code.split(".")[1]]


def main() -> int:
    export, out = sys.argv[1], sys.argv[2]
    prod = load_export(export)
    p_obs: dict[tuple[str, str], list[tuple[Decimal, str, str]]] = defaultdict(list)
    for code, period, value, status, key in prod["obs"]:
        p_obs[(code, period[:10])].append((Decimal(value), status, key))
    with psycopg.connect(os.environ["ARTHASENSE_DATABASE_URL"], connect_timeout=5) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        rows = conn.execute(
            """SELECT DISTINCT ON (s.code, o.period_date) s.code, o.period_date::text, o.value, o.status, r.release_key
                 FROM observations o JOIN series s ON s.id=o.series_id JOIN releases r ON r.id=o.release_id
                ORDER BY s.code, o.period_date, r.retrieved_at DESC, r.id DESC"""
        ).fetchall()
        local_series = {
            c: (i, f, b)
            for c, i, f, b in conn.execute("SELECT code, indicator, frequency, base_year FROM series")
        }
        local_releases = {k: s for k, s in conn.execute("SELECT release_key, content_sha256 FROM releases")}
    per = defaultdict(Counter)
    conflicts, new_by_series = [], Counter()
    local_keys = set()
    for code, period, value, status, key in rows:
        local_keys.add((code, period))
        ind = indicator(code)
        per[ind]["local"] += 1
        pv = p_obs.get((code, period))
        if not pv:
            per[ind]["new"] += 1
            new_by_series[code] += 1
        else:
            vals = {v for v, _, _ in pv}
            if len(vals) == 1 and value in vals:
                per[ind]["identical"] += 1
            else:
                per[ind]["conflict"] += 1
                conflicts.append(
                    {
                        "series": code,
                        "period": period,
                        "local": str(value),
                        "production": sorted(str(v) for v in vals),
                    }
                )
    prod_only = sorted(k for k in p_obs if k not in local_keys)
    for code, _ in p_obs:
        per[indicator(code)]["production"] += 0
    for (code, _), vs in p_obs.items():
        per[indicator(code)]["production"] += len(vs)
    p_series = {s["code"]: s for s in prod["series"]}
    series_mismatch = [
        {
            "series": c,
            "production": [s["indicator"], s["frequency"], s["base_year"]],
            "local": list(local_series[c]),
        }
        for c, s in p_series.items()
        if c in local_series and (s["indicator"], s["frequency"], s["base_year"]) != local_series[c]
    ]
    rel_mismatch = [
        r["key"]
        for r in prod["releases"]
        if r["key"] in local_releases and local_releases[r["key"]] != r["sha"]
    ]
    order = ["CPI", "WPI", "IIP", "GDP/GVA"]
    table = {
        k: {
            "local_rows": per[k]["local"],
            "production_rows": per[k]["production"],
            "identical": per[k]["identical"],
            "new": per[k]["new"],
            "conflicts": per[k]["conflict"],
        }
        for k in order
    }
    table["Total"] = {f: sum(table[k][f] for k in order) for f in table["CPI"]}
    report = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "status": "verified_against_production_read_only_export",
        "production": {
            "series": len(prod["series"]),
            "releases": len(prod["releases"]),
            "observations": len(prod["obs"]),
            "source_codes": [s["code"] for s in prod["sources"]],
        },
        "comparison": table,
        "conflicts": conflicts,
        "production_only_rows": [{"series": c, "period": p} for c, p in prod_only],
        "series_metadata_mismatches": series_mismatch,
        "release_key_sha_mismatches": rel_mismatch,
        "new_series_codes": sorted(c for c in local_series if c not in p_series),
        "new_rows_by_series": dict(sorted(new_by_series.items())),
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    print(
        json.dumps(
            {
                "comparison": table,
                "conflicts": len(conflicts),
                "production_only": len(prod_only),
                "series_mismatch": len(series_mismatch),
                "release_sha_mismatch": len(rel_mismatch),
                "new_series": len(report["new_series_codes"]),
            },
            indent=1,
        )
    )
    return 0 if not conflicts else 3


if __name__ == "__main__":
    raise SystemExit(main())
