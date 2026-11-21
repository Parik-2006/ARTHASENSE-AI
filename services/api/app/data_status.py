# ruff: noqa: E501  (registry text and SQL are kept on readable long lines)
"""Read-only data-governance endpoints: what is stored, where it came from, how fresh it is.

    GET /api/v1/data/coverage     per stored series: span, months, gaps, base year, snapshots
    GET /api/v1/data/sources      official publishers and how each indicator is obtained
    GET /api/v1/data/freshness    newest stored month vs. the month we would expect by now
    GET /api/v1/data/ingestion    recent ingestion / update-check runs
    GET /api/v1/data/revisions    months whose value differs between retrieval snapshots

Nothing is computed from outside the database except the static source registry below. The ingestion,
freshness and revision endpoints need migration 0003; on a database that does not have it yet they answer
with `available: false` instead of failing, so the API stays compatible with an older schema.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException, Query
from psycopg import errors as pg_errors
from pydantic import BaseModel

from app.config import get_settings
from app.db import connect

router = APIRouter(prefix="/api/v1/data", tags=["data-status"])

BASE_NOTE = (
    "Each base year is its own series. Series on different base years are never merged, and no linking "
    "factor is applied unless an official one is stored."
)


# ---- static registry (publisher facts; base-year lists were read from the source's own metadata
# endpoints; portal reachability is noted per entry where it could not be confirmed) ---------------


class SourceInfo(BaseModel):
    indicator: str
    publisher: str
    dataset: str
    portal_url: str
    access_method: str
    bases_ingested: list[str]
    bases_listed_by_source_not_ingested: list[str]
    release_dates_provided: bool = False
    revision_policy: str
    notes: str


SOURCES: tuple[SourceInfo, ...] = (
    SourceInfo(
        indicator="CPI",
        publisher="National Statistics Office, Ministry of Statistics and Programme Implementation (MoSPI)",
        dataset="Consumer Price Index (CPI), All India, Combined, General; series Current and Back",
        portal_url="https://esankhyiki.mospi.gov.in/",
        access_method="MoSPI eSankhyiki REST API (/api/cpi/getCPIData), read-only JSON",
        bases_ingested=["2024 (Current)", "2024 (Back series, 2013-2024)", "2012 (legacy, all-India general index, 2013-2025)"],
        bases_listed_by_source_not_ingested=["2012 group/item level", "2010 (the source returned no all-India general index for it)"],
        revision_policy="Not stated by the API. ArthaSense stores each retrieval as a snapshot and reports value changes.",
        notes="The Back series is MoSPI's own back-cast onto the 2024 base and is kept as a separate segment.",
    ),
    SourceInfo(
        indicator="WPI",
        publisher="Office of the Economic Adviser, DPIIT (served through the MoSPI eSankhyiki API)",
        dataset="Wholesale Price Index, all commodities (headline)",
        portal_url="https://eaindustry.nic.in/",
        access_method="MoSPI eSankhyiki REST API (/api/wpi/getWpiRecords), read-only JSON",
        bases_ingested=["2022-23", "2011-12", "2004-05 (archive)", "1993-94 (archive)"],
        bases_listed_by_source_not_ingested=[],
        revision_policy="Not stated by the API. ArthaSense stores each retrieval as a snapshot and reports value changes.",
        notes=(
            "The OEA home page failed TLS verification from the build machine (incomplete certificate chain), "
            "so it was not re-verified; it is shown as the publisher's site, not as the data source. "
            "The API provides the index only: there is no official WPI inflation rate."
        ),
    ),
    SourceInfo(
        indicator="IIP",
        publisher="National Statistics Office, MoSPI",
        dataset="Index of Industrial Production: General plus Mining, Manufacturing, Electricity (and Water on 2022-23)",
        portal_url="https://esankhyiki.mospi.gov.in/",
        access_method="MoSPI eSankhyiki REST API (/api/iip/getIipData), read-only JSON",
        bases_ingested=["2022-23", "2011-12", "2004-05 (archive, General index only)", "1993-94 (archive, General index only)"],
        bases_listed_by_source_not_ingested=[],
        revision_policy="Not stated by the API. ArthaSense stores each retrieval as a snapshot and reports value changes.",
        notes="Official growth rates are stored only where the source gives them for the same base; archive bases store the index only.",
    ),
)

PLANNED = [
    {"indicator": "GDP / GVA", "status": "planned", "note": "Not ingested. The MoSPI API exposes National Accounts (/api/nas)."},
    {"indicator": "RBI repo rate", "status": "planned", "note": "Not ingested. The MoSPI API proxies RBI records (/api/rbi); the RBI is the primary source."},
]  # fmt: skip


# ---- SQL ------------------------------------------------------------------------------------------------

COVERAGE_SQL = """
WITH cur AS (
  SELECT series_id, period_date FROM (
    SELECT DISTINCT ON (o.series_id, o.period_date) o.series_id, o.period_date
      FROM observations o JOIN releases r ON r.id = o.release_id
     ORDER BY o.series_id, o.period_date, r.retrieved_at DESC, r.id DESC) x
), agg AS (
  SELECT series_id, min(period_date) AS first, max(period_date) AS last, count(*) AS months
    FROM cur GROUP BY series_id
), snaps AS (
  SELECT series_id, count(DISTINCT release_id) AS snapshots, max(r.retrieved_at) AS last_retrieved
    FROM observations o JOIN releases r ON r.id = o.release_id GROUP BY series_id
)
SELECT s.code, s.indicator, s.base_year, s.unit, s.geography, a.first, a.last, a.months,
       snaps.snapshots, snaps.last_retrieved,
       (SELECT array_agg(m::date ORDER BY m)
          FROM generate_series(a.first, a.last, interval '1 month') m
         WHERE NOT EXISTS (SELECT 1 FROM cur c WHERE c.series_id = s.id AND c.period_date = m::date)) AS missing
  FROM series s JOIN agg a ON a.series_id = s.id JOIN snaps ON snaps.series_id = s.id
 ORDER BY s.indicator, s.base_year DESC, s.code
