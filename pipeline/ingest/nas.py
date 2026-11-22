# ruff: noqa: E501  (registry labels are kept verbatim on readable lines)
"""Quarterly GDP and GVA (National Accounts, base 2022-23) from MoSPI's eSankhyiki API -> PostgreSQL.

    python -m pipeline.ingest.nas --dry-run          # fetch + validate only
    python -m pipeline.ingest.nas                    # store into the LOCAL database (local-host guard)

Verified live on 2026-11-22 (docs/GDP-INGESTION.md), endpoint /api/nas/getNASData with
base_year=2022-23, series=Current, frequency_code=Quarterly:
  * indicator_code 5  "Gross Domestic Product", unit "₹ Crore"     -> real GDP level (field constant_price)
  * indicator_code 22 "GDP Growth Rate",        unit "%"           -> official real growth (constant_price)
  * indicator_code 1  "Gross Value Added",      unit "₹ Crore", 9 industries -> real GVA level per industry
  * indicator_code 21 "GVA Growth Rate",        unit "%",       9 industries -> official real GVA growth
`constant_price` is the real (inflation-adjusted, 2022-23 prices) measure and is the only one stored. Quarters are
fiscal (Q1 = Apr-Jun) and stored on their first month. Nothing monthly is created. A missing value is not stored.
The API reports no seasonal adjustment, publication date or provisional/final flag.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from pipeline.ingest.common import FetchError, ValidationError, fetch_paginated, parse_decimal
from pipeline.ingest.store_common import IngestStats, SeriesSpec, canonical_sha256, dec_str, store_snapshot
from pipeline.sources.mospi import BASE_URL, ENDPOINTS, MospiClient

SOURCE_CODE = "mospi"
SOURCE_NAME = "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki"
BASE_YEAR = "2022-23"
FILTERS: dict[str, Any] = {"base_year": BASE_YEAR, "series": "Current", "frequency_code": "Quarterly"}
PAGE_SIZE = 100

# Official industry labels (verbatim from the source) -> stable keys.
INDUSTRIES: dict[str, str] = {
    "Total Gross Value Added": "total",
    "Agriculture, Livestock, Forestry and Fishing": "agriculture",
    "Mining and Quarrying": "mining",
    "Manufacturing": "manufacturing",
    "Electricity, Gas, Water Supply & Other Utility Services": "electricity",
    "Construction": "construction",
    "Trade, Hotels, Transport, Communication & Services Related to Broadcasting": "trade",
    "Financial, Real Estate & Professional Services": "financial",
    "Public Administration, Defence & Other Services": "public",
}


@dataclass(frozen=True)
class Indicator:
    code: int
    label: str  # expected `indicator` text
    unit: str  # expected `unit`
    kind: str  # "level" | "growth_yoy"
    by_industry: bool


INDICATORS = (
    Indicator(5, "Gross Domestic Product", "₹ Crore", "level", False),
    Indicator(22, "GDP Growth Rate", "%", "growth_yoy", False),
    Indicator(1, "Gross Value Added", "₹ Crore", "level", True),
    Indicator(21, "GVA Growth Rate", "%", "growth_yoy", True),
)


def series_code(ind: Indicator, industry: str | None) -> str:
    stem = f"mospi.nas.{BASE_YEAR}.india"
    return f"{stem}.gva.{industry}.real.{ind.kind}" if ind.by_industry else f"{stem}.gdp.real.{ind.kind}"


def quarter_start(fiscal_year: Any, quarter: Any) -> date:
    """FY "2023-24" Q1 -> 2023-04-01 ... Q4 -> 2024-01-01. Rejects anything else."""
    fy = str(fiscal_year or "")
    if len(fy) != 7 or fy[4] != "-" or not (fy[:4].isdigit() and fy[5:].isdigit()):
        raise ValidationError(f"year: expected a fiscal year like 2023-24, got {fiscal_year!r}")
    y = int(fy[:4])
    if (y + 1) % 100 != int(fy[5:]):
        raise ValidationError(f"year: {fiscal_year!r} is not a fiscal year")
    q = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}.get(str(quarter or ""))
    if q is None:
        raise ValidationError(f"quarter: expected Q1-Q4, got {quarter!r}")
    return date(y + 1, 1, 1) if q == 4 else date(y, 3 * q + 1, 1)


@dataclass(frozen=True)
class NasRecord:
    code: str  # series code
    period: date  # first month of the fiscal quarter
    value: Decimal | None


def validate_records(raws: list[dict[str, Any]], ind: Indicator) -> list[NasRecord]:
    seen: set[tuple[str, date]] = set()
    out: list[NasRecord] = []
    for i, r in enumerate(raws):
        try:
            for key, want in (
                ("base_year", BASE_YEAR),
                ("series", "Current"),
                ("frequency", "Quarterly"),
                ("indicator", ind.label),
                ("unit", ind.unit),
            ):
                if r.get(key) != want:  # the API can silently answer another base: check every record
                    raise ValidationError(f"{key}: expected {want!r}, got {r.get(key)!r}")
            if r.get("subindustry") not in (None, ""):
                raise ValidationError(f"subindustry: expected none, got {r.get('subindustry')!r}")
            industry = None
            if ind.by_industry:
                industry = INDUSTRIES.get(r.get("industry") or "")
                if industry is None:
                    raise ValidationError(f"industry: unexpected {r.get('industry')!r}")
            elif r.get("industry") not in (None, ""):
                raise ValidationError(f"industry: expected none for {ind.label}, got {r.get('industry')!r}")
            period = quarter_start(r.get("year"), r.get("quarter"))
            value = parse_decimal(
                str(r.get("constant_price")).rstrip("%")
                if r.get("constant_price") not in (None, "")
                else None,
                "constant_price",
            )
        except ValidationError as exc:
            raise ValidationError(f"indicator {ind.code} record {i}: {exc}") from None
        code = series_code(ind, industry)
        if (code, period) in seen:
            raise ValidationError(f"indicator {ind.code}: duplicate {code} {period.isoformat()}")
        seen.add((code, period))
        out.append(NasRecord(code, period, value))
    if ind.by_industry and len({rec.code for rec in out}) != len(INDUSTRIES):
        raise ValidationError(f"indicator {ind.code}: expected all {len(INDUSTRIES)} industries")
    return sorted(out, key=lambda x: (x.code, x.period))


def fetch_all(client: MospiClient, delay_s: float = 0.5) -> tuple[list[NasRecord], datetime]:
    records: list[NasRecord] = []
    retrieved = datetime.now(UTC)
    for ind in INDICATORS:
        res = fetch_paginated(
            client, "nas", {**FILTERS, "indicator_code": ind.code},
            key_fn=lambda r: (r.get("year"), r.get("quarter"), r.get("industry")), page_size=PAGE_SIZE, delay_s=delay_s,
        )  # fmt: skip
        if not res.records:
            raise FetchError(f"MoSPI returned no records for NAS indicator {ind.code}")
        records += validate_records(res.records, ind)
    return records, retrieved


def specs() -> dict[str, SeriesSpec]:
    out: dict[str, SeriesSpec] = {}
    rev = {v: k for k, v in INDUSTRIES.items()}
    for ind in INDICATORS:
        unit = "₹ crore at constant 2022-23 prices" if ind.kind == "level" else "percent, year-on-year (real)"
        keys = list(INDUSTRIES.values()) if ind.by_industry else [None]
        for k in keys:
            code = series_code(ind, k)
            what = f"GVA {rev[k]}" if k else "GDP"
            out[code] = SeriesSpec(
                code,
                f"{what} (base {BASE_YEAR}, quarterly): {'real level' if ind.kind == 'level' else 'official real growth, YoY'}",
                "GDP",
                unit,
                BASE_YEAR,
                "India",
                "quarterly",
            )
    return out


def source_url() -> str:
    q = "&".join(f"{k}={v}" for k, v in FILTERS.items())
    return f"{BASE_URL}{ENDPOINTS['nas']}?{q}&indicator_code={{1,5,21,22}}"


def snapshot_sha256(records: list[NasRecord]) -> str:
    return canonical_sha256(
        {
            "filters": {k: str(v) for k, v in sorted(FILTERS.items())},
            "records": [[r.code, r.period.isoformat(), dec_str(r.value)] for r in records],
        }
    )


def store_nas(conn, records: list[NasRecord], retrieved_at: datetime) -> IngestStats:
    sha = snapshot_sha256(records)
    return store_snapshot(
        conn, source_code=SOURCE_CODE, source_name=SOURCE_NAME, base_url=BASE_URL,
        release_key=f"mospi-nas-{BASE_YEAR}-quarterly-{sha[:16]}", sha256=sha, retrieved_at=retrieved_at,
        source_url=source_url(), specs=specs(), observations=[(r.code, r.period, r.value) for r in records],
    )  # fmt: skip


def main(argv: list[str] | None = None, client: MospiClient | None = None) -> int:
    import httpx
    import psycopg

    from pipeline.ingest.config import database_url
    from pipeline.ingest.safety import RemoteTargetRefused, require_allowed_host
    from pipeline.sources.mospi import USER_AGENT

    p = argparse.ArgumentParser(
        prog="python -m pipeline.ingest.nas",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--delay", type=float, default=0.5)
    p.add_argument("--allow-host", default=None)
    a = p.parse_args(argv)
    url = None
    if not a.dry_run:
        url = database_url()
        if not url:
            print("Error: ARTHASENSE_DATABASE_URL is not set", file=sys.stderr)
            return 2
        try:
            print(f"Database host: {require_allowed_host(url, a.allow_host)}")
        except RemoteTargetRefused as exc:
            print(str(exc), file=sys.stderr)
            return 2
    own = client is None
    mospi = client or MospiClient(
        httpx.Client(timeout=40.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    )
    try:
        records, at = fetch_all(mospi, a.delay)
    except (FetchError, ValidationError) as exc:
        print(f"Status: FAILED ({exc})", file=sys.stderr)
        return 1
    finally:
        if own:
            mospi.close()
    by = {}
    for r in records:
        by.setdefault(r.code, []).append(r)
    for code, rs in sorted(by.items()):
        vals = [r for r in rs if r.value is not None]
        print(f"{code}: {len(vals)} values, {rs[0].period:%Y-%m} .. {rs[-1].period:%Y-%m}")
    if a.dry_run:
        print("Status: SUCCESS (dry run)")
        return 0
    with psycopg.connect(url, connect_timeout=5) as conn:
        st = store_nas(conn, records, at)
    print(
        f"Release {st.release_key}: inserted {st.inserted}, unchanged {st.unchanged}, skipped missing {st.skipped_missing}"
    )
    print("Status: SUCCESS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
