"""Forecasting-ready loader for ONE stored monthly series.

Guarantees (each covered by tests):
  * Chronological, strictly monthly, one value per month, from one clearly named snapshot policy.
  * Missing months are detected and reported. Nothing is interpolated or filled. By default a gap
    raises GapError; pass require_complete=False to get the series with its gaps listed.
  * One series = one base year. Series on different base years are never combined; the only
    composite offered (CPI official back series + current series) is checked to share the 2024 base
    and is explicitly flagged as spliced.
  * No future leakage: `as_of` hides snapshots retrieved after that moment (what was known then),
    and `train_test_split` is strictly by time, never random.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

import psycopg

SnapshotPolicy = Literal["latest", "first"]


class LoaderError(ValueError): ...


class GapError(LoaderError):
    """The series has missing months and the caller asked for a complete series."""


class MixedBaseError(LoaderError):
    """Attempt to combine series measured on different base years."""


@dataclass(frozen=True)
class Point:
    period: date
    value: Decimal
    release_key: str
    retrieved_at: datetime


@dataclass(frozen=True)
class TimeSeries:
    series_code: str
    indicator: str
    base_year: str
    unit: str
    geography: str
    points: tuple[Point, ...]
    missing_periods: tuple[date, ...]
    snapshot_policy: str
    as_of: datetime | None
    transformation: str = "none"
    components: tuple[str, ...] = field(default_factory=tuple)
    # First period of the second component of a splice (the join); None for a single series.
    join_period: date | None = None
    freq: str = "M"  # "M" monthly | "Q" quarterly (dated by the first month of each calendar quarter)
    # Provenance of a transformation applied by ArthaSense (linking factor, source, join); None otherwise.
    link: dict | None = None

    @property
    def frequency(self) -> str:
        return self.freq

    @property
    def periods(self) -> list[date]:
        return [p.period for p in self.points]

    @property
    def values(self) -> list[float]:
        return [float(p.value) for p in self.points]

    def __len__(self) -> int:
        return len(self.points)

    def train_test_split(self, train_end: date) -> tuple[TimeSeries, TimeSeries]:
        """Points up to and including `train_end` -> train; strictly later points -> test."""
        train = tuple(p for p in self.points if p.period <= train_end)
        test = tuple(p for p in self.points if p.period > train_end)
        if not train or not test:
            raise LoaderError("both the train and the test part must contain observations")
        miss_train = tuple(m for m in self.missing_periods if m <= train_end)
        miss_test = tuple(m for m in self.missing_periods if m > train_end)
        return _replace(self, train, miss_train), _replace(self, test, miss_test)


def _replace(ts: TimeSeries, points: tuple[Point, ...], missing: tuple[date, ...]) -> TimeSeries:
    return TimeSeries(
        ts.series_code, ts.indicator, ts.base_year, ts.unit, ts.geography, points, missing,
        ts.snapshot_policy, ts.as_of, ts.transformation, ts.components, ts.join_period, ts.freq, ts.link,
    )  # fmt: skip


def month_index(d: date) -> int:
    return d.year * 12 + d.month - 1


FREQ_STEP = {"monthly": 1, "quarterly": 3}
FREQ_CODE = {"monthly": "M", "quarterly": "Q"}


def find_missing_periods(periods: list[date], step: int = 1) -> list[date]:
    """Periods absent between the first and last period (input need not be sorted). `step` = 1 for monthly
    data, 3 for quarterly data (a quarter is dated by its first month)."""
    if len(periods) < 2:
        return []
    have = {month_index(p) for p in periods}
    lo, hi = min(have), max(have)
    return [date(n // 12, n % 12 + 1, 1) for n in range(lo + step, hi, step) if n not in have]


def build_series(
    meta: tuple[str, str, str, str, str],
    rows: list[tuple[date, Decimal, str, datetime]],
    *,
    policy: SnapshotPolicy = "latest",
    as_of: datetime | None = None,
    require_complete: bool = True,
) -> TimeSeries:
    """Pure core of the loader: pick one value per period by policy, then validate.

    `meta` = (code, indicator, base_year, unit, geography[, frequency]); frequency defaults to monthly."""
    code, indicator, base_year, unit, geography = meta[:5]
    frequency = meta[5] if len(meta) > 5 else "monthly"
    if frequency not in FREQ_STEP:
        raise LoaderError(f"{code}: frequency {frequency!r} is not supported for forecasting")
    step = FREQ_STEP[frequency]
    if policy not in ("latest", "first"):
        raise LoaderError(f"unknown snapshot policy {policy!r}")
    visible = [r for r in rows if as_of is None or r[3] <= as_of]
    chosen: dict[date, tuple[date, Decimal, str, datetime]] = {}
    for r in sorted(visible, key=lambda r: (r[0], r[3], r[2])):
        if r[0].day != 1:
            raise LoaderError(f"{code}: period {r[0]} is not the first of a month")
        if policy == "latest" or r[0] not in chosen:
            chosen[r[0]] = r  # ascending by retrieval time: for "latest" the last one wins
    points = tuple(Point(*chosen[p]) for p in sorted(chosen))
    if step == 3 and any((p.period.month - 1) % 3 for p in points):
        raise LoaderError(
            f"{code}: a quarterly period must be dated by the first month of a calendar quarter"
        )
    missing = tuple(find_missing_periods([p.period for p in points], step))
    if missing and require_complete:
        shown = ", ".join(m.strftime("%Y-%m") for m in missing[:12])
        raise GapError(f"{code}: {len(missing)} missing {'month' if step == 1 else 'quarter'}(s): {shown}")
    return TimeSeries(code, indicator, base_year, unit, geography, points, missing, policy, as_of,
                      freq=FREQ_CODE[frequency])  # fmt: skip


def load_series(
    conn: psycopg.Connection,
    series_code: str,
    *,
    policy: SnapshotPolicy = "latest",
    as_of: datetime | None = None,
    start: date | None = None,
    end: date | None = None,
    require_complete: bool = True,
) -> TimeSeries:
    meta = conn.execute(
        "SELECT code, indicator, base_year, unit, geography, frequency FROM series WHERE code = %s",
        (series_code,),
    ).fetchone()
    if meta is None:
        raise LoaderError(f"unknown series {series_code!r}")
    rows = conn.execute(
        """SELECT o.period_date, o.value, r.release_key, r.retrieved_at
             FROM observations o
             JOIN series s ON s.id = o.series_id
             JOIN releases r ON r.id = o.release_id
            WHERE s.code = %s
              AND (%s::date IS NULL OR o.period_date >= %s::date)
              AND (%s::date IS NULL OR o.period_date <= %s::date)
            ORDER BY o.period_date, r.retrieved_at, r.id""",
        (series_code, start, start, end, end),
    ).fetchall()
    if not rows:
        raise LoaderError(f"{series_code}: no observations stored")
    return build_series(tuple(meta), rows, policy=policy, as_of=as_of, require_complete=require_complete)


# ---- the one supported composite ---------------------------------------------------------------

CPI_BACK_INDEX = "mospi.cpi.2024.back.all_india.combined.general.index"
CPI_CURRENT_INDEX = "mospi.cpi.2024.current.all_india.combined.general.index"


def splice(first: TimeSeries, second: TimeSeries, code: str) -> TimeSeries:
    """Join two series that share a base year and do not overlap in time. Flags the result."""
    if first.base_year != second.base_year:
        raise MixedBaseError(
            f"cannot combine base years {first.base_year!r} and {second.base_year!r}; "
            "no documented linking method is configured"
        )
    if first.unit != second.unit or first.geography != second.geography:
        raise MixedBaseError("series differ in unit or geography")
    if first.points and second.points and first.points[-1].period >= second.points[0].period:
        raise LoaderError("series overlap in time; refusing to guess which one wins")
    points = first.points + second.points
    missing = tuple(find_missing_periods([p.period for p in points]))
    return TimeSeries(
        code, first.indicator, first.base_year, first.unit, first.geography, points, missing,
        first.snapshot_policy, first.as_of, "spliced_official_back_series",
        (first.series_code, second.series_code), second.points[0].period if second.points else None, first.freq,
    )  # fmt: skip


def load_cpi_2024_linked(
    conn: psycopg.Connection, *, as_of: datetime | None = None, require_complete: bool = True
) -> TimeSeries:
    """CPI index on the 2024 base: MoSPI's official Back series (2013-2024) + Current (2025-).

    Both are published by MoSPI on the same 2024=100 base, so this is not an invented linking
    factor; the result is still flagged as spliced because the two parts are different series.
    """
    back = load_series(conn, CPI_BACK_INDEX, as_of=as_of, require_complete=require_complete)
    current = load_series(conn, CPI_CURRENT_INDEX, as_of=as_of, require_complete=require_complete)
    return splice(back, current, "cpi.2024.official_linked.index")


# ---- WPI and IIP: official linking factors (back-cast of the 2011-12 series onto the 2022-23 base) ----------

# Both publishers give a geometric-mean linking factor and the same direction: linked = old index / factor.
# Factors are applied to the HEADLINE index only, and only to months before the first new-base month.
BACKCAST_LINKS: dict[str, dict[str, str]] = {
    "wpi": {
        "old": "mospi.wpi.2011-12.india.all_commodities.index",
        "current": "mospi.wpi.2022-23.india.all_commodities.index",
        "code": "wpi.2022-23.oea_linked.index",
        "factor": "1.53",
        "scope": "WPI All Commodities",
        "formula": "back-cast 2022-23-base index(t) = WPI 2011-12 index(t) / 1.53",
        "method": "ratio of geometric means of the twelve monthly indices of the old and new series, FY 2024-25",
        "reference_period": "FY 2024-25 (Apr 2024 - Mar 2025)",
        "publisher": "Office of the Economic Adviser, DPIIT",
        "source": (
            "OEA, Linking Factor For WPI Series (Base Year: 2022-23), https://eaindustry.nic.in/linking_factor2223.asp "
            "(All Commodities 1.53; read 2026-11-24) and OEA, FAQs on the New Series of WPI (Base year 2022-23), Q20: "
            "'Back-casted new series in old periods = Old series index / 1.53'"
        ),
        "caution": (
            "OEA advises due caution when comparing indices across the two series and does not prescribe a linking "
            "method. Back-cast values follow the old series' price movements (OEA FAQ Q20)."
        ),
        "evidence": "L",
    },
    "iip": {
        "old": "mospi.iip.2011-12.india.general.index",
        "current": "mospi.iip.2022-23.india.general.index",
        "code": "iip.2022-23.nso_linked.index",
        "factor": "1.3834",
        "scope": "IIP General index",
        "formula": "back-cast 2022-23-base index(t) = IIP 2011-12 General index(t) / 1.3834",
        "method": "geometric mean of the old series during the new base year / geometric mean of the new series (FY 2022-23)",
        "reference_period": "FY 2022-23 (Apr 2022 - Mar 2023)",
        "publisher": "National Statistics Office, MoSPI",
        "source": (
            "NSO/MoSPI, Linking Factor for IIP (technical document of the IIP 2022-23 metadata, "
            "https://microdata.gov.in/nada/index.php/catalog/299/download/6676; read 2026-11-24): General 1.3834; "
            "'The linked series is obtained by dividing the indices of old series with the coefficient'"
        ),
        "caution": (
            "The 2022-23 General index adds water supply, sewerage & waste management, which the 2011-12 series did "
            "not cover, so there is no exact correspondence; MoSPI asks users to exercise caution and does not "
            "prescribe a linking method."
        ),
        "evidence": "L",
    },
}


def load_backcast_linked(
    conn: psycopg.Connection, indicator: str, *, as_of: datetime | None = None, require_complete: bool = True
) -> TimeSeries:
    """Headline index on the 2022-23 base: the 2011-12 series back-cast with the publisher's linking factor
    (old / factor) for every month BEFORE the first 2022-23 month, then the official 2022-23 series unchanged.

    Old-base values from the join onward are never used, although the 2011-12 series overlaps it. Stored official
    observations are not modified: back-cast values exist only in memory and the result carries its transformation,
    factor and source. Back-cast points keep their original 2011-12 release key, so every value stays traceable.
    """
    spec = BACKCAST_LINKS[indicator]
    old = load_series(conn, spec["old"], as_of=as_of, require_complete=require_complete)
    current = load_series(conn, spec["current"], as_of=as_of, require_complete=require_complete)
    if old.base_year != "2011-12" or current.base_year != "2022-23":
        raise MixedBaseError(f"the {indicator.upper()} linking factor applies only to 2011-12 -> 2022-23")
    join = current.points[0].period
    factor = Decimal(spec["factor"])
    back = tuple(
        Point(p.period, p.value / factor, p.release_key, p.retrieved_at)
        for p in old.points
        if p.period < join
    )
    if not back:
        raise LoaderError(f"{spec['old']}: no observations before the join {join:%Y-%m}")
    points = back + current.points
    missing = tuple(find_missing_periods([p.period for p in points]))
    if missing and require_complete:
        shown = ", ".join(m.strftime("%Y-%m") for m in missing[:12])
        raise GapError(f"{indicator} linked: {len(missing)} missing month(s): {shown}")
    link = {**{k: v for k, v in spec.items() if k not in ("old", "current", "code")},
            "join_period": join.isoformat(), "last_backcast_period": back[-1].period.isoformat(),
            "n_backcast": len(back), "n_old_months_from_join_unused": sum(1 for p in old.points if p.period >= join)}  # fmt: skip
    return TimeSeries(
        spec["code"], current.indicator, current.base_year, current.unit, current.geography,
        points, missing, current.snapshot_policy, as_of, "official_linking_factor_backcast",
        (spec["old"], spec["current"]), join, "M", link,
    )  # fmt: skip


def load_wpi_2022_23_linked(conn: psycopg.Connection, **kw) -> TimeSeries:
    return load_backcast_linked(conn, "wpi", **kw)


def load_iip_2022_23_linked(conn: psycopg.Connection, **kw) -> TimeSeries:
    return load_backcast_linked(conn, "iip", **kw)
