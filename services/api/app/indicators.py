# ruff: noqa: E501  (registry and limitation text stay on readable lines)
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
from app.db import connect

router = APIRouter(prefix="/api/v1/indicators", tags=["indicators"])

MAX_PERIODS = 240
SOURCE_NAME = "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki"

# ---- series registry (must match pipeline/ingest/*_records.py; a test enforces this) ------------
CPI_INDEX_SERIES = "mospi.cpi.2024.current.all_india.combined.general.index"
CPI_INFLATION_SERIES = "mospi.cpi.2024.current.all_india.combined.general.inflation_yoy"
CPI_SERIES = ("current", "back")  # the two series on the 2024 base
CPI_LEGACY = (
    "legacy2012"  # separate series on the 2012 base (Jan 2013 - Dec 2025); never merged with the above
)


def cpi_codes(series: str) -> tuple[str, str]:
    if series == CPI_LEGACY:
        return (
            "mospi.cpi.2012.current.all_india.combined.general.index",
            "mospi.cpi.2012.current.all_india.combined.general.inflation_yoy",
        )
    return (
        f"mospi.cpi.2024.{series}.all_india.combined.general.index",
        f"mospi.cpi.2024.{series}.all_india.combined.general.inflation_yoy",
    )


WPI_BASES = ("2022-23", "2011-12", "2004-05", "1993-94")  # 2004-05 and 1993-94 are closed archive series
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
    "2004-05": ("general",),  # archive: index only
    "1993-94": ("general",),
}
DEFAULT_IIP_BASE = "2022-23"


def iip_codes(base_year: str, sector: str) -> tuple[str, str]:
    stem = f"mospi.iip.{base_year}.india.{sector}"
    return f"{stem}.index", f"{stem}.growth_yoy"


