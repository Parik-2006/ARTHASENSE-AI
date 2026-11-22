# ruff: noqa: E501  (registry text and long literals are kept on readable lines)
"""CPI 2012 legacy series, archive WPI/IIP bases and source status flags. No database (query layer is faked)."""

import os
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app import indicators
from app.config import get_settings
from app.main import app

T1 = datetime(2026, 1, 5, tzinfo=UTC)
LIDX, LINF = indicators.cpi_codes(indicators.CPI_LEGACY)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", "postgresql://u:p@127.0.0.1:1/x")
    monkeypatch.chdir(os.path.dirname(__file__))
    get_settings.cache_clear()
    yield TestClient(app)
    get_settings.cache_clear()


def test_legacy_series_codes_are_distinct_and_never_the_2024_codes():
    assert "cpi.2012." in LIDX and "cpi.2012." in LINF
    for s in indicators.CPI_SERIES:
        assert not set(indicators.cpi_codes(s)) & {LIDX, LINF}


def test_legacy_cpi_response_labels_base_2012_with_limitations_and_source_flag(client, monkeypatch):
    seen = []

    def q(url, start, end, release_key, limit, series="current"):
        seen.append(series)
        return [
            (LIDX, date(2020, 5, 1), Decimal("150.0"), "k", T1, None, "source_status_F*"),
            (LINF, date(2020, 4, 1), Decimal("7.0"), "k", T1, None, "source_final"),
            (LIDX, date(2020, 4, 1), Decimal("149.0"), "k", T1, None, "source_status_F*"),
        ]

    monkeypatch.setattr(indicators, "query_cpi_rows", q)
    body = client.get("/api/v1/indicators/cpi?series=legacy2012").json()
    assert seen == ["legacy2012"]
    assert body["base_year"] == "2012" and body["series"] == "legacy2012"
    assert [o["period"] for o in body["observations"]] == ["2020-04-01", "2020-05-01"]
    may = body["observations"][1]
    assert may["inflation"] is None  # not published for May 2020: stays null, never filled
    assert may["index_source"]["status"] == "source_status_F*"  # source flag preserved verbatim
    assert any("separate series" in x for x in body["limitations"])
    assert any("December 2025" in x for x in body["limitations"])


def test_2024_series_keep_base_2024_and_no_legacy_limitations(client, monkeypatch):
    monkeypatch.setattr(indicators, "query_cpi_rows", lambda *a, **k: [])
    for s in ("current", "back"):
        body = client.get(f"/api/v1/indicators/cpi?series={s}").json()
        assert body["base_year"] == "2024" and body["limitations"] == []


def test_rows_without_a_status_column_still_work(client, monkeypatch):
    monkeypatch.setattr(
        indicators,
        "query_cpi_rows",
        lambda *a, **k: [(indicators.CPI_INDEX_SERIES, date(2025, 1, 1), Decimal("100"), "k", T1, None)],
    )
    body = client.get("/api/v1/indicators/cpi").json()
    assert body["observations"][0]["index_source"]["status"] is None


def test_unknown_cpi_series_is_rejected(client):
    assert client.get("/api/v1/indicators/cpi?series=2010").status_code == 422


@pytest.mark.parametrize("base", ["2004-05", "1993-94"])
def test_archive_bases_are_accepted_for_wpi_and_iip_general_only(client, monkeypatch, base):
    monkeypatch.setattr(
        indicators,
        "query_series_rows",
        lambda *a, **k: [(indicators.wpi_code(base), date(2010, 1, 1), Decimal("135.2"), "k", T1, None)],
    )
    assert client.get(f"/api/v1/indicators/wpi?base_year={base}").json()["base_year"] == base
    assert client.get(f"/api/v1/indicators/iip?base_year={base}&sector=general").status_code == 200
    assert (
        client.get(f"/api/v1/indicators/iip?base_year={base}&sector=mining").status_code == 422
    )  # no such sector on this base
    assert client.get("/api/v1/indicators/wpi?base_year=1999-00").status_code == 422
