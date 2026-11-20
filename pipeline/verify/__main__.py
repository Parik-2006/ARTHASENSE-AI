"""Run the M1 verification probes and save a timestamped JSON report.

    python -m pipeline.verify                 # all probes
    python -m pipeline.verify --only mospi    # probes whose id starts with "mospi"
    python -m pipeline.verify --list          # show probes without running them

Read-only: GET requests (plus the MCP initialize/tools/list handshake). Nothing is written to
the database. Output goes to reports/verification/<UTC timestamp>.json (git-ignored).
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from pipeline.verify.probes import PROBES, ProbeResult, run_all

OUT_DIR = Path(__file__).resolve().parents[2] / "reports" / "verification"


def _line(r: ProbeResult) -> str:
    mark = "PASS" if r.ok else "FAIL"
    span = f"{r.periods[0]} → {r.periods[-1]}" if r.periods else ""
    total = f" total={r.total_records}" if r.total_records is not None else ""
    note = f" | {r.note}" if r.note else ""
    return f"[{mark}] {r.id:42} http={r.http_status} {span}{total}{note}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--only", help="run probes whose id starts with this prefix")
    ap.add_argument("--list", action="store_true", help="list probes and exit")
    args = ap.parse_args()

    probes = [p for p in PROBES if not args.only or p.id.startswith(args.only)]
    if args.list:
        for p in probes:
            print(f"{p.id:42} {p.question}")
        return 0
    if not probes:
        print(f"No probes match {args.only!r}", file=sys.stderr)
        return 2

    started = datetime.now(UTC)
    results = run_all(probes=probes, on_result=lambda r: print(_line(r), flush=True))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{started.strftime('%Y%m%dT%H%M%SZ')}.json"
    out.write_text(
        json.dumps(
            {"run_at_utc": started.isoformat(), "results": [r.to_dict() for r in results]},
            indent=2,
        ),
        encoding="utf-8",
    )
    passed = sum(r.ok for r in results)
    print(f"\n{passed}/{len(results)} probes passed. Report: {out}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
