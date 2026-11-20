"""Deterministic CSV/JSON exports of the stored series for offline research.

For a fixed database content the output files are byte-for-byte identical (no wall-clock time is
written). Snapshot policy is fixed to "latest" and every row says which release it came from.
Months without a stored value inside a series' span appear as rows with an empty value and
is_missing=true: they are reported, never filled.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
from typing import Any

import psycopg

from pipeline.research.loader import (
    CPI_BACK_INDEX,
    CPI_CURRENT_INDEX,
    LoaderError,
    TimeSeries,
    find_missing_periods,
    load_cpi_2024_linked,
    load_series,
)
from pipeline.research.quality import QualityReport, build_quality_reports

EXPORT_VERSION = 1
SERIES_COLUMNS = [
    "indicator", "series_code", "series_name", "base_year", "geography", "unit", "source",
    "period", "value", "is_missing", "release_key", "retrieved_at", "published_at",
    "transformation", "snapshot_policy",
]  # fmt: skip
QUALITY_COLUMNS = [
    "indicator", "series_identifier", "base_year", "unit", "start_period", "end_period",
    "observation_count", "expected_month_count", "missing_months", "duplicate_periods",
    "null_values", "source", "retrieval_timestamp", "publication_timestamp", "snapshot_count",
    "quality_warnings",
]  # fmt: skip


def _write_csv(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def series_rows(ts: TimeSeries, *, name: str, source: str) -> list[dict[str, Any]]:
    """One row per month from first to last period, including explicit missing-month rows."""
    by_period = {p.period: p for p in ts.points}
    all_periods = sorted(set(by_period) | set(find_missing_periods(list(by_period))))
    out = []
    for period in all_periods:
        pt = by_period.get(period)
        out.append(
            {
                "indicator": ts.indicator,
                "series_code": ts.series_code,
                "series_name": name,
                "base_year": ts.base_year,
                "geography": ts.geography,
                "unit": ts.unit,
                "source": source,
                "period": period.isoformat(),
                "value": "" if pt is None else str(pt.value),
                "is_missing": "true" if pt is None else "false",
                "release_key": "" if pt is None else pt.release_key,
                "retrieved_at": "" if pt is None else pt.retrieved_at.isoformat(),
                "published_at": "",  # never known: the MoSPI API gives no publication date
                "transformation": ts.transformation,
                "snapshot_policy": ts.snapshot_policy,
            }
        )
    return out


def export_all(
    conn: psycopg.Connection, out_dir: Path, *, include_spliced_cpi: bool = False
) -> dict[str, Any]:
    out_dir = Path(out_dir)
    metas = conn.execute(
        """SELECT s.code, s.name, src.name FROM series s JOIN sources src ON src.id = s.source_id
            WHERE EXISTS (SELECT 1 FROM observations o WHERE o.series_id = s.id)
            ORDER BY s.code"""
    ).fetchall()
    files: list[dict[str, Any]] = []
    series_info: dict[str, tuple[str, str]] = {}

    def add_file(path: Path, kind: str, rows: int, **extra: Any) -> None:
        files.append({"path": path.relative_to(out_dir).as_posix(), "kind": kind, "rows": rows,
                      "sha256": _sha256(path), **extra})  # fmt: skip

    for code, name, source in metas:
        series_info[code] = (name, source)
        ts = load_series(conn, code, require_complete=False)
        rows = series_rows(ts, name=name, source=source)
        path = out_dir / "series" / f"{code}.csv"
        _write_csv(path, SERIES_COLUMNS, rows)
        add_file(path, "series", len(rows), series_code=code, base_year=ts.base_year,
                 transformation="none", missing_months=len(ts.missing_periods))  # fmt: skip

    if include_spliced_cpi and CPI_BACK_INDEX in series_info and CPI_CURRENT_INDEX in series_info:
        try:
            linked = load_cpi_2024_linked(conn, require_complete=False)
        except LoaderError:
            linked = None
        if linked is not None:
            name = "CPI (2024 base) index: official Back series + Current series, spliced"
            rows = series_rows(linked, name=name, source=series_info[CPI_CURRENT_INDEX][1])
            path = out_dir / "series" / f"{linked.series_code}.csv"
            _write_csv(path, SERIES_COLUMNS, rows)
            add_file(
                path,
                "series",
                len(rows),
                series_code=linked.series_code,
                base_year=linked.base_year,
                transformation=linked.transformation,
                components=list(linked.components),
                missing_months=len(linked.missing_periods),
            )

    reports: list[QualityReport] = build_quality_reports(conn)
    qrows = [
        {
            **r.to_dict(),
            "missing_months": ";".join(r.missing_months),
            "duplicate_periods": ";".join(r.duplicate_periods),
            "null_values": ";".join(r.null_values),
            "quality_warnings": " | ".join(r.quality_warnings),
        }
        for r in reports
    ]
    qcsv = out_dir / "quality_report.csv"
    _write_csv(qcsv, QUALITY_COLUMNS, qrows)
    add_file(qcsv, "quality", len(qrows))
    qjson = out_dir / "quality_report.json"
    qjson.write_text(
        json.dumps([r.to_dict() for r in reports], indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    add_file(qjson, "quality", len(reports))

    n_rel, n_obs, last = conn.execute(
        "SELECT (SELECT count(*) FROM releases), (SELECT count(*) FROM observations), "
        "(SELECT max(retrieved_at) FROM releases)"
    ).fetchone()
    manifest = {
        "export_version": EXPORT_VERSION,
        "snapshot_policy": "latest",
        "spliced_cpi_included": include_spliced_cpi,
        "database_state": {
            "releases": n_rel,
            "observations": n_obs,
            "latest_retrieval": last.isoformat() if last else None,
        },
        "notes": [
            "Values are official MoSPI figures as retrieved; published_at is unknown and left empty.",
            "Different base years / series are never merged.",
            "The CPI Back+Current splice is written only on request (--include-spliced-cpi) and is flagged.",
            "Rows with is_missing=true mark months without a stored value; nothing is interpolated.",
        ],
        "files": sorted(files, key=lambda f: f["path"]),
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return manifest
