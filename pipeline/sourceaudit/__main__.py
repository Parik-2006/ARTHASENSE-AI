# ruff: noqa: E501
"""Run the discovery matrix: python -m pipeline.sourceaudit [--refresh] [--only 01,02] [--out reports]"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from pipeline.sourceaudit.cases import CASES, UNSUPPORTED
from pipeline.sourceaudit.harness import Runner

COLUMNS = ["id", "group", "source", "operation", "request_format", "dataset", "base_year", "frequency", "title",
           "expected_type", "actual_type", "http_status", "outcome", "records_returned", "earliest", "latest",
           "distinct_months", "missing_months", "evidence_level", "usable_for_ingestion", "from_cache",
           "retrieved_at", "raw_sha256", "note", "error"]  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.sourceaudit")
    p.add_argument(
        "--refresh", action="store_true", help="ignore the on-disk cache and re-request (still rate limited)"
    )
    p.add_argument("--only", default="", help="comma list of case ids")
    p.add_argument("--out", type=Path, default=Path("reports"))
    a = p.parse_args(argv)
    ids = {x.strip() for x in a.only.split(",") if x.strip()}
    runner = Runner(refresh=a.refresh)
    results = []
    try:
        for c in CASES:
            if ids and c.id not in ids:
                continue
            r = runner.run(c)
            results.append(r)
            print(f"{r['id']} {r['group']} {r.get('outcome', '?'):<22} n={r.get('records_returned', 0):<5} "
                  f"{r.get('earliest', '')}..{r.get('latest', '')} {'(cache)' if r['from_cache'] else ''} {c.title[:60]}")  # fmt: skip
    finally:
        runner.close()
    if ids:
        return 0
    a.out.mkdir(parents=True, exist_ok=True)
    with (a.out / "government-query-matrix.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in results:
            row = {**r, "missing_months": ";".join(r.get("missing_months", []))}
            w.writerow(row)
    summary = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "cases_executed": len(results),
        "outcomes": dict(Counter(r.get("outcome") for r in results)),
        "from_cache": sum(1 for r in results if r["from_cache"]),
        "live_requests_this_run": runner.live_requests,
        "unsupported_formats_not_executed": UNSUPPORTED,
    }
    (a.out / "government-query-results.json").write_text(
        json.dumps({"summary": summary, "cases": results}, indent=1, default=str), encoding="utf-8"
    )
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
