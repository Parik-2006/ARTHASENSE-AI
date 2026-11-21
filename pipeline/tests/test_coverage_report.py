from datetime import date

from pipeline.ingest.coverage_report import analyse_series, build_report, five_year_analysis


def months(y0, m0, n):
    out, y, m = [], y0, m0
    for _ in range(n):
        out.append(date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def row(code, ind, base, ms, snaps=1):
    return (code, ind, base, "index", ms, snaps, 0, 0, len(ms), len(ms), 0)


def test_missing_months_are_reported_not_filled():
    ms = [date(2025, 1, 1), date(2025, 2, 1), date(2025, 5, 1)]
    s = analyse_series("x.index", "WPI", "2022-23", "index", ms, {})
    assert s["missing_months"] == ["2025-03", "2025-04"]
    assert (s["months_stored"], s["months_in_span"]) == (3, 5)


def test_two_bases_that_together_span_five_years_are_not_one_series():
    old = row("mospi.wpi.2011-12.india.all_commodities.index", "WPI", "2011-12", months(2021, 11, 54))
    new = row("mospi.wpi.2022-23.india.all_commodities.index", "WPI", "2022-23", months(2023, 4, 43))
    rep = build_report([old, new], linking_factors=0, host="127.0.0.1")
    w = rep["five_year_window"][0]
    assert w["window"] == "2021-11 .. 2026-10"
    assert w["single_series_covers_window"] is False
    assert w["months_with_data_in_any_series"] == 60  # union covers it, but...
    assert w["union_is_one_comparable_index"] is False  # ...it is two series, never one
    assert rep["official_linking_factors_stored"] == 0


def test_one_series_covering_the_window_is_recognised():
    full = row("mospi.wpi.2022-23.india.all_commodities.index", "WPI", "2022-23", months(2021, 11, 60))
    w = build_report([full], 0, "127.0.0.1")["five_year_window"][0]
    assert w["single_series_covers_window"] and w["series_covering_whole_window"]


def test_rate_series_are_listed_but_not_used_for_the_window():
    idx = row("mospi.cpi.2024.current.all_india.combined.general.index", "CPI", "2024", months(2025, 1, 22))
    rate = row(
        "mospi.cpi.2024.current.all_india.combined.general.inflation_yoy", "CPI", "2024", months(2026, 1, 10)
    )
    rep = build_report([idx, rate], 0, "127.0.0.1")
    kinds = {s["code"].split(".")[-1]: s["kind"] for s in rep["series"]}
    assert kinds == {"index": "index", "inflation_yoy": "official_rate"}
    assert len(rep["five_year_window"][0]["per_series"]) == 1


def test_no_headline_series_means_no_data():
    assert five_year_analysis("WPI", [], {})["status"] == "no_data"


def test_published_at_gap_is_stated_not_invented():
    rep = build_report([row("a.wpi.index", "WPI", "2022-23", months(2025, 1, 3))], 0, "h")
    assert rep["metadata_gaps"]["published_at_missing_on_every_observation"] is True
