"""Read-only research tools over the stored data.

    python -m pipeline.research quality              # print a data-quality report
    python -m pipeline.research export               # write CSV/JSON files to data/exports/

Both commands only READ from PostgreSQL; export writes local files only.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import psycopg

from pipeline.ingest.config import database_url
from pipeline.research.export import export_all
from pipeline.research.quality import build_quality_reports


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.research", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("quality", help="print the data-quality report for every stored series")
    ex = sub.add_parser("export", help="write deterministic CSV/JSON exports")
    ex.add_argument("--out", default="data/exports", help="output directory (default data/exports)")
    ex.add_argument(
        "--include-spliced-cpi",
        action="store_true",
        help="also write the CPI 2024 Back+Current splice (opt-in: the join is not verified seamless)",
    )
    args = p.parse_args(argv)

    url = database_url()
    if not url:
        print("Error: ARTHASENSE_DATABASE_URL is not set (see .env.example)", file=sys.stderr)
        return 2
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            if args.cmd == "quality":
                reports = build_quality_reports(conn)
                if not reports:
                    print("No stored series yet.")
                for r in reports:
                    print(f"{r.indicator:4} {r.series_identifier}")
                    print(
                        f"     base {r.base_year} | {r.start_period} -> {r.end_period} | "
                        f"{r.observation_count} of {r.expected_month_count} months | "
                        f"snapshots {r.snapshot_count} | retrieved {r.retrieval_timestamp}"
                    )
                    for w in r.quality_warnings:
                        print(f"     ! {w}")
                return 0
            manifest = export_all(conn, Path(args.out), include_spliced_cpi=args.include_spliced_cpi)
    except psycopg.Error as exc:
        text = str(exc).strip().splitlines()
        print(f"Database error: {text[0] if text else 'unknown'}", file=sys.stderr)
        return 1
    print(f"Wrote {len(manifest['files'])} files to {args.out}")
    for f in manifest["files"]:
        print(f"  {f['path']}  ({f['rows']} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
