"""IIP ingestion (General + sector totals): MoSPI API -> validation -> PostgreSQL.

    python -m pipeline.ingest.iip --year 2025 --dry-run
    python -m pipeline.ingest.iip --year 2025
    python -m pipeline.ingest.iip --year 2025 --sectors general,mining

Index and official year-on-year growth are stored as separate series, one pair per category.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from typing import Any

import psycopg

from pipeline.ingest.common import PagedResult, fetch_paginated
from pipeline.ingest.iip_records import (
    DEFAULT_BASE,
    GEOGRAPHY,
    IIP_BASES,
    SOURCE_CODE,
    SOURCE_NAME,
    IipCategory,
    IipRecord,
    categories,
    series_codes,
    validate_records,
)
from pipeline.ingest.runner import Ingester, run_cli
from pipeline.ingest.store_common import (
    IngestStats,
    SeriesSpec,
    canonical_sha256,
    dec_str,
    store_snapshot,
)
from pipeline.sources.mospi import BASE_URL, ENDPOINTS, MospiClient

PAGE_SIZE = 100  # verified accepted; the API maximum is 200


def _cats(a: argparse.Namespace) -> list[IipCategory]:
    keys = [k.strip() for k in a.sectors.split(",") if k.strip()] if a.sectors else None
    return categories(a.base_year, keys)


def request_params(base_year: str, cat: IipCategory, year: int) -> dict[str, Any]:
    params: dict[str, Any] = {
        "base_year": base_year,
        "frequency": "Monthly",
        "type": cat.type,
        "year": year,
    }
    if cat.type == "Sectoral":
        params["category_code"] = cat.code
    return params


def snapshot_sha256(
    records: list[IipRecord], start_year: int, end_year: int, base_year: str, cats: list[IipCategory]
) -> str:
    return canonical_sha256(
        {
            "base_year": base_year,
            "categories": sorted(c.key for c in cats),
            "years": [start_year, end_year],
            "records": [
                [r.category, r.period.isoformat(), dec_str(r.index), dec_str(r.growth)]
                for r in sorted(records, key=lambda r: (r.category, r.period))
            ],
        }
    )


def key_prefix(start_year: int, end_year: int, base_year: str, cats: list[IipCategory]) -> str:
    scope = "all" if len(cats) == len(IIP_BASES[base_year].categories) else "custom"
    return f"mospi-iip-{base_year}-{scope}-{start_year}-{end_year}-"


def specs(base_year: str, cats: list[IipCategory]) -> dict[str, SeriesSpec]:
    out: dict[str, SeriesSpec] = {}
    for c in cats:
        idx, gr = series_codes(base_year, c.key)
        label = f"IIP (base {base_year}), {GEOGRAPHY} / {c.label}"
        out[idx] = SeriesSpec(idx, f"{label}: index", "IIP", f"index ({base_year}=100)", base_year, GEOGRAPHY)
        out[gr] = SeriesSpec(gr, f"{label}: year-on-year growth", "IIP", "percent", base_year, GEOGRAPHY)
    return out


def store_iip(
    conn: psycopg.Connection,
    records: list[IipRecord],
    *,
    start_year: int,
    end_year: int,
    retrieved_at: datetime,
    base_year: str = DEFAULT_BASE,
    cats: list[IipCategory] | None = None,
) -> IngestStats:
    cats = cats or categories(base_year)
    sha = snapshot_sha256(records, start_year, end_year, base_year, cats)
    obs = []
    for r in records:
        idx, gr = series_codes(base_year, r.category)
        obs += [(idx, r.period, r.index), (gr, r.period, r.growth)]
    years = str(start_year) if start_year == end_year else f"{start_year}..{end_year}"
    return store_snapshot(
        conn,
        source_code=SOURCE_CODE,
        source_name=SOURCE_NAME,
        base_url=BASE_URL,
        release_key=key_prefix(start_year, end_year, base_year, cats) + sha[:16],
        sha256=sha,
        retrieved_at=retrieved_at,
        source_url=f"{BASE_URL}{ENDPOINTS['iip']}?base_year={base_year}&frequency=Monthly&year={years}",
        specs=specs(base_year, cats),
        observations=obs,
    )


# ---- plumbing for the generic CLI / history runner -------------------------------------------


def _add_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--base-year", choices=sorted(IIP_BASES), default=DEFAULT_BASE, help="IIP base year")
    p.add_argument(
        "--sectors",
        default="",
        help="comma-separated subset, e.g. general,mining (default: every category of the base year)",
    )


def _fetch_year(client: MospiClient, year: int, delay_s: float, a: argparse.Namespace) -> PagedResult:
    """One bounded query per category (General: 1 page; each sector: ~2-3 pages of 100)."""
    rows: list[dict[str, Any]] = []
    pages = requests = 0
    first = None
    for cat in _cats(a):
        res = fetch_paginated(
            client,
            "iip",
            request_params(a.base_year, cat, year),
            key_fn=lambda r: (
                r.get("year"),
                r.get("month"),
                r.get("type"),
                r.get("category"),
                r.get("sub_category"),
            ),
            page_size=PAGE_SIZE,
            delay_s=delay_s,
        )
        first = first or res.retrieved_at
        rows += res.records
        pages += res.pages
        requests += res.requests
    return PagedResult(rows, pages, requests, first or datetime.now(UTC))


INGESTER = Ingester(
    name="IIP",
    prog="python -m pipeline.ingest.iip",
    doc=__doc__ or "",
    add_args=_add_args,
    first_year=lambda a: IIP_BASES[a.base_year].first_year,
    header=lambda a: [
        f"Base year: {a.base_year}",
        f"Coverage: {GEOGRAPHY} / " + ", ".join(c.label for c in _cats(a)),
    ],
    fetch_year=_fetch_year,
    validate=lambda raws, s, e, a: validate_records(raws, s, e, a.base_year, _cats(a)),
    summary=lambda recs, a: [
        f"Categories: {', '.join(sorted({r.category for r in recs}))}",
        f"Period range: {min(r.period for r in recs)} to {max(r.period for r in recs)}",
        f"Missing index values: {sum(r.index is None for r in recs)}",
        f"Missing growth values: {sum(r.growth is None for r in recs)}",
        "Growth withheld (not year-on-year, base-year-relative) for "
        f"{sum(r.period < IIP_BASES[a.base_year].rate_valid_from for r in recs)} record(s) "
        f"before {IIP_BASES[a.base_year].rate_valid_from:%Y-%m}",
    ],
    store=lambda conn, recs, s, e, at, a: store_iip(
        conn, recs, start_year=s, end_year=e, retrieved_at=at, base_year=a.base_year, cats=_cats(a)
    ),
    key_prefix=lambda s, e, a: key_prefix(s, e, a.base_year, _cats(a)),
)


def main(argv: list[str] | None = None, client: MospiClient | None = None) -> int:
    return run_cli(INGESTER, argv, client)


if __name__ == "__main__":
    raise SystemExit(main())
