import json
from datetime import UTC, date, datetime
from decimal import Decimal

import psycopg
import pytest

from pipeline.ingest.cpi_records import CpiRecord
from pipeline.ingest.cpi_store import store_cpi
from pipeline.ingest.wpi import store_wpi
from pipeline.ingest.wpi_records import WpiRecord
from pipeline.research.export import export_all
from pipeline.research.loader import (
    GapError,
    LoaderError,
    MixedBaseError,
    build_series,
    find_missing_periods,
    load_cpi_2024_linked,
    load_series,
    splice,
)
from pipeline.research.quality import build_quality_reports, check_series

T1 = datetime(2026, 1, 1, tzinfo=UTC)
T2 = datetime(2026, 2, 1, tzinfo=UTC)
T3 = datetime(2026, 3, 1, tzinfo=UTC)
META = ("s.code", "CPI", "2024", "index", "India")


def row(y, m, v, key="k1", at=T1):
    return (date(y, m, 1), Decimal(v), key, at)


# ---- loader (pure) ------------------------------------------------------------------------------


def test_missing_month_detection():
    ps = [date(2025, 1, 1), date(2025, 4, 1), date(2025, 2, 1)]
    assert find_missing_periods(ps) == [date(2025, 3, 1)]
    assert find_missing_periods([date(2025, 12, 1), date(2026, 2, 1)]) == [date(2026, 1, 1)]
    assert find_missing_periods([date(2025, 1, 1)]) == []


def test_series_is_chronological_and_complete_series_loads():
    ts = build_series(META, [row(2025, 3, "3"), row(2025, 1, "1"), row(2025, 2, "2")])
    assert ts.periods == [date(2025, m, 1) for m in (1, 2, 3)]
    assert ts.values == [1.0, 2.0, 3.0] and ts.frequency == "M" and ts.missing_periods == ()


def test_gaps_raise_by_default_and_are_never_interpolated():
    rows = [row(2025, 1, "1"), row(2025, 4, "4")]
    with pytest.raises(GapError, match="2 missing"):
        build_series(META, rows)
    ts = build_series(META, rows, require_complete=False)
    assert len(ts) == 2 and ts.missing_periods == (date(2025, 2, 1), date(2025, 3, 1))  # nothing filled


def test_snapshot_policies_and_no_future_leakage():
    rows = [row(2025, 1, "100", "old", T1), row(2025, 1, "101", "new", T3)]
    assert build_series(META, rows, policy="latest").values == [101.0]
    assert build_series(META, rows, policy="first").values == [100.0]
    known_then = build_series(META, rows, as_of=T2)  # the later revision did not exist yet
    assert known_then.values == [100.0] and known_then.points[0].release_key == "old"
    assert (
        build_series(META, rows, as_of=datetime(2025, 1, 1, tzinfo=UTC), require_complete=False).points == ()
    )
    with pytest.raises(LoaderError):
        build_series(META, rows, policy="average")  # type: ignore[arg-type]


def test_time_based_split_has_no_overlap():
    ts = build_series(META, [row(2025, m, str(m)) for m in range(1, 7)])
    train, test = ts.train_test_split(date(2025, 4, 1))
    assert train.periods[-1] == date(2025, 4, 1) and test.periods[0] == date(2025, 5, 1)
    assert not set(train.periods) & set(test.periods)
    with pytest.raises(LoaderError):
        ts.train_test_split(date(2025, 6, 1))  # empty test part
    with pytest.raises(LoaderError):
        ts.train_test_split(date(2024, 1, 1))  # empty train part


def test_mixed_base_years_rejected_and_same_base_splice_is_flagged():
    a = build_series(("a", "CPI", "2012", "index", "India"), [row(2024, 11, "1"), row(2024, 12, "2")])
    b = build_series(("b", "CPI", "2024", "index", "India"), [row(2025, 1, "1")])
    with pytest.raises(MixedBaseError):
        splice(a, b, "x")
    c = build_series(("c", "CPI", "2024", "index", "India"), [row(2024, 11, "1"), row(2024, 12, "2")])
    joined = splice(c, b, "joined")
    assert joined.transformation == "spliced_official_back_series" and joined.components == ("c", "b")
    assert len(joined) == 3
    with pytest.raises(LoaderError, match="overlap"):
        splice(b, c, "bad")  # wrong order / overlap


# ---- quality (pure) -----------------------------------------------------------------------------


def qrow(y, m, v, key="k1", at=T1):
    return (date(y, m, 1), Decimal(v), key, at, None)


def test_quality_report_flags_without_deleting():
    rows = [qrow(2025, 1, "100"), qrow(2025, 2, "101"), qrow(2025, 5, "130")]
    rows += [qrow(2025, 1, "100.5", "k2", T2)]  # a second snapshot with a different value
    r = check_series(indicator="CPI", code="mospi.cpi.2024.x.index", base_year="2024", unit="index",
                     source="MoSPI", rows=rows)  # fmt: skip
    assert (r.start_period, r.end_period, r.observation_count, r.expected_month_count) == (
        "2025-01",
        "2025-05",
        3,
        5,
    )
    assert r.missing_months == ["2025-03", "2025-04"]
    assert r.duplicate_periods == ["2025-01"] and r.snapshot_count == 2
    assert r.publication_timestamp is None and r.retrieval_timestamp == T2.isoformat()
    text = " | ".join(r.quality_warnings)
    assert "missing month" in text and "differ between snapshots" in text
    assert "large month-over-month" not in text  # 101 -> 130 spans a gap: not a consecutive change