# ---- SQL ---------------------------------------------------------------------------------------
# Per series and month: the observation from the most recently retrieved snapshot (or only from
# one snapshot when release_key is given). Newest months first.
_SQL = """
SELECT code, period_date, value, release_key, retrieved_at, published_at, status FROM (
  SELECT DISTINCT ON (s.code, o.period_date)
         s.code, o.period_date, o.value, r.release_key, r.retrieved_at, r.published_at, o.status
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
    with connect(database_url, get_settings().api_connect_timeout_s) as conn:
        return conn.execute(_SQL, params).fetchall()


# ---- shared models -----------------------------------------------------------------------------


class Provenance(BaseModel):
    release_key: str
    retrieved_at: datetime
    published_at: datetime | None = None  # NULL: MoSPI's API gives no publication date
    status: str | None = (
        None  # the SOURCE's finality flag where it gives one (e.g. CPI 2012: source_final); else 'retrieved'
    )


class Source(BaseModel):
    code: str = "mospi"
    name: str = SOURCE_NAME
    url: str = "https://api.mospi.gov.in"


def _number(value: Decimal) -> float:
    return float(value)


def _prov(
    key: str, retrieved_at: datetime, published_at: datetime | None, status: str | None = None
) -> Provenance:
    return Provenance(release_key=key, retrieved_at=retrieved_at, published_at=published_at, status=status)


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
    for code, period, value, key, retrieved_at, published_at, *rest in rows:
        out.setdefault(period, {})[code] = (
            _number(value),
            _prov(key, retrieved_at, published_at, rest[0] if rest else None),
        )
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
    limitations: list[str] = []
    note: str | None = None


LEGACY_CPI_LIMITATIONS = [
    "CPI base 2012 is a separate series from the 2024 base (Current and Back). It is not linked or merged with them.",
    "The source has stopped publishing the 2012 base: its last month is December 2025.",
    "The first year (2013) has no year-on-year inflation, because the 2012 base starts in January 2013.",
    "April and May 2020 carry the source flag F*, which the API does not define. MoSPI's own press releases and technical note state that CPI indices for those two months were imputed because the lockdown halted price collection, and caution against naive time-series use; ArthaSense does not claim F* means the same thing.",
]


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
    for code, period, value, key, retrieved_at, published_at, *rest in rows:
        obs = by_period.setdefault(period, CpiObservation(period=period))
        prov = _prov(key, retrieved_at, published_at, rest[0] if rest else None)
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
        Literal["current", "back", "legacy2012"],
        Query(
            description="'back' = MoSPI's official back series on the 2024 base; 'legacy2012' = the separate 2012-base series"
        ),
    ] = "current",
) -> CpiResponse:
    """All India / Combined / CPI (General). Base 2024 (current, back) or the separate 2012 base. `inflation` is null where MoSPI gave none."""
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
    legacy = series == CPI_LEGACY
    return CpiResponse(
        series=series,
        base_year="2012" if legacy else "2024",
        count=len(observations),
        observations=observations,
        limitations=LEGACY_CPI_LIMITATIONS if legacy else [],
        note=note,
    )


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
        Literal["2022-23", "2011-12", "2004-05", "1993-94"], Query(description="WPI base year")
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
        Literal["2022-23", "2011-12", "2004-05", "1993-94"], Query(description="IIP base year")
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
        Literal["2022-23", "2011-12", "2004-05", "1993-94"], Query(description="IIP base year")
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


# ---- GDP and GVA (quarterly National Accounts, base 2022-23) -------------------------------------
# Must match pipeline/ingest/nas.py. Quarters are fiscal (Q1 = Apr-Jun), stored on their first month.
GDP_BASE = "2022-23"
_NAS = f"mospi.nas.{GDP_BASE}.india"
GDP_LEVEL_SERIES = f"{_NAS}.gdp.real.level"
GDP_GROWTH_SERIES = f"{_NAS}.gdp.real.growth_yoy"
GVA_INDUSTRIES: dict[str, str] = {  # official MoSPI industry labels, verbatim
    "total": "Total Gross Value Added",
    "agriculture": "Agriculture, Livestock, Forestry and Fishing",
    "mining": "Mining and Quarrying",
    "manufacturing": "Manufacturing",
    "electricity": "Electricity, Gas, Water Supply & Other Utility Services",
    "construction": "Construction",
    "trade": "Trade, Hotels, Transport, Communication & Services Related to Broadcasting",
    "financial": "Financial, Real Estate & Professional Services",
    "public": "Public Administration, Defence & Other Services",
}
NAS_SOURCE_URL = (
    "https://api.mospi.gov.in/api/nas/getNASData?base_year=2022-23&series=Current&frequency_code=Quarterly"
)
NAS_LIMITATIONS = [
    "Quarterly estimates at constant 2022-23 prices (real). There is no monthly GDP; none is estimated here.",
    "Growth is the official year-on-year rate: each quarter against the same quarter a year earlier.",
    "The new 2022-23 series starts in FY2022-23, so official growth begins in Q1 FY2023-24. The back series on this base is not yet published, and the older 2011-12 series is not joined to it.",
    "The source API gives no publication date and no provisional/revised flag; recent quarters are usually revised in later releases.",
    "Not seasonally adjusted: no quarter-on-quarter change is calculated.",
]
MAX_QUARTERS = 80


def fiscal_quarter(period: date) -> tuple[str, int]:
    """2025-04-01 -> ("2025-26", 1); 2026-01-01 -> ("2025-26", 4)."""
    if period.day != 1 or period.month not in (1, 4, 7, 10):
        raise ValueError(f"not a fiscal-quarter start: {period}")
    fy = period.year if period.month >= 4 else period.year - 1
    q = {4: 1, 7: 2, 10: 3, 1: 4}[period.month]
    return f"{fy}-{(fy + 1) % 100:02d}", q


class GdpObservation(BaseModel):
    period: date  # first month of the fiscal quarter
    fiscal_year: str
    quarter: int
    level: float | None = None
    growth_yoy: float | None = None
    level_source: Provenance | None = None
    growth_source: Provenance | None = None


class GdpResponse(BaseModel):
    indicator: str = "GDP"
    base_year: str = GDP_BASE
    frequency: str = "quarterly"
    measure: str = "GDP at constant 2022-23 prices (real)"
    unit: str = "₹ crore"
    geography: str = "India"
    seasonally_adjusted: bool = False
    source: Source = Source()
    source_url: str = NAS_SOURCE_URL
    publisher_note: str = "National Accounts Division, National Statistics Office (NSO), MoSPI"
    count: int
    observations: list[GdpObservation]
    limitations: list[str] = NAS_LIMITATIONS


class GvaObservation(BaseModel):
    period: date
    fiscal_year: str
    quarter: int
    growth_yoy: float | None = None
    level: float | None = None
    growth_source: Provenance | None = None


class GvaIndustry(BaseModel):
    key: str
    label: str
    observations: list[GvaObservation]


class GvaResponse(BaseModel):
    indicator: str = "GVA"
    base_year: str = GDP_BASE
    frequency: str = "quarterly"
    measure: str = "Gross value added by industry, constant 2022-23 prices (real)"
    unit: str = "percent, year-on-year (official)"
    source: Source = Source()
    source_url: str = NAS_SOURCE_URL
    industries: list[GvaIndustry]
    limitations: list[str] = [
        *NAS_LIMITATIONS[:4],
        "MoSPI publishes nine industries; it does not publish an agriculture / industry / services split in this API, so none is calculated here.",
    ]


QuarterLimit = Annotated[int, Query(ge=1, le=MAX_QUARTERS, description="newest N quarters")]


def _quarters(periods: dict[date, Any], limit: int) -> list[date]:
    return [p for p in sorted(periods) if p.month in (1, 4, 7, 10) and p.day == 1][-limit:]


@router.get("/gdp", response_model=GdpResponse)
def get_gdp(
    start: StartParam = None,
    end: EndParam = None,
    release_key: ReleaseParam = None,
    limit: QuarterLimit = 40,
) -> GdpResponse:
    """Quarterly real GDP (level and official YoY growth). 404 when nothing is stored: nothing is estimated."""
    _check_dates(start, end)
    codes = [GDP_LEVEL_SERIES, GDP_GROWTH_SERIES]
    periods = _by_period(_fetch(query_series_rows, codes, start, end, release_key, limit * 2))
    obs = []
    for p in _quarters(periods, limit):
        lvl, gr = periods[p].get(GDP_LEVEL_SERIES), periods[p].get(GDP_GROWTH_SERIES)
        fy, q = fiscal_quarter(p)
        obs.append(GdpObservation(
            period=p, fiscal_year=fy, quarter=q,
            level=lvl[0] if lvl else None, level_source=lvl[1] if lvl else None,
            growth_yoy=gr[0] if gr else None, growth_source=gr[1] if gr else None,
        ))  # fmt: skip
    if not obs:
        raise HTTPException(status_code=404, detail="GDP is not stored in this database")
    return GdpResponse(count=len(obs), observations=obs)


@router.get("/gdp/gva", response_model=GvaResponse)
def get_gva(
    start: StartParam = None,
    end: EndParam = None,
    release_key: ReleaseParam = None,
    limit: QuarterLimit = 40,
) -> GvaResponse:
    """Official real GVA growth for each of MoSPI's nine industries (plus total). 404 when nothing is stored."""
    _check_dates(start, end)
    growth = {k: f"{_NAS}.gva.{k}.real.growth_yoy" for k in GVA_INDUSTRIES}
    level = {k: f"{_NAS}.gva.{k}.real.level" for k in GVA_INDUSTRIES}
    codes = [*growth.values(), *level.values()]
    periods = _by_period(_fetch(query_series_rows, codes, start, end, release_key, limit * len(codes)))
    industries = []
    for k, label in GVA_INDUSTRIES.items():
        rows = []
        for p in _quarters(periods, limit):
            g, lv = periods[p].get(growth[k]), periods[p].get(level[k])
            if g is None and lv is None:
                continue
            fy, q = fiscal_quarter(p)
            rows.append(GvaObservation(period=p, fiscal_year=fy, quarter=q, growth_yoy=g[0] if g else None,
                                       level=lv[0] if lv else None, growth_source=g[1] if g else None))  # fmt: skip
        industries.append(GvaIndustry(key=k, label=label, observations=rows))
    if not any(i.observations for i in industries):
        raise HTTPException(status_code=404, detail="GVA is not stored in this database")
    return GvaResponse(industries=industries)
