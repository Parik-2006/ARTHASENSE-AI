"""Data-quality and calculation-correctness audit of the stored official series (read-only).

    python -m pipeline.audit            -> reports/data-quality-<date>.json and docs/DATA-QUALITY.md

Checks, per stored series (local database only; a READ ONLY transaction):
  1. completeness: missing months inside the first..last span
  2. plausibility: non-positive index values; large single-month moves (informational, never edited)
  3. base-year transitions: for bases of one indicator that overlap in time, the ratio of their overlapping
     values. A constant ratio would resemble a linking factor; if the ratio drifts, the bases must stay
     separate. The ratio is REPORTED ONLY and is never used to link or convert anything.
  4. revisions: months whose value differs between retrieval snapshots
  5. calculation correctness: index-derived year-on-year change (the formula the website uses) compared with
     the publisher's own official rate for the same month, wherever both exist
  6. freshness: newest stored month per series and its age in months (no staleness claim without a schedule)
"""

from __future__ import annotations

import json
import statistics
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

Month = tuple[int, int]


def mkey(d: date) -> Month:
    return (d.year, d.month)


def month_number(m: Month) -> int:
    return m[0] * 12 + m[1] - 1


def missing_months(values: dict[Month, float]) -> list[Month]:
    if not values:
        return []
    lo, hi = min(map(month_number, values)), max(map(month_number, values))
    return [(n // 12, n % 12 + 1) for n in range(lo, hi + 1) if (n // 12, n % 12 + 1) not in values]


def yoy_from_index(index: dict[Month, float]) -> dict[Month, float]:
    """The website's formula: (index_t / index_t-12 - 1) * 100, only where both months exist and the base is > 0."""
    out: dict[Month, float] = {}
    for m, v in index.items():
        prev = index.get((m[0] - 1, m[1]))
        if prev is not None and prev > 0:
            out[m] = (v / prev - 1) * 100
    return out


@dataclass
class YoYComparison:
    compared: int
    max_abs_diff: float | None
    mean_abs_diff: float | None
    over_tolerance: list[tuple[Month, float, float]]  # (month, calculated, official)
    tolerance: float


def compare_yoy(index: dict[Month, float], official: dict[Month, float], tolerance: float) -> YoYComparison:
    """Calculated YoY vs the publisher's official rate. `tolerance` allows for rounding of the published index."""
    calc = yoy_from_index(index)
    both = sorted(m for m in calc if m in official)
    diffs = [abs(calc[m] - official[m]) for m in both]
    over = [(m, round(calc[m], 3), official[m]) for m in both if abs(calc[m] - official[m]) > tolerance]
    return YoYComparison(len(both), max(diffs) if diffs else None, statistics.fmean(diffs) if diffs else None, over, tolerance)


@dataclass
class OverlapStats:
    months: int
    first: Month | None
    last: Month | None
    ratio_min: float | None
    ratio_max: float | None
    ratio_spread_pct: float | None  # (max-min)/mean * 100; large spread = not a constant factor
    constant_factor_like: bool


def overlap_ratio(a: dict[Month, float], b: dict[Month, float], constant_tolerance_pct: float = 1.0) -> OverlapStats:
    """Ratio a/b over months present in both. REPORT ONLY: never used to convert or link series."""
    both = sorted(m for m in a if m in b and b[m] != 0)
    if not both:
        return OverlapStats(0, None, None, None, None, None, False)
    r = [a[m] / b[m] for m in both]
    mean = statistics.fmean(r)
    spread = (max(r) - min(r)) / mean * 100
    return OverlapStats(len(both), both[0], both[-1], min(r), max(r), spread, spread <= constant_tolerance_pct)


def large_moves(index: dict[Month, float], threshold_pct: float) -> list[tuple[Month, float]]:
    out = []
    for m in sorted(index):
        prev = (m[0] - (1 if m[1] == 1 else 0), 12 if m[1] == 1 else m[1] - 1)
        if prev in index and index[prev] > 0:
            mv = (index[m] / index[prev] - 1) * 100
            if abs(mv) >= threshold_pct:
                out.append((m, round(mv, 2)))
    return out


def fmt(m: Month | None) -> str | None:
    return None if m is None else f"{m[0]}-{m[1]:02d}"


# ---------------------------------------------------------------------------------------------
# Database part
# ---------------------------------------------------------------------------------------------

SERIES_SQL = """
SELECT s.code, s.indicator, s.base_year, array_agg(c.period_date ORDER BY c.period_date), array_agg(c.value::float8 ORDER BY c.period_date),
       max(c.retrieved_at)
  FROM series s JOIN current_observations c ON c.series_id = s.id
 GROUP BY s.code, s.indicator, s.base_year ORDER BY s.indicator, s.code
"""
REVISION_SQL = "SELECT series_code, count(*) FROM observation_revisions GROUP BY 1 ORDER BY 1"
STATUS_SQL = """
SELECT s.code, o.status, count(*) FROM observations o JOIN series s ON s.id = o.series_id
 WHERE o.status <> 'retrieved' GROUP BY 1, 2 ORDER BY 1, 2
"""

# Official-rate pairs: (rate series suffix, tolerance in percentage points). The CPI index is published to one
# decimal, so a calculated YoY can differ from the official rate by rounding alone.
RATE_TOLERANCE = {"cpi": 0.15, "iip": 0.15}


def load(conn) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for code, ind, base, periods, values, retrieved in conn.execute(SERIES_SQL).fetchall():
        out[code] = {"indicator": ind, "base_year": base, "values": {mkey(p): float(v) for p, v in zip(periods, values, strict=True)}, "retrieved": retrieved}
    return out


def build_report(series: dict[str, dict[str, Any]], revisions: dict[str, int], statuses: list[tuple[str, str, int]], today: date) -> dict[str, Any]:
    rep: dict[str, Any] = {"generated_at": datetime.now(UTC).isoformat(timespec="seconds"), "series": [], "base_transitions": [], "calculation_checks": []}
    today_n = today.year * 12 + today.month - 1
    for code, s in series.items():
        v = s["values"]
        is_index = code.endswith(".index")
        entry: dict[str, Any] = {
            "code": code, "indicator": s["indicator"], "base_year": s["base_year"], "kind": "index" if is_index else "official_rate",
            "first": fmt(min(v)), "last": fmt(max(v)), "months": len(v),
            "missing_months": [fmt(m) for m in missing_months(v)],
            "age_months_of_latest": today_n - month_number(max(v)),
            "revised_months": revisions.get(code, 0),
        }  # fmt: skip
        if is_index:
            entry["non_positive_values"] = sum(1 for x in v.values() if x <= 0)
            thr = 5.0 if s["indicator"] != "IIP" else 15.0
            entry["large_moves"] = {"threshold_pct": thr, "months": [[fmt(m), mv] for m, mv in large_moves(v, thr)]}
        rep["series"].append(entry)
    rep["source_flags"] = [{"code": c, "status": st, "months": n} for c, st, n in statuses]

    # base transitions: every pair of index series of one indicator whose spans overlap
    idx = {c: s for c, s in series.items() if c.endswith(".index")}
    codes = sorted(idx)
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            if idx[a]["indicator"] != idx[b]["indicator"]:
                continue
            if a.split(".")[-2] != b.split(".")[-2] and idx[a]["indicator"] == "IIP":
                continue  # IIP sectors are only comparable like with like
            ov = overlap_ratio(idx[a]["values"], idx[b]["values"])
            if ov.months:
                rep["base_transitions"].append({
                    "a": a, "b": b, "overlap_months": ov.months, "from": fmt(ov.first), "to": fmt(ov.last),
                    "ratio_min": round(ov.ratio_min, 4), "ratio_max": round(ov.ratio_max, 4), "ratio_spread_pct": round(ov.ratio_spread_pct, 2),
                    "constant_factor_like": ov.constant_factor_like,
                    "note": "Reported only. No ratio is ever used to link series; they stay separate.",
                })  # fmt: skip

    # calculation correctness: YoY from the index vs the official rate, same series stem
    for code, s in series.items():
        if not code.endswith((".inflation_yoy", ".growth_yoy")):
            continue
        stem = code.rsplit(".", 1)[0]
        idx_code = stem + ".index"
        if idx_code not in series:
            continue
        ind = s["indicator"].lower()
        cmpd = compare_yoy(series[idx_code]["values"], s["values"], RATE_TOLERANCE.get(ind, 0.15))
        rep["calculation_checks"].append({
            "index": idx_code, "official_rate": code, "months_compared": cmpd.compared,
            "max_abs_diff_pp": None if cmpd.max_abs_diff is None else round(cmpd.max_abs_diff, 3),
            "mean_abs_diff_pp": None if cmpd.mean_abs_diff is None else round(cmpd.mean_abs_diff, 3),
            "tolerance_pp": cmpd.tolerance, "months_over_tolerance": len(cmpd.over_tolerance),
            "examples_over_tolerance": [[fmt(m), c, o] for m, c, o in cmpd.over_tolerance[:6]],
        })  # fmt: skip
    return rep


def render_markdown(rep: dict[str, Any]) -> str:
    L = ["# Data-quality and calculation audit", "", f"Generated {rep['generated_at']} from the local database (read-only). Every number below is computed from stored official observations; nothing is edited or filled.", ""]
    L += ["## 1. Completeness, freshness and revisions (per series)", "", "| Series | Base | First | Last | Months | Missing months | Latest is N months old | Revised months |", "|---|---|---|---|---:|---|---:|---:|"]
    for s in rep["series"]:
        miss = ", ".join(s["missing_months"]) or "none"
        L.append(f"| `{s['code']}` | {s['base_year']} | {s['first']} | {s['last']} | {s['months']} | {miss} | {s['age_months_of_latest']} | {s['revised_months']} |")
    L += ["", "Age is the distance between the newest stored month and the current month. It is not a staleness claim: no publication schedule is known to the API.", ""]
    L += ["## 2. Calculation correctness: website YoY vs the publisher's official rate", "",
          "The site calculates YoY as `(index_t / index_t-12 - 1) × 100`. For every series that also has an official rate, the two are compared month by month.", "",
          "| Index series | Official rate | Months compared | Max abs diff (pp) | Mean abs diff (pp) | Over tolerance |", "|---|---|---:|---:|---:|---:|"]
    for c in rep["calculation_checks"]:
        L.append(f"| `{c['index']}` | `{c['official_rate'].split('.')[-1]}` | {c['months_compared']} | {c['max_abs_diff_pp']} | {c['mean_abs_diff_pp']} | {c['months_over_tolerance']} (> {c['tolerance_pp']} pp) |")
    L += ["", "Small differences are expected because the published index is rounded to one decimal. Larger ones are listed in the JSON report with the months.", ""]
    L += ["## 3. Base-year transitions (reported, never used)", "", "| Series A | Series B | Overlap | Ratio A/B min | max | Spread % | Constant like a factor? |", "|---|---|---|---:|---:|---:|---|"]
    for t in rep["base_transitions"]:
        L.append(f"| `{t['a']}` | `{t['b']}` | {t['from']} to {t['to']} ({t['overlap_months']} mo) | {t['ratio_min']} | {t['ratio_max']} | {t['ratio_spread_pct']} | {'yes' if t['constant_factor_like'] else 'no'} |")
    L += ["", "A ratio that drifts between months is not a linking factor. ArthaSense never converts or joins series across base years.", ""]
    L += ["## 4. Source flags stored per observation", ""]
    L += [f"- `{f['code']}`: `{f['status']}` on {f['months']} month(s)" for f in rep["source_flags"]] or ["- none beyond the default 'retrieved'"]
    big = [(s["code"], s["large_moves"]["months"]) for s in rep["series"] if s.get("large_moves", {}).get("months")]
    L += ["", "## 5. Large single-month moves (informational; values are shown unchanged)", ""]
    L += [f"- `{c}`: {', '.join(f'{m} ({mv:+.1f}%)' for m, mv in ms[:8])}{' …' if len(ms) > 8 else ''}" for c, ms in big] or ["- none"]
    return "\n".join(L) + "\n"


def main(argv: list[str] | None = None) -> int:
    import psycopg

    from pipeline.ingest.config import database_url
    from pipeline.ingest.safety import LOCAL_HOSTS, host_of

    url = database_url()
    if not url:
        print("Error: ARTHASENSE_DATABASE_URL is not set", file=sys.stderr)
        return 2
    host = host_of(url)
    if host not in LOCAL_HOSTS:
        print(f"Refusing: database host {host!r} is not local.", file=sys.stderr)
        return 2
    with psycopg.connect(url, connect_timeout=5) as conn:
        conn.read_only = True
        series = load(conn)
        revisions = dict(conn.execute(REVISION_SQL).fetchall())
        statuses = conn.execute(STATUS_SQL).fetchall()
    rep = build_report(series, revisions, statuses, datetime.now(UTC).date())
    rep["database_host"] = host
    Path("reports").mkdir(exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y-%m-%d")
    Path(f"reports/data-quality-{stamp}.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    Path("docs/DATA-QUALITY.md").write_text(render_markdown(rep), encoding="utf-8")
    print(f"series: {len(rep['series'])}; calculation checks: {len(rep['calculation_checks'])}; base transitions: {len(rep['base_transitions'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
