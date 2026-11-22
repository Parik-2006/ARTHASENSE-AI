# ruff: noqa: E501, SIM115, B007
"""Run the approved official import plan (migrations + MoSPI ingestion) against ONE target database.

    python tools/import_plan.py --url-file <file with ARTHASENSE_DATABASE_URL=... or ARTHASENSE_PROD_DATABASE_URL=...> \\
        --allow-host <exact host> --log reports/<name>.json [--skip-migrate] [--only nas,cpi2012]

* The URL is read from the file and passed to child processes through the environment only; only the host is printed.
* --allow-host must equal the URL's host (the pipelines' local-host guard refuses anything else).
* Steps: `python -m db.migrate` (applies only pending migrations; verifies applied hashes), then every ingestion command
  below with --resume (years already stored are skipped; snapshots are additive and keyed by content hash), then the NAS
  (GDP/GVA) import. Nothing is deleted or overwritten by any step.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from urllib.parse import urlsplit

PLAN: list[tuple[str, list[str]]] = [
    (
        "cpi_current",
        ["pipeline.ingest.history", "cpi", "--start-year", "2025", "--end-year", "2026", "--resume"],
    ),
    (
        "cpi_back",
        [
            "pipeline.ingest.history",
            "cpi",
            "--series",
            "Back",
            "--start-year",
            "2013",
            "--end-year",
            "2024",
            "--resume",
        ],
    ),
    (
        "cpi2012",
        ["pipeline.ingest.history", "cpi2012", "--start-year", "2013", "--end-year", "2025", "--resume"],
    ),
    (
        "wpi_2022_23",
        ["pipeline.ingest.history", "wpi", "--start-year", "2023", "--end-year", "2026", "--resume"],
    ),
    (
        "wpi_2011_12",
        [
            "pipeline.ingest.history",
            "wpi",
            "--base-year",
            "2011-12",
            "--start-year",
            "2012",
            "--end-year",
            "2026",
            "--resume",
        ],
    ),
    (
        "wpi_2004_05",
        [
            "pipeline.ingest.history",
            "wpi",
            "--base-year",
            "2004-05",
            "--start-year",
            "2005",
            "--end-year",
            "2017",
            "--resume",
        ],
    ),
    (
        "wpi_1993_94",
        [
            "pipeline.ingest.history",
            "wpi",
            "--base-year",
            "1993-94",
            "--start-year",
            "1994",
            "--end-year",
            "2010",
            "--resume",
        ],
    ),
    (
        "iip_2022_23",
        ["pipeline.ingest.history", "iip", "--start-year", "2023", "--end-year", "2026", "--resume"],
    ),
    (
        "iip_2011_12",
        [
            "pipeline.ingest.history",
            "iip",
            "--base-year",
            "2011-12",
            "--start-year",
            "2013",
            "--end-year",
            "2026",
            "--resume",
        ],
    ),
    (
        "iip_2004_05",
        [
            "pipeline.ingest.history",
            "iip",
            "--base-year",
            "2004-05",
            "--start-year",
            "2005",
            "--end-year",
            "2017",
            "--resume",
        ],
    ),
    (
        "iip_1993_94",
        [
            "pipeline.ingest.history",
            "iip",
            "--base-year",
            "1993-94",
            "--start-year",
            "1994",
            "--end-year",
            "2011",
            "--resume",
        ],
    ),
    ("nas_gdp_gva", ["pipeline.ingest.nas"]),
]


def read_url(path: str) -> str:
    for line in open(path, encoding="utf-8"):
        k, _, v = line.strip().partition("=")
        if k in ("ARTHASENSE_DATABASE_URL", "ARTHASENSE_PROD_DATABASE_URL") and v:
            return v.strip().strip("'\"")
    raise SystemExit("no ARTHASENSE_(PROD_)DATABASE_URL in the url file")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url-file", required=True)
    ap.add_argument("--allow-host", required=True)
    ap.add_argument("--log", required=True)
    ap.add_argument("--skip-migrate", action="store_true")
    ap.add_argument("--only", default=None, help="comma list of plan step names")
    a = ap.parse_args()
    url = read_url(a.url_file)
    host = urlsplit(url).hostname or ""
    if host != a.allow_host:
        print(f"refusing: --allow-host {a.allow_host!r} does not match the URL host {host!r}")
        return 2
    print(f"target host: {host}")
    env = {**os.environ, "ARTHASENSE_DATABASE_URL": url, "PYTHONIOENCODING": "utf-8"}
    steps = [] if a.skip_migrate else [("migrate", ["db.migrate"])]
    only = set(a.only.split(",")) if a.only else None
    steps += [(n, c) for n, c in PLAN if only is None or n in only]
    log = {"started_at": datetime.now(UTC).isoformat(timespec="seconds"), "host": host, "steps": []}
    rc_all = 0
    for name, cmd in steps:
        args = [sys.executable, "-m", *cmd]
        if cmd[0].startswith("pipeline."):
            args += ["--allow-host", host]
        t0 = time.time()
        p = subprocess.run(args, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        out = (p.stdout + p.stderr).replace(url, "<url>")
        lines = [ln for ln in out.splitlines() if ln.strip()]
        summary = [
            ln
            for ln in lines
            if any(
                w in ln
                for w in (
                    "inserted",
                    "Status",
                    "Applied",
                    "applied",
                    "up to date",
                    "FAILED",
                    "Error",
                    "skipped",
                    "SUCCESS",
                )
            )
        ]
        log["steps"].append(
            {
                "step": name,
                "command": " ".join(cmd),
                "exit": p.returncode,
                "seconds": round(time.time() - t0, 1),
                "summary": summary[-40:],
            }
        )
        print(f"{name}: exit {p.returncode} ({round(time.time() - t0)}s) {summary[-1] if summary else ''}")
        if p.returncode != 0:
            rc_all = p.returncode
            print("\n".join(lines[-15:]))
            break
    log["finished_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    with open(a.log, "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=1)
    return rc_all


if __name__ == "__main__":
    raise SystemExit(main())
