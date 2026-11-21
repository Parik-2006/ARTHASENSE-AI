"""CPI 2012 legacy adapter: validation, status flags, no splicing with the 2024-base series. Offline."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from mospi_mock import MONTHS, client, no_sleep, paged

from pipeline.ingest import cpi_legacy as L
from pipeline.ingest.common import ValidationError
from pipeline.ingest.history import INGESTERS
from pipeline.ingest.preview import capture_store


def row(year, m, index="100.0", inflation="3.0", status="F", **over):
    r = {"baseyear": "2012", "year": year, "month": MONTHS[m - 1], "state": "All India", "sector": "Combined",
         "group": "General", "subgroup": "General-Overall", "index": index, "inflation": inflation, "status": status}  # fmt: skip
    return {**r, **over}


def test_valid_records_keep_gaps_as_none_and_status_flag():
    recs = L.validate_records([row(2013, 2, "101.5", None), row(2013, 1, "100.0", None, status="P")], 2013, 2013)
    assert [r.period for r in recs] == [date(2013, 1, 1), date(2013, 2, 1)]
    assert recs[0].inflation is None and recs[0].status == "P"  # missing stays None, never 0
    assert recs[1].index == Decimal("101.5")


@pytest.mark.parametrize(
    "over",
    [{"baseyear": "2024"}, {"state": "Kerala"}, {"sector": "Rural"}, {"group": "Food"}, {"status": ""}, {"status": None},
     {"year": 2030}, {"month": "Janu"}, {"index": "n/a"}, {"index": "NaN"}],
)  # fmt: skip
def test_invalid_records_rejected(over):
    bad = {**row(2013, 1), **over}
    with pytest.raises(ValidationError):
        L.validate_records([bad], 2013, 2013)


def test_duplicate_period_rejected():
    with pytest.raises(ValidationError, match="duplicate"):
        L.validate_records([row(2013, 1), row(2013, 1)], 2013, 2013)


def test_status_mapping_keeps_unknown_flags_visible():
    assert L.status_of("F") == "source_final"
    assert L.status_of("p") == "source_provisional"
    assert L.status_of("X") == "source_status_X"  # never silently treated as final
    assert L.status_of(None) == "retrieved"


def test_series_are_distinct_from_the_2024_base_series():
    assert "2012" in L.INDEX_CODE and "2012" in L.INFLATION_CODE
    assert L.INDEX_CODE != "mospi.cpi.2024.back.all_india.combined.general.index"
    assert L.specs()[L.INDEX_CODE].base_year == "2012"


def test_fetch_follows_pagination_beyond_the_default_page():
    rows = [row(2021, m) for m in range(1, 13)]
    c = client(lambda req: paged(rows, req.url.params))
    res = L.fetch_year(c, 2021, 0)
    assert len(res.records) == 12


class Args:
    pass


def test_store_would_write_both_series_with_source_status():
    recs = L.validate_records([row(2021, 1, "165.0", "5.0", "F"), row(2021, 2, "166.0", None, "P")], 2021, 2021)
    cap = capture_store(INGESTERS["cpi2012"], recs, 2021, datetime(2026, 1, 1, tzinfo=UTC), Args())
    got = {(c, p.month): (v, s) for c, p, v, s in cap.observations}
    assert got[(L.INDEX_CODE, 1)] == (Decimal("165.0"), "source_final")
    assert got[(L.INDEX_CODE, 2)] == (Decimal("166.0"), "source_provisional")
    assert got[(L.INFLATION_CODE, 2)][0] is None  # no inflation value is invented
    assert cap.release_key.startswith("mospi-cpi2012-current-2021-2021-")


def test_registered_for_history_and_not_before_2013():
    ing = INGESTERS["cpi2012"]
    assert ing.first_year(Args()) == 2013
