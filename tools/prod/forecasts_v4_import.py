"""Forecasts V4 import: train and store the V4 suites and future forecasts on a TARGET database.

    python tools/prod/forecasts_v4_import.py --env-file P:/ArthaSense-AI/.prod.env --var ARTHASENSE_PROD_DATABASE_URL
    python tools/prod/forecasts_v4_import.py --url-env ARTHASENSE_DATABASE_URL          # e.g. a local restore

Runs, in order: CPI, WPI and IIP on their official linked histories (suite `v4_linked` + V4 futures) and quarterly GDP
(suites `v4_q8`, `v4_q12` + V4 futures). Idempotent: runs already stored (same experiment id) are skipped, never
overwritten; nothing is deleted. Official observations are only read. The URL is read from the file / environment and
never printed; `--allow-host` is derived from it so the CLI's remote-write guard applies to exactly this host.
"""

from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import urlsplit

sys.path.insert(
    0, os.environ.get("REPO") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from pipeline.forecasting import cli  # noqa: E402

JOBS = [
    ["--indicator", "cpi", "--history", "linked"],
    ["--indicator", "wpi", "--history", "linked"],
    ["--indicator", "iip", "--history", "linked"],
    ["--indicator", "gdp", "--history", "current"],
]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env-file", help="file with VAR=url lines (not printed)")
    p.add_argument("--var", default="ARTHASENSE_PROD_DATABASE_URL", help="variable name inside --env-file")
    p.add_argument("--url-env", help="take the URL from this environment variable instead")
    p.add_argument("--only", help="comma-separated indicators (default: all four)")
    a = p.parse_args()
    if a.env_file:
        with open(a.env_file, encoding="utf-8") as fh:
            lines = [x.strip() for x in fh if x.startswith(a.var + "=")]
        if not lines:
            print(f"{a.var} not found in the env file", file=sys.stderr)
            return 2
        url = lines[0].split("=", 1)[1].strip()
    elif a.url_env:
        url = os.environ.get(a.url_env, "")
    else:
        print("give --env-file or --url-env", file=sys.stderr)
        return 2
    host = urlsplit(url).hostname or ""
    if not host:
        print("could not read a host from the URL", file=sys.stderr)
        return 2
    os.environ["ARTHASENSE_DATABASE_URL"] = url  # read by the CLI; never printed
    only = set(a.only.split(",")) if a.only else None
    rc = 0
    for job in JOBS:
        if only and job[1] not in only:
            continue
        print(f"\n######## {' '.join(job)}", flush=True)
        r = cli.main(["suite", "--name", "v4", *job, "--save", "--allow-host", host])
        rc = rc or r
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
