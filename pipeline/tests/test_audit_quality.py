"""Audit logic on synthetic series (test fixtures only)."""

import pytest

from pipeline.audit.quality import compare_yoy, large_moves, missing_months, overlap_ratio, yoy_from_index


def series(start_year, n, f=lambda i: 100.0 + i):
    out = {}
    for i in range(n):
        k = start_year * 12 + i
        out[(k // 12, k % 12 + 1)] = f(i)
    return out


def test_missing_months_found_inside_the_span_only():
    s = series(2020, 6)
    del s[(2020, 3)]
    del s[(2020, 4)]
    assert missing_months(s) == [(2020, 3), (2020, 4)]
    assert missing_months({}) == []


def test_yoy_needs_the_same_month_a_year_earlier():
    s = series(2020, 14)
    y = yoy_from_index(s)
    assert (2020, 12) not in y and (2021, 1) in y
    assert y[(2021, 1)] == pytest.approx((112 / 100 - 1) * 100)
    del s[(2020, 2)]
    assert (2021, 2) not in yoy_from_index(s)  # reference month missing -> no value, never interpolated


def test_compare_yoy_flags_differences_beyond_rounding():
    idx = series(2020, 24)
    official = {m: v for m, v in yoy_from_index(idx).items()}
    exact = compare_yoy(idx, official, 0.15)
    assert exact.compared == 12 and exact.max_abs_diff == pytest.approx(0)
    wrong = dict(official)
    wrong[(2021, 6)] += 1.0
    off = compare_yoy(idx, wrong, 0.15)
    assert [m for m, _, _ in off.over_tolerance] == [(2021, 6)]
    assert compare_yoy(idx, {}, 0.15).compared == 0


def test_overlap_ratio_distinguishes_a_constant_factor_from_a_drifting_one():
    a = series(2020, 12, lambda i: 200.0 + 2 * i)
    constant = {m: v / 2 for m, v in a.items()}
    assert overlap_ratio(a, constant).constant_factor_like is True
    drifting = {m: v / (2 + 0.05 * i) for i, (m, v) in enumerate(sorted(a.items()))}
    o = overlap_ratio(a, drifting)
    assert o.constant_factor_like is False and o.ratio_spread_pct > 1
    assert overlap_ratio(series(2020, 3), series(2030, 3)).months == 0


def test_large_moves_use_consecutive_months_only():
    s = series(2020, 4, lambda i: [100, 100, 110, 110][i])
    assert large_moves(s, 5.0) == [((2020, 3), 10.0)]
    gap = {(2020, 1): 100.0, (2020, 3): 130.0}
    assert large_moves(gap, 5.0) == []  # no consecutive pair: nothing is guessed