"""

FRESHNESS_SQL = """
SELECT p.indicator, p.expected_lag_months, p.grace_days, p.basis,
       (SELECT max(o.period_date) FROM observations o JOIN series s ON s.id = o.series_id
         WHERE s.indicator = p.indicator)
  FROM freshness_policy p ORDER BY p.indicator
"""

RUNS_SQL = """
SELECT id, indicator, mode, trigger, status, base_year, year_from, year_to, started_at, finished_at,
       records_fetched, rows_new, rows_unchanged, rows_revised, rows_rejected, error
  FROM ingestion_runs ORDER BY started_at DESC, id DESC LIMIT %(n)s
"""

REVISIONS_SQL = """
SELECT series_code, period_date, distinct_values, snapshots, first_seen, last_seen
  FROM observation_revisions ORDER BY period_date DESC, series_code LIMIT %(n)s
"""

LINKING_SQL = "SELECT count(*) FROM linking_factors"


def _run(sql: str, params: dict[str, Any] | None = None) -> tuple[bool, list[tuple[Any, ...]]]:
    """(available, rows). A missing table/view (older schema) is not an error."""
    url = get_settings().database_url
    if not url:
        raise HTTPException(status_code=503, detail="database is not configured")
    try:
        with connect(url, get_settings().api_connect_timeout_s) as conn:
            conn.read_only = True
            return True, conn.execute(sql, params or {}).fetchall()
    except (pg_errors.UndefinedTable, pg_errors.UndefinedColumn):
        return False, []
    except psycopg.Error:
        raise HTTPException(status_code=503, detail="database unavailable") from None


# ---- models ---------------------------------------------------------------------------------------------


class SeriesCoverage(BaseModel):
    code: str
    indicator: str
    base_year: str | None
    unit: str
    geography: str
    kind: str  # index | official_rate
    first_period: date
    last_period: date
    months_stored: int
    months_in_span: int
    missing_months: list[date]
    snapshots: int
    last_retrieved_at: datetime


class CoverageResponse(BaseModel):
    series: list[SeriesCoverage]
    linking_factors_stored: int
    base_year_note: str = BASE_NOTE


def _kind(code: str) -> str:
    return "index" if code.endswith(".index") else "official_rate"


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + b.month - a.month + 1


@router.get("/coverage", response_model=CoverageResponse)
def coverage() -> CoverageResponse:
    """Per stored series: first/last month, months stored, missing months, base year and snapshot count."""
    _, rows = _run(COVERAGE_SQL)
    out = [
        SeriesCoverage(
            code=code, indicator=ind, base_year=base, unit=unit, geography=geo, kind=_kind(code),
            first_period=first, last_period=last, months_stored=months,
            months_in_span=_months_between(first, last), missing_months=missing or [],
            snapshots=snaps, last_retrieved_at=retrieved,
        )
        for code, ind, base, unit, geo, first, last, months, snaps, retrieved, missing in rows
    ]  # fmt: skip
    _, link = _run(LINKING_SQL)
    return CoverageResponse(series=out, linking_factors_stored=link[0][0] if link else 0)


class SourcesResponse(BaseModel):
    sources: list[SourceInfo]
    planned: list[dict[str, str]]
    base_year_note: str = BASE_NOTE


@router.get("/sources", response_model=SourcesResponse)
def sources() -> SourcesResponse:
    """Publishers, datasets and access methods. Static: it states where data comes from, not what is stored."""
    return SourcesResponse(sources=list(SOURCES), planned=PLANNED)


class Freshness(BaseModel):
    indicator: str
    status: str  # current | stale | no_data
    latest_period: date | None
    expected_period: date
    months_behind: int | None
    basis: str


class FreshnessResponse(BaseModel):
    available: bool
    as_of: date
    indicators: list[Freshness]
    note: str = (
        "Expected periods come from a configurable policy (an assumption about publication lag), "
        "not from the publisher's release calendar."
    )


def _expected(today: date, lag: int, grace: int) -> date:
    from datetime import timedelta

    ref = today - timedelta(days=grace)
    n = ref.year * 12 + ref.month - 1 - lag
    return date(n // 12, n % 12 + 1, 1)


@router.get("/freshness", response_model=FreshnessResponse)
def freshness() -> FreshnessResponse:
    """Is the newest stored month the one we would expect by now? Stale data is reported, never hidden."""
    ok, rows = _run(FRESHNESS_SQL)
    today = datetime.now(UTC).date()
    items = []
    for ind, lag, grace, basis, latest in rows:
        exp = _expected(today, lag, grace)
        behind = None if latest is None else max(0, (exp.year - latest.year) * 12 + exp.month - latest.month)
        status = "no_data" if latest is None else ("stale" if behind else "current")
        items.append(Freshness(indicator=ind, status=status, latest_period=latest, expected_period=exp,
                               months_behind=behind, basis=basis))  # fmt: skip
    return FreshnessResponse(available=ok, as_of=today, indicators=items)


class IngestionRun(BaseModel):
    id: int
    target: str
    mode: str
    trigger: str
    status: str
    base_year: str | None
    year_from: int | None
    year_to: int | None
    started_at: datetime
    finished_at: datetime | None
    records_fetched: int | None
    rows_new: int | None
    rows_unchanged: int | None
    rows_revised: int | None
    rows_rejected: int | None
    error: str | None


class IngestionResponse(BaseModel):
    available: bool
    runs: list[IngestionRun]


@router.get("/ingestion", response_model=IngestionResponse)
def ingestion(limit: int = Query(20, ge=1, le=100)) -> IngestionResponse:
    """Most recent ingestion runs (newest first). Empty with `available: false` before migration 0003."""
    ok, rows = _run(RUNS_SQL, {"n": limit})
    keys = list(IngestionRun.model_fields)
    return IngestionResponse(
        available=ok, runs=[IngestionRun(**dict(zip(keys, r, strict=True))) for r in rows]
    )


class Revision(BaseModel):
    series_code: str
    period: date
    distinct_values: int
    snapshots: int
    first_seen: datetime
    last_seen: datetime


class RevisionsResponse(BaseModel):
    available: bool
    revisions: list[Revision]
    note: str = "Only months whose stored value differs between retrieval snapshots appear here."


@router.get("/revisions", response_model=RevisionsResponse)
def revisions(limit: int = Query(50, ge=1, le=500)) -> RevisionsResponse:
    ok, rows = _run(REVISIONS_SQL, {"n": limit})
    return RevisionsResponse(
        available=ok, revisions=[Revision(**dict(zip(Revision.model_fields, r, strict=True))) for r in rows]
    )
