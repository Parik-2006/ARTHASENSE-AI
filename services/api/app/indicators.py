"""Read-only indicator endpoints (CPI, WPI, IIP). They serve only what is stored in PostgreSQL.

Selection policy (the same for every indicator): for each series and month the observation from
the most recently retrieved snapshot is returned, or only snapshot `release_key` when given.
Every value carries its release key and retrieval time. Publication dates are unknown (NULL).
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

import psycopg
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter(prefix="/api/v1/indicators", tags=["indicators"])

MAX_PERIODS = 240
SOURCE_NAME = "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki"

# ---- series registry (must match pipeline/ingest/*_records.py; a test enforces this) ------------
CPI_INDEX_SERIES = "mospi.cpi.2024.current.all_india.combined.general.index"
CPI_INFLATION_SERIES = "mospi.cpi.2024.current.all_india.combined.general.inflation_yoy"
CPI_SERIES = ("current", "back")


def cpi_codes(series: str) -> tuple[str, str]:
    return (
        f"mospi.cpi.2024.{series}.all_india.combined.general.index",
        f"mospi.cpi.2024.{series}.all_india.combined.general.inflation_yoy",
    )


WPI_BASES = ("2022-23", "2011-12")
DEFAULT_WPI_BASE = "2022-23"


def wpi_code(base_year: str) -> str:
    return f"mospi.wpi.{base_year}.india.all_commodities.index"


IIP_SECTORS: dict[str, str] = {
    "general": "General (headline)",
    "mining": "Mining",
    "manufacturing": "Manufacturing",
    "electricity": "Electricity",
    "water": "Water supply, sewerage & waste management",
}
IIP_BASES: dict[str, tuple[str, ...]] = {
    "2022-23": ("general", "mining", "manufacturing", "electricity", "water"),
    "2011-12": ("general", "mining", "manufacturing", "electricity"),
}
DEFAULT_IIP_BASE = "2022-23"


def iip_codes(base_year: str, sector: str) -> tuple[str, str]:
    stem = f"mospi.iip.{base_year}.india.{sector}"
    return f"{stem}.index", f"{stem}.growth_yoy"


# ---- SQL ---------------------------------------------------------------------------------------
# Per series and month: the observation from the most recently retrieved snapshot (or only from
# one snapshot when release_key is given). Newest months first.
_SQL = """
SELECT code, period_date, value, release_key, retrieved_at, published_at FROM (
  SELECT DISTINCT ON (s.code, o.period_date)
         s.code, o.period_date, o.value, r.release_key, r.retrieved_at, r.published_at
    FROM observations o
    JOIN series s ON s.id = o.series_id
    JOIN releases r ON r.id = o.release_id
   WHERE s.code = ANY(%(codes)s)
     AND (%(start)s::date IS NULL OR o.period_date >= %(start)s::date)
     AND (%(end)s::date IS NULL OR o.period_date <= %(end)s::date)
     AND (%(release_key)s::text IS NULL OR r.release_key = %(release_key)s::text)
   ORDER BY s.code, o.period_date, r.retrieved_at DESC, r.id DESC
) latest
ORDER BY period_date DESC, code
LIMIT %(row_limit)s
"""

Row = tuple[Any, ...]


def query_series_rows(
    database_url: str,
    codes: list[str],
    start: date | None,
    end: date | None,
    release_key: str | None,
    row_limit: int,
) -> list[Row]:
    params = {
        "codes": codes,
        "start": start,
        "end": end,
        "release_key": release_key,
        "row_limit": row_limit,
    }
    with psycopg.connect(database_url, connect_timeout=3) as conn:
        return conn.execute(_SQL, params).fetchall()


# ---- shared models -----------------------------------------------------------------------------


class Provenance(BaseModel):
    release_key: str
    retrieved_at: datetime
    published_at: datetime | None = None  # NULL: MoSPI's API gives no publication date


class Source(BaseModel):
    code: str = "mospi"
    name: str = SOURCE_NAME
    url: str = "https://api.mospi.gov.in"


def _number(value: Decimal) -> float:
    return float(value)


def _prov(key: str, retrieved_at: datetime, published_at: datetime | None) -> Provenance:
    return Provenance(release_key=key, retrieved_at=retrieved_at, published_at=published_at)


def _database_url() -> str:
    url = get_settings().database_url
    if not url:
        raise HTTPException(status_code=503, detail="database is not configured")
    return url


def _check_dates(start: date | None, end: date | None) -> None:
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="start must not be after end")


def _fetch(
    fetcher: Any,
    codes: list[str],
    start: date | None,
    end: date | None,
    release_key: str | None,
    row_limit: int,
) -> list[Row]:
    """Run a query function, turning database failures into a safe 503."""
    url = _database_url()
    try:
        return fetcher(url, codes, start, end, release_key, row_limit)
    except psycopg.Error:
        raise HTTPException(status_code=503, detail="database unavailable") from None


def _by_period(rows: list[Row]) -> dict[date, dict[str, tuple[float, Provenance]]]:
    out: dict[date, dict[str, tuple[float, Provenance]]] = {}
    for code, period, value, key, retrieved_at, published_at in rows:
        out.setdefault(period, {})[code] = (_number(value), _prov(key, retrieved_at, published_at))
    return out


def _newest(periods: dict[date, Any], limit: int) -> list[date]:
    return sorted(periods)[-limit:]  # chronological


LimitParam = Annotated[int, Query(ge=1, le=MAX_PERIODS, description="newest N months")]
StartParam = Annotated[date | None, Query(description="first month to include (YYYY-MM-DD)")]
EndParam = Annotated[date | None, Query(description="last month to include (YYYY-MM-DD)")]
ReleaseParam = Annotated[str | None, Query(description="only use this retrieval snapshot")]


# ---- CPI ---------------------------------------------------------------------------------------


class CpiObservation(BaseModel):
    period: date
    index: float | None = None
    inflation: float | None = None
    index_source: Provenance | None = None
    inflation_source: Provenance | None = None


class CpiResponse(BaseModel):
    indicator: str = "CPI"
    base_year: str = "2024"
    series: str = "current"
    geography: str = "All India"
    sector: str = "Combined"
    division: str = "CPI (General)"
    source: Source = Source()
    count: int
    observations: list[CpiObservation]
    note: str | None = None


def query_cpi_rows(
    database_url: str,
    start: date | None,
    end: date | None,
    release_key: str | None,
    limit: int,
    series: str = "current",
) -> list[Row]:
    return query_series_rows(database_url, list(cpi_codes(series)), start, end, release_key, limit * 2)


def build_observations(rows: list[Row], limit: int, series: str = "current") -> list[CpiObservation]:
    idx_code, infl_code = cpi_codes(series)
    by_period: dict[date, CpiObservation] = {}
    for code, period, value, key, retrieved_at, published_at in rows:
        obs = by_period.setdefault(period, CpiObservation(period=period))
        prov = _prov(key, retrieved_at, published_at)
        if code == idx_code:
            obs.index, obs.index_source = _number(value), prov
        elif code == infl_code:
            obs.inflation, obs.inflation_source = _number(value), prov
    return [by_period[p] for p in sorted(by_period)[-limit:]]  # chronological


@router.get("/cpi", response_model=CpiResponse)
def get_cpi(
    start: StartParam = None,
    end: EndParam = None,
    release_key: ReleaseParam = None,
    limit: LimitParam = 120,
    series: Annotated[
        Literal["current", "back"], Query(description="'back' = MoSPI's official back series (2013-2024)")
    ] = "current",
) -> CpiResponse:
    """All India / Combined / CPI (General), base 2024. `inflation` is null where MoSPI gave none."""
    _check_dates(start, end)
    url = _database_url()
    try:
        if series == "current":
            rows = query_cpi_rows(url, start, end, release_key, limit)
        else:
            rows = query_cpi_rows(url, start, end, release_key, limit, series=series)
    except psycopg.Error:
        raise HTTPException(status_code=503, detail="database unavailable") from None
    observations = build_observations(rows, limit, series)
    if release_key and not observations:
        raise HTTPException(status_code=404, detail="no data for that release_key")
    note = (
        None
        if observations
        else "No CPI observations stored yet. Run: python -m pipeline.ingest.cpi --year 2025"
    )
    return CpiResponse(series=series, count=len(observations), observations=observations, note=note)


# ---- WPI ---------------------------------------------------------------------------------------


class WpiObservation(BaseModel):
    period: date
    index: float | None = None
    index_source: Provenance | None = None


class WpiResponse(BaseModel):
    indicator: str = "WPI"
    base_year: str
    geography: str = "India"
    coverage: str = "All commodities (headline)"
    source: Source = Source()
    publisher_note: str = (
        "Compiled and published by the Office of the Economic Adviser, DPIIT; served via MoSPI"
    )
    count: int
    observations: list[WpiObservation]
    limitations: list[str] = [
        "The source API provides the index only: there is no official inflation figure here.",
        "The API does not distinguish provisional from final values.",
    ]
    note: str | None = None


@router.get("/wpi", response_model=WpiResponse)
def get_wpi(
    start: StartParam = None,
    end: EndParam = None,
    release_key: ReleaseParam = None,
    limit: LimitParam = 120,
    base_year: Annotated[
        Literal["2022-23", "2011-12"], Query(description="WPI base year")
    ] = DEFAULT_WPI_BASE,
) -> WpiResponse:
    """Headline Wholesale Price Index for one base year. Base years are never mixed."""
    _check_dates(start, end)
    code = wpi_code(base_year)
    rows = _fetch(query_series_rows, [code], start, end, release_key, limit)
    periods = _by_period(rows)
    observations = [
        WpiObservation(period=p, index=periods[p][code][0], index_source=periods[p][code][1])
        for p in _newest(periods, limit)
        if code in periods[p]
    ]
    if release_key and not observations:
        raise HTTPException(status_code=404, detail="no data for that release_key")
    note = (
        None
        if observations
        else "No WPI observations stored yet. Run: python -m pipeline.ingest.wpi --year 2025"
    )
    return WpiResponse(base_year=base_year, count=len(observations), observations=observations, note=note)


# ---- IIP ---------------------------------------------------------------------------------------


class IipObservation(BaseModel):
    period: date
    index: float | None = None
    growth: float | None = None  # MoSPI's official year-on-year growth, %
    index_source: Provenance | None = None
    growth_source: Provenance | None = None


class IipSector(BaseModel):
    key: str
    label: str


class IipResponse(BaseModel):
    indicator: str = "IIP"
    base_year: str
    geography: str = "India"
    sector: IipSector
    source: Source = Source()
    count: int
    observations: list[IipObservation]
    note: str | None = None


class IipSectorSeries(BaseModel):
    key: str
    label: str
    observations: list[IipObservation]


class IipSectorsResponse(BaseModel):
    indicator: str = "IIP"
    base_year: str
    geography: str = "India"
    source: Source = Source()
    sectors: list[IipSectorSeries]
    note: str | None = None


def _iip_observations(
    periods: dict[date, dict[str, tuple[float, Provenance]]], base_year: str, sector: str, limit: int
) -> list[IipObservation]:
    idx_code, gr_code = iip_codes(base_year, sector)
    wanted = [p for p in sorted(periods) if idx_code in periods[p] or gr_code in periods[p]][-limit:]
    out = []
    for p in wanted:
        idx, gr = periods[p].get(idx_code), periods[p].get(gr_code)
        out.append(
            IipObservation(
                period=p,
                index=idx[0] if idx else None,
                growth=gr[0] if gr else None,
                index_source=idx[1] if idx else None,
                growth_source=gr[1] if gr else None,
            )
        )
    return out


@router.get("/iip", response_model=IipResponse)
def get_iip(
    start: StartParam = None,
    end: EndParam = None,
    release_key: ReleaseParam = None,
    limit: LimitParam = 120,
    base_year: Annotated[
        Literal["2022-23", "2011-12"], Query(description="IIP base year")
    ] = DEFAULT_IIP_BASE,
    sector: Annotated[
        Literal["general", "mining", "manufacturing", "electricity", "water"],
        Query(description="'general' is the headline IIP"),
    ] = "general",
) -> IipResponse:
    """Monthly IIP for one base year and one category. Categories are never merged."""
    _check_dates(start, end)
    if sector not in IIP_BASES[base_year]:
        raise HTTPException(status_code=422, detail=f"sector {sector!r} does not exist for base {base_year}")
    codes = list(iip_codes(base_year, sector))
    rows = _fetch(query_series_rows, codes, start, end, release_key, limit * 2)
    observations = _iip_observations(_by_period(rows), base_year, sector, limit)
    if release_key and not observations:
        raise HTTPException(status_code=404, detail="no data for that release_key")
    note = (
        None
        if observations
        else "No IIP observations stored yet. Run: python -m pipeline.ingest.iip --year 2025"
    )
    return IipResponse(
        base_year=base_year,
        sector=IipSector(key=sector, label=IIP_SECTORS[sector]),
        count=len(observations),
        observations=observations,
        note=note,
    )


@router.get("/iip/sectors", response_model=IipSectorsResponse)
def get_iip_sectors(
    start: StartParam = None,
    end: EndParam = None,
    release_key: ReleaseParam = None,
    limit: LimitParam = 60,
    base_year: Annotated[
        Literal["2022-23", "2011-12"], Query(description="IIP base year")
    ] = DEFAULT_IIP_BASE,
) -> IipSectorsResponse:
    """History of every sector total (not the headline) for one base year, one list per sector."""
    _check_dates(start, end)
    keys = [k for k in IIP_BASES[base_year] if k != "general"]
    codes = [c for k in keys for c in iip_codes(base_year, k)]
    rows = _fetch(query_series_rows, codes, start, end, release_key, limit * len(codes))
    periods = _by_period(rows)
    sectors = [
        IipSectorSeries(
            key=k, label=IIP_SECTORS[k], observations=_iip_observations(periods, base_year, k, limit)
        )
        for k in keys
    ]
    if release_key and not any(s.observations for s in sectors):
        raise HTTPException(status_code=404, detail="no data for that release_key")
    note = (
        None
        if any(s.observations for s in sectors)
        else "No IIP sector observations stored yet. Run: python -m pipeline.ingest.iip --year 2025"
    )
    return IipSectorsResponse(base_year=base_year, sectors=sectors, note=note)
