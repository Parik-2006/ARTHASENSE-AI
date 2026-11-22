# ruff: noqa: E501  (registry text and long literals are kept on readable lines)
"""CLI: python -m pipeline.discovery [--only ID-substring] [--delay 0.4] [--no-db]

Writes reports/discovery-<YYYY-MM-DD>.json (machine-readable) and docs/GOVDATA-DISCOVERY.md (human summary).
Read-only. The database cross-check uses a READ ONLY transaction and only a local host (see pipeline.ingest.safety).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import httpx

from pipeline.discovery.suite import EMPTY, FAILED, SKIPPED, VERIFIED, Context, run_all, summarize
from pipeline.ingest.config import database_url
from pipeline.sources.mospi import USER_AGENT, MospiClient

ICON = {VERIFIED: "verified", EMPTY: "empty (source has no data)", FAILED: "FAILED", SKIPPED: "skipped"}


def render_markdown(results, summary, meta) -> str:
    lines = [
        "# Government data discovery and verification",
        "",
        f"Run: {meta['generated_at']} · source host: `{meta['source_host']}` · requests sent: {meta['requests']} · tests: {summary['total']}",
        "",
        "A test is **verified** only when content checks pass (documented fields, numeric values, requested year, no duplicate",
        "months, expected row counts, or equality with the stored database). HTTP 200 alone never counts. **empty** means the source",
        "answered but holds no data for that request. TLS verification is never disabled.",
        "",
        f"**Result:** {summary[VERIFIED]} verified · {summary[EMPTY]} empty (informative) · {summary[FAILED]} failed · {summary[SKIPPED]} skipped",
        "",
        "| Category | verified | empty | failed | skipped |",
        "|---|---:|---:|---:|---:|",
    ]
    for cat, c in summary["by_category"].items():
        lines.append(
            f"| {cat} | {c.get(VERIFIED, 0)} | {c.get(EMPTY, 0)} | {c.get(FAILED, 0)} | {c.get(SKIPPED, 0)} |"
        )
    lines += [
        "",
        "## All tests",
        "",
        "| # | ID | Result | What was checked | Evidence |",
        "|---:|---|---|---|---|",
    ]
    for i, r in enumerate(results, 1):
        lines.append(f"| {i} | `{r.id}` | {ICON[r.status]} | {r.name} | {r.detail.replace('|', '/')} |")
    failed = [r for r in results if r.status == FAILED]
    lines += ["", "## Failures and what they mean", ""]
    lines += [f"- `{r.id}`: {r.detail}" for r in failed] or ["- none"]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.discovery", description=__doc__)
    p.add_argument("--only", help="run only tests whose id contains this text")
    p.add_argument("--delay", type=float, default=0.4)
    p.add_argument("--no-db", action="store_true", help="skip the read-only database cross-checks")
    p.add_argument("--out-dir", default=".")
    a = p.parse_args(argv)

    db_url = None if a.no_db else database_url()
    host = "none"
    if db_url:
        from pipeline.ingest.safety import LOCAL_HOSTS, host_of

        host = host_of(db_url)
        if host not in LOCAL_HOSTS:
            print(f"Refusing the database cross-check: host {host!r} is not local.", file=sys.stderr)
            db_url = None
    client = MospiClient(
        httpx.Client(timeout=40.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    )
    ctx = Context(client, delay_s=a.delay, db_url=db_url)
    try:
        results = run_all(ctx, a.only)
    finally:
        client.close()
    summary = summarize(results)
    meta = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "source_host": "api.mospi.gov.in",
        "database_host": host,
        "requests": ctx.requests,
    }
    out = Path(a.out_dir)
    (out / "reports").mkdir(exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y-%m-%d")
    (out / "reports" / f"discovery-{stamp}.json").write_text(
        json.dumps({"meta": meta, "summary": summary, "results": [asdict(r) for r in results]}, indent=1),
        encoding="utf-8",
    )
    (out / "docs" / "GOVDATA-DISCOVERY.md").write_text(
        render_markdown(results, summary, meta), encoding="utf-8"
    )
    print(json.dumps({**summary, "requests": ctx.requests}, indent=1))
    for r in results:
        if r.status == FAILED:
            print(f"FAILED {r.id}: {r.detail}")
    return 1 if summary[FAILED] else 0


if __name__ == "__main__":
    raise SystemExit(main())