def test_quality_flags_consecutive_jumps_nonpositive_and_null_siblings():
    rows = [qrow(2025, 1, "100"), qrow(2025, 2, "150"), qrow(2025, 3, "0")]
    r = check_series(indicator="CPI", code="a.index", base_year="2024", unit="index", source="s", rows=rows)
    text = " | ".join(r.quality_warnings)
    assert "large month-over-month change" in text and "non-positive" in text
    rate = check_series(indicator="CPI", code="a.inflation_yoy", base_year="2024", unit="percent",
                        source="s", rows=[qrow(2025, 1, "3.0"), qrow(2025, 2, "99")],
                        sibling_index_periods={date(2025, m, 1) for m in (1, 2, 3)})  # fmt: skip
    assert rate.null_values == ["2025-03"] and "unusually large rate" in " ".join(rate.quality_warnings)


# ---- database-backed (needs ARTHASENSE_TEST_DATABASE_URL) ---------------------------------------


def seed(url):
    with psycopg.connect(url) as conn:
        cur = [
            CpiRecord(date(2025, m, 1), Decimal(100 + m), Decimal("3.1") if m == 2 else None)
            for m in (1, 2, 3)
        ]
        store_cpi(conn, cur, start_year=2025, end_year=2025, retrieved_at=T1)
        back = [CpiRecord(date(2024, m, 1), Decimal(90 + m), None) for m in (11, 12)]
        store_cpi(conn, back, start_year=2024, end_year=2024, retrieved_at=T1, series_name="Back")
        wpi = [WpiRecord(date(2025, 1, 1), Decimal("100.5")), WpiRecord(date(2025, 3, 1), Decimal("101"))]
        store_wpi(conn, wpi, start_year=2025, end_year=2025, retrieved_at=T2)


@pytest.mark.integration
def test_load_series_from_database_and_linked_cpi(migrated_db_url):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        cur = load_series(conn, "mospi.cpi.2024.current.all_india.combined.general.index")
        assert cur.base_year == "2024" and len(cur) == 3
        with pytest.raises(GapError):
            load_series(conn, "mospi.wpi.2022-23.india.all_commodities.index")
        w = load_series(conn, "mospi.wpi.2022-23.india.all_commodities.index", require_complete=False)
        assert w.missing_periods == (date(2025, 2, 1),)
        linked = load_cpi_2024_linked(conn)
        assert len(linked) == 5 and linked.transformation == "spliced_official_back_series"
        with pytest.raises(LoaderError):
            load_series(conn, "nope")


@pytest.mark.integration
def test_quality_report_from_stored_data(migrated_db_url):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        reports = {r.series_identifier: r for r in build_quality_reports(conn)}
    wpi = reports["mospi.wpi.2022-23.india.all_commodities.index"]
    assert wpi.missing_months == ["2025-02"] and wpi.source.startswith("Ministry")
    infl = reports["mospi.cpi.2024.current.all_india.combined.general.inflation_yoy"]
    assert infl.null_values == ["2025-01", "2025-03"]  # months with an index but no official inflation


@pytest.mark.integration
def test_export_is_deterministic_and_flags_missing_months(migrated_db_url, tmp_path):
    seed(migrated_db_url)
    with psycopg.connect(migrated_db_url) as conn:
        m1 = export_all(conn, tmp_path / "a", include_spliced_cpi=True)
        m2 = export_all(conn, tmp_path / "b", include_spliced_cpi=True)
        default = export_all(conn, tmp_path / "c")
    assert m1 == m2  # same database content -> identical manifest, including every file hash
    names = {f["path"] for f in m1["files"]}
    assert {"quality_report.csv", "quality_report.json"} <= names
    assert "series/cpi.2024.official_linked.index.csv" in names
    # the splice is opt-in: the default export must not contain it
    assert not any("official_linked" in f["path"] for f in default["files"])
    assert default["spliced_cpi_included"] is False and m1["spliced_cpi_included"] is True
    wpi_csv = (
        (tmp_path / "a/series/mospi.wpi.2022-23.india.all_commodities.index.csv")
        .read_text("utf-8")
        .splitlines()
    )
    assert len(wpi_csv) == 4  # header + Jan + Feb(missing) + Mar
    feb = wpi_csv[2].split(",")
    assert "2025-02-01" in feb and "true" in feb and "" in feb  # empty value, never 0
    assert ",0," not in wpi_csv[2]
    linked = (tmp_path / "a/series/cpi.2024.official_linked.index.csv").read_text("utf-8")
    assert "spliced_official_back_series" in linked
    assert json.loads((tmp_path / "a/manifest.json").read_text("utf-8"))["snapshot_policy"] == "latest"
    for f in m1["files"]:
        assert (tmp_path / "a" / f["path"]).read_bytes() == (tmp_path / "b" / f["path"]).read_bytes()


def test_quality_crosscheck_flags_rates_that_are_not_true_yoy():
    # index: Jan 2024 = 100, Jan 2025 = 106 -> real YoY is 6.0%
    idx = {date(2024, 1, 1): Decimal("100"), date(2025, 1, 1): Decimal("106")}

    def report(rate):
        return check_series(
            indicator="IIP", code="a.growth_yoy", base_year="2022-23", unit="percent", source="s",
            rows=[qrow(2025, 1, rate)], sibling_index_values=idx,
        )  # fmt: skip

    assert not any("year-on-year change of its own index" in w for w in report("6.1").quality_warnings)
    bad = report("19.0")  # e.g. a base-relative figure published as growth
    assert any("2025-01 (published 19.00, index implies 6.00)" in w for w in bad.quality_warnings)
    # months without an index twelve months earlier cannot be checked and are not flagged
    none = check_series(indicator="IIP", code="a.growth_yoy", base_year="2022-23", unit="percent",
                        source="s", rows=[qrow(2024, 1, "50")], sibling_index_values=idx)  # fmt: skip
    assert not any("own index" in w for w in none.quality_warnings)
