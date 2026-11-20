"""Data-quality checks for stored series. Suspicious values are FLAGGED for review, never removed."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg

from pipeline.research.loader import find_missing_periods, month_index

# |month-over-month % change| above this is flagged for human review (index series only).
MOM_REVIEW_PCT = {"CPI": 5.0, "WPI": 5.0, "IIP": 25.0}  # IIP is strongly seasonal
# A published year-on-year rate must match the change computed from its own index series to within
# this many percentage points (index values are rounded, so exact equality is not expected).
YOY_CROSSCHECK_PP = 0.2
# |value| above this is flagged for year-on-year rate series (inflation / growth, in %).
YOY_REVIEW_ABS = {"CPI": 15.0, "WPI": 25.0, "IIP": 40.0}


@dataclass
class QualityReport:
    indicator: str
    series_identifier: str
    base_year: str
    unit: str
    start_period: str | None
    end_period: str | None
    observation_count: int
    expected_month_count: int
    missing_months: list[str]
    duplicate_periods: list[str]  # months stored in more than one snapshot
    null_values: list[str]  # months where the sibling index exists but this series has no value
    source: str
    retrieval_timestamp: str | None
    publication_timestamp: str | None
    snapshot_count: int
    quality_warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# period, value, release_key, retrieved_at, published_at
Row = tuple[date, Decimal, str, datetime, datetime | None]


def _ym(d: date) -> str:
    return d.strftime("%Y-%m")


def kind_of(code: str) -> str:
    return "index" if code.endswith(".index") else "rate"


def _listing(items: list[str], limit: int = 12) -> str:
    more = f" (+{len(items) - limit} more)" if len(items) > limit else ""
    return ", ".join(items[:limit]) + more


def check_series(
    *,
    indicator: str,
    code: str,
    base_year: str,
    unit: str,
    source: str,
    rows: list[Row],
    sibling_index_periods: set[date] | None = None,
    sibling_index_values: dict[date, Decimal] | None = None,
) -> QualityReport:
    warnings: list[str] = []
    by_period: dict[date, list[Row]] = {}
    for r in rows:
        by_period.setdefault(r[0], []).append(r)
    periods = sorted(by_period)
    latest = {p: max(rs, key=lambda r: (r[3], r[2])) for p, rs in by_period.items()}
    missing = find_missing_periods(periods)
    expected = month_index(periods[-1]) - month_index(periods[0]) + 1 if periods else 0

    dup = [p for p, rs in by_period.items() if len({r[2] for r in rs}) > 1]
    revised = [p for p, rs in by_period.items() if len({r[1] for r in rs}) > 1]
    nulls = sorted(sibling_index_periods - set(periods)) if sibling_index_periods is not None else []

    if missing:
        warnings.append(f"{len(missing)} missing month(s): " + _listing([_ym(m) for m in missing]))
    if revised:
        warnings.append(
            f"values differ between snapshots for {len(revised)} month(s): "
            + _listing([_ym(p) for p in sorted(revised)])
            + " (a revision, or a re-fetch that changed)"
        )
    if any(p.day != 1 for p in periods):
        warnings.append("some periods are not the first day of a month")
    if base_year and base_year not in code:
        warnings.append(f"base year {base_year!r} is not part of the series code")
    if kind_of(code) == "index":
        bad = [_ym(p) for p in periods if latest[p][1] <= 0]
        if bad:
            warnings.append(f"non-positive index value(s): {_listing(bad)}")
        limit = MOM_REVIEW_PCT.get(indicator)
        jumps = []
        for a, b in zip(periods, periods[1:], strict=False):
            if month_index(b) - month_index(a) == 1 and latest[a][1] > 0 and limit is not None:
                change = (float(latest[b][1]) / float(latest[a][1]) - 1) * 100
                if abs(change) > limit:
                    jumps.append(f"{_ym(b)} ({change:+.1f}%)")
        if jumps:
            warnings.append(f"large month-over-month change to review: {_listing(jumps)}")
    else:
        limit = YOY_REVIEW_ABS.get(indicator)
        odd = [_ym(p) for p in periods if limit is not None and abs(float(latest[p][1])) > limit]
        if odd:
            warnings.append(f"unusually large rate value(s) to review: {_listing(odd)}")
    if kind_of(code) == "rate" and sibling_index_values:
        bad_yoy = []
        for p in periods:
            prev = date(p.year - 1, p.month, 1)
            now_idx, prev_idx = sibling_index_values.get(p), sibling_index_values.get(prev)
            if now_idx is None or prev_idx is None or prev_idx <= 0:
                continue
            computed = (float(now_idx) / float(prev_idx) - 1) * 100
            diff = abs(float(latest[p][1]) - computed)
            if diff > YOY_CROSSCHECK_PP:
                bad_yoy.append(
                    f"{_ym(p)} (published {float(latest[p][1]):.2f}, index implies {computed:.2f})"
                )
        if bad_yoy:
            warnings.append(
                f"published rate does not match the year-on-year change of its own index for {len(bad_yoy)} "
                f"month(s): {_listing(bad_yoy)}; it may not be a true year-on-year figure"
            )
    if nulls:
        warnings.append(
            f"no value for {len(nulls)} month(s) that have an index: " + _listing([_ym(p) for p in nulls])
        )

    retrieved = max((r[3] for r in rows), default=None)
    published = max((r[4] for r in rows if r[4] is not None), default=None)
    return QualityReport(
        indicator=indicator,
        series_identifier=code,
        base_year=base_year,
        unit=unit,
        start_period=_ym(periods[0]) if periods else None,
        end_period=_ym(periods[-1]) if periods else None,
        observation_count=len(periods),
        expected_month_count=expected,
        missing_months=[_ym(m) for m in missing],
        duplicate_periods=[_ym(p) for p in sorted(dup)],
        null_values=[_ym(p) for p in nulls],
        source=source,
        retrieval_timestamp=retrieved.isoformat() if retrieved else None,
        publication_timestamp=published.isoformat() if published else None,
        snapshot_count=len({r[2] for r in rows}),
        quality_warnings=warnings,
    )


def build_quality_reports(conn: psycopg.Connection) -> list[QualityReport]:
    """One report per stored series, computed from the observations actually in the database."""
    series = conn.execute(
        """SELECT s.id, s.code, s.indicator, s.base_year, s.unit, src.name
             FROM series s JOIN sources src ON src.id = s.source_id
            WHERE EXISTS (SELECT 1 FROM observations o WHERE o.series_id = s.id)
            ORDER BY s.indicator, s.code"""
    ).fetchall()
    rows_by_code: dict[str, list[Row]] = {}
    for sid, code, *_ in series:
        rows_by_code[code] = conn.execute(
            """SELECT o.period_date, o.value, r.release_key, r.retrieved_at, r.published_at
                 FROM observations o JOIN releases r ON r.id = o.release_id
                WHERE o.series_id = %s ORDER BY o.period_date, r.retrieved_at, r.id""",
            (sid,),
        ).fetchall()
    reports = []
    for _, code, indicator, base_year, unit, source in series:
        sibling = None
        sibling_values = None
        if kind_of(code) == "rate":
            idx_code = code.rsplit(".", 1)[0] + ".index"
            if idx_code in rows_by_code:
                sibling = {r[0] for r in rows_by_code[idx_code]}
                newest: dict[date, Row] = {}
                for r in rows_by_code[idx_code]:
                    if r[0] not in newest or (r[3], r[2]) > (newest[r[0]][3], newest[r[0]][2]):
                        newest[r[0]] = r
                sibling_values = {p: r[1] for p, r in newest.items()}
        reports.append(
            check_series(
                indicator=indicator,
                code=code,
                base_year=base_year or "",
                unit=unit,
                source=source,
                rows=rows_by_code[code],
                sibling_index_periods=sibling,
                sibling_index_values=sibling_values,
            )
        )
    return reports
