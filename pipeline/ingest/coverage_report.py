"""Machine-readable historical coverage report from the LOCAL database (read-only).

    python -m pipeline.ingest.coverage_report                   # JSON on stdout
    python -m pipeline.ingest.coverage_report --out reports/data-coverage.json

For every stored series: span, months stored, missing months, snapshots, revisions, provenance gaps.
For every indicator: whether ONE comparable series (one base year) covers the latest five years.
Months from different base years are never added together into a "continuous" history.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import psycopg

from pipeline.ingest.config import database_url
from pipeline.ingest.safety import RemoteTargetRefused, require_allowed_host

WINDOW_MONTHS = 60
HEADLINE = {"CPI": ".general.index", "WPI": ".all_commodities.index", "IIP": ".india.general.index"}

SERIES_SQL = """
WITH cur AS (
  SELECT DISTINCT ON (o.series_id, o.period_date) o.series_id, o.period_date
    FROM observations o JOIN releases r ON r.id = o.release_id
   ORDER BY o.series_id, o.period_date, r.retrieved_at DESC, r.id DESC
)
SELECT s.code, s.indicator, s.base_year, s.unit,
       (SELECT array_agg(period_date ORDER BY period_date) FROM cur WHERE cur.series_id = s.id) AS months,
       (SELECT count(DISTINCT o.release_id) FROM observations o WHERE o.series_id = s.id) AS snapshots,
       (SELECT count(*) FROM observation_revisions v WHERE v.series_id = s.id) AS revised_months,
       (SELECT count(*) FROM (SELECT period_date FROM observations o WHERE o.series_id = s.id
                               GROUP BY period_date HAVING count(*) > 1) d) AS months_in_several_snapshots,
       (SELECT count(*) FROM observations o WHERE o.series_id = s.id) AS observations,
       (SELECT count(*) FROM observations o JOIN releases r ON r.id = o.release_id
         WHERE o.series_id = s.id AND r.published_at IS NULL) AS obs_without_published_at,
       (SELECT count(*) FROM observations o JOIN releases r ON r.id = o.release_id
         WHERE o.series_id = s.id
           AND (r.source_url IS NULL OR r.content_sha256 IS NULL)) AS obs_without_source_artifact
  FROM series s ORDER BY s.indicator, s.base_year DESC, s.code
"""


def _n(d: date) -> int:
    return d.year * 12 + d.month - 1


def _ym(n: int) -> str:
    return f"{n // 12}-{n % 12 + 1:02d}"


def analyse_series(
    code: str, indicator: str, base_year: str | None, unit: str, months: list[date], extra: dict[str, int]
) -> dict[str, Any]:
    ns = sorted({_n(m) for m in months})
    have = set(ns)
    missing = [_ym(n) for n in range(ns[0], ns[-1] + 1) if n not in have] if ns else []
    return {
        "code": code, "indicator": indicator, "base_year": base_year, "unit": unit,
        "kind": "index" if code.endswith(".index") else "official_rate",
        "first": _ym(ns[0]) if ns else None, "last": _ym(ns[-1]) if ns else None,
        "months_stored": len(ns), "months_in_span": (ns[-1] - ns[0] + 1) if ns else 0,
        "missing_months": missing,
        "off_first_of_month": sum(1 for m in months if m.day != 1),
        **extra,
    }  # fmt: skip


def five_year_analysis(
    indicator: str, series: list[dict[str, Any]], month_sets: dict[str, set[int]]
) -> dict[str, Any]:
    """Which single series covers the latest five years? Bases are reported separately, never summed."""
    head = [s for s in series if s["indicator"] == indicator and s["code"].endswith(HEADLINE[indicator])]
    if not head:
        return {"indicator": indicator, "status": "no_data"}
    end = max(max(month_sets[s["code"]]) for s in head)
    window = set(range(end - WINDOW_MONTHS + 1, end + 1))
    rows = []
    for s in head:
        covered = len(window & month_sets[s["code"]])
        rows.append({"series": s["code"], "base_year": s["base_year"], "months_in_window": covered,
                     "covers_whole_window": covered == WINDOW_MONTHS})  # fmt: skip
    one = [r["series"] for r in rows if r["covers_whole_window"]]
    union = set().union(*(window & month_sets[s["code"]] for s in head))
    return {
        "indicator": indicator,
        "window": f"{_ym(min(window))} .. {_ym(end)}",
        "single_series_covers_window": bool(one),
        "series_covering_whole_window": one,
        "per_series": sorted(rows, key=lambda r: -r["months_in_window"]),
        "months_with_data_in_any_series": len(union),
        "union_is_one_comparable_index": False,
        "note": (
            "A month counted only through a second base year is available but cannot be chained to the "
            "first without an official linking factor."
        ),
    }


def build_report(rows: list[tuple[Any, ...]], linking_factors: int, host: str) -> dict[str, Any]:
    series, month_sets = [], {}
    for code, ind, base, unit, months, snaps, revised, multi, total, no_pub, no_art in rows:
        months = months or []
        s = analyse_series(code, ind, base, unit, months, {
            "observations": total, "snapshots": snaps, "months_with_revised_values": revised,
            "months_present_in_several_snapshots": multi,
            "observations_without_published_at": no_pub,
            "observations_without_source_artifact": no_art,
        })  # fmt: skip
        series.append(s)
        month_sets[code] = {_n(m) for m in months}
    indicators = sorted({s["indicator"] for s in series} & set(HEADLINE))
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "database_host": host,
        "official_linking_factors_stored": linking_factors,
        "series": series,
        "five_year_window": [five_year_analysis(i, series, month_sets) for i in indicators],
        "metadata_gaps": {
            "published_at_missing_on_every_observation": all(
                x["observations_without_published_at"] == x["observations"] for x in series
            ),
            "reason": "The MoSPI API does not return publication dates; none are invented.",
        },
    }  # fmt: skip


def run(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.ingest.coverage_report", description=__doc__)
    p.add_argument("--out", type=Path, help="write JSON here instead of stdout")
    p.add_argument("--allow-host", default=None)
    a = p.parse_args(argv)
    url = database_url()
    if not url:
        print("Error: ARTHASENSE_DATABASE_URL is not set", file=sys.stderr)
        return 2
    try:
        host = require_allowed_host(url, a.allow_host)
    except RemoteTargetRefused as exc:
        print(str(exc), file=sys.stderr)
        return 2
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            conn.read_only = True
            rows = conn.execute(SERIES_SQL).fetchall()
            linking = conn.execute("SELECT count(*) FROM linking_factors").fetchone()[0]
    except psycopg.Error as exc:
        print(f"Database error: {str(exc).splitlines()[0]}", file=sys.stderr)
        return 1
    text = json.dumps(build_report(rows, linking, host), indent=2) + "\n"
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text, encoding="utf-8")
        print(f"Wrote {a.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
