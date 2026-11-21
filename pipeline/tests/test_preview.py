from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from mospi_mock import wpi_row

from pipeline.ingest import preview, wpi
from pipeline.ingest.history import INGESTERS
from pipeline.ingest.preview import diff_series
from pipeline.ingest.wpi_records import validate_records

NOW = datetime(2026, 1, 5, tzinfo=UTC)
D = Decimal


def test_diff_classifies_new_unchanged_revised_and_missing_months():
    fetched = [(date(2025, 1, 1), D("100")), (date(2025, 2, 1), D("101")), (date(2025, 4, 1), D("103"))]
    stored = {date(2025, 1, 1): D("100"), date(2025, 2, 1): D("100.5")}
    p = diff_series("mospi.wpi.2022-23.india.all_commodities.index", "2022-23", fetched, stored)
    assert p.unchanged == 1
    assert p.revised == [(date(2025, 2, 1), D("100.5"), D("101"))]
    assert p.new == [date(2025, 4, 1)]
    assert p.missing_months == [date(2025, 3, 1)]
    assert p.problems == []


def test_diff_flags_duplicates_missing_values_and_base_year_mismatch():
    fetched = [(date(2025, 1, 1), D("1")), (date(2025, 1, 1), D("1")), (date(2025, 2, 1), None)]
    p = diff_series("mospi.wpi.2011-12.india.all_commodities.index", "2022-23", fetched, {})
    assert p.duplicates == [date(2025, 1, 1)]
    assert p.fetched == 1  # a missing value is never counted or turned into 0
    assert any("base year" in x for x in p.problems)


def test_capture_never_touches_a_connection_and_returns_what_would_be_written():
    class Args:
        base_year = "2022-23"

    recs = validate_records([wpi_row(2025, 1, "100.0"), wpi_row(2025, 2, "101.5")], 2025, 2025)
    cap = preview.capture_store(INGESTERS["wpi"], recs, 2025, NOW, Args())
    assert [(c, p, v) for c, p, v in cap.observations] == [
        (wpi.series_code("2022-23"), date(2025, 1, 1), D("100.0")),
        (wpi.series_code("2022-23"), date(2025, 2, 1), D("101.5")),
    ]
    assert cap.sha256 and "wpi" in cap.source_url


def test_preview_refuses_non_local_database_hosts(monkeypatch, capsys):
    monkeypatch.setattr(preview, "database_url", lambda: "postgresql://u:secret@db.example.supabase.co:5432/postgres")
    code = preview.run(["wpi", "--start-year", "2025", "--end-year", "2025"])
    out = capsys.readouterr()
    assert code == 2
    assert "db.example.supabase.co" in out.out  # host only
    assert "secret" not in out.out + out.err  # credentials never printed


def test_preview_requires_a_database(monkeypatch, capsys):
    monkeypatch.setattr(preview, "database_url", lambda: None)
    assert preview.run(["wpi", "--start-year", "2025", "--end-year", "2025"]) == 2
