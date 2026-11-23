# ruff: noqa: E501
"""Read-only evidence for CPI forecasting on MoSPI's official linked history (Back 2013-2024 + Current 2025-).

    ARTHASENSE_DATABASE_URL=<local db> python tools/cpi_linked_evidence.py > reports/cpi-linked/evidence.json

1. Series audit: identity, coverage, gaps, duplicates and the relation of the Back series to the 2012 series.
2. The join: the Dec 2024 -> Jan 2025 step of the linked series against the same month's move in the 2012 series.
3. Integrity of every stored linked-history CPI run: no target at or before its origin, target = origin + step,
   backtest actuals equal the stored official value, 80% inside 95%, future rows after the last observation.
4. Sensitivity (computed in memory, never stored): the same models on the LONG history (core suite, origins from
   mid-2014, mostly Back-series targets) and with a 60-month rolling window instead of an expanding one.

The session is forced read-only, so any accidental write fails. Prints no credentials.
"""

from __future__ import annotations

import json
import math
import os
import statistics as st
import sys
from datetime import date

import psycopg

sys.path.insert(0, os.environ.get("REPO") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.forecasting.experiments import (  # noqa: E402
    INDICATORS,
    LINKED_SUITES,
    backtest_records,
    dataset_fingerprint,
    load_training,
    suite_initial_train,
    suite_records,
)
from pipeline.research.loader import CPI_BACK_INDEX, CPI_CURRENT_INDEX  # noqa: E402

CPI_2012_INDEX = "mospi.cpi.2012.current.all_india.combined.general.index"
OFFICIAL_LF = 0.5267  # MoSPI FAQs on CPI 2024, Annexure V, Q38 (Combined)


def series_audit(conn: psycopg.Connection, code: str) -> dict:
    row = conn.execute(
        "select s.id, s.base_year, s.unit, s.frequency, min(o.period_date), max(o.period_date), count(*),"
        " count(distinct o.period_date), count(distinct r.release_key), min(r.retrieved_at), max(r.retrieved_at),"
        " array_agg(distinct o.status)"
        " from series s join observations o on o.series_id=s.id join releases r on r.id=o.release_id"
        " where s.code=%s group by 1,2,3,4",
        (code,),
    ).fetchone()
    if row is None:
        return {"code": code, "stored": False}
    sid, base, unit, freq, first, last, n, n_dist, n_rel, r0, r1, statuses = row
    months = (last.year - first.year) * 12 + last.month - first.month + 1
    flagged = conn.execute(
        "select o.period_date, o.status from observations o where o.series_id=%s and o.status not in"
        " ('retrieved','source_final') order by 1",
        (sid,),
    ).fetchall()
    return {
        "code": code,
        "series_id": sid,
        "base_year": base,
        "unit": unit,
        "frequency": freq,
        "first": first,
        "last": last,
        "observations": n,
        "distinct_periods": n_dist,
        "duplicate_periods": n - n_dist,
        "missing_months": months - n_dist,
        "releases": n_rel,
        "retrieved": [r0, r1],
        "statuses": sorted(statuses),
        "flagged_periods": [[str(p), s] for p, s in flagged],
    }


def values(conn: psycopg.Connection, code: str) -> dict[date, float]:
    return {
        p: float(v)
        for p, v in conn.execute(
            "select o.period_date, o.value from observations o join series s on s.id=o.series_id where s.code=%s",
            (code,),
        )
    }


def summary(recs) -> list[dict]:
    out = []
    for r in recs:
        if r.status != "completed":
            out.append({"model": r.model_id, "h": r.horizon, "status": r.status, "reason": r.error})
            continue
        m = {k: round(v["value"], 4) for k, v in r.metrics.items()}
        out.append({"model": r.model_id, "h": r.horizon, "n_origins": r.n_origins, "first_target": str(r.rows[0]["target_date"]),
                    "last_target": str(r.rows[-1]["target_date"]), **m})  # fmt: skip
    return out


def main() -> None:
    out: dict = {}
    with psycopg.connect(
        os.environ["ARTHASENSE_DATABASE_URL"], options="-c default_transaction_read_only=on"
    ) as conn:
        assert conn.execute("show default_transaction_read_only").fetchone()[0] == "on"
        out["series"] = [series_audit(conn, c) for c in (CPI_CURRENT_INDEX, CPI_BACK_INDEX, CPI_2012_INDEX)]

        back, cur, old = (
            values(conn, CPI_BACK_INDEX),
            values(conn, CPI_CURRENT_INDEX),
            values(conn, CPI_2012_INDEX),
        )
        common = sorted(set(back) & set(old))
        ratios = [back[p] / old[p] for p in common]
        y25 = [date(2025, m, 1) for m in range(1, 13)]
        gm = lambda xs: math.exp(st.mean(math.log(x) for x in xs))  # noqa: E731
        d24, j25 = date(2024, 12, 1), date(2025, 1, 1)
        back_mom = [
            100 * (back[b] / back[a] - 1) for a, b in zip(sorted(back), sorted(back)[1:], strict=False)
        ]
        out["linking"] = {
            "overlap_back_current_months": len(set(back) & set(cur)),
            "back_over_2012_ratio": {"n": len(ratios), "min": min(ratios), "max": max(ratios), "mean": st.mean(ratios)},
            "max_abs_back_minus_2012_x_lf": max(abs(back[p] - old[p] * OFFICIAL_LF) for p in common),
            "lf_recomputed_gm2025": gm([cur[p] for p in y25]) / gm([old[p] for p in y25]) if all(p in old for p in y25) else None,
            "current_over_2012_ratio_2025": {str(p): round(cur[p] / old[p], 5) for p in y25 if p in old},
            "join_step_pct": 100 * (cur[j25] / back[d24] - 1),
            "same_month_2012_series_pct": 100 * (old[j25] / old[d24] - 1) if j25 in old and d24 in old else None,
            "back_mom_pct": {"mean": st.mean(back_mom), "sd": st.stdev(back_mom)},
        }  # fmt: skip
        lk = out["linking"]
        if lk["same_month_2012_series_pct"] is not None:
            lk["join_method_component_pp"] = lk["join_step_pct"] - lk["same_month_2012_series_pct"]

        ts = load_training(conn, "cpi", "linked")
        fp = dataset_fingerprint(ts)
        out["training_series"] = {"code": ts.series_code, "components": ts.components, "join": ts.join_period,
                                  "n": len(ts), "first": ts.periods[0], "last": ts.periods[-1], "fingerprint": fp}  # fmt: skip

        # ---- integrity of the stored linked runs ----
        runs = conn.execute(
            "select fr.id, fr.kind, fr.model_name, fr.horizon, fr.status, fr.n_origins, fr.training_start,"
            " fr.training_cutoff, fr.suite, fr.experiment_id from forecast_runs fr join series s on s.id=fr.series_id"
            " where s.code=%s and fr.dataset_fingerprint=%s order by fr.kind, fr.model_name, fr.horizon",
            (INDICATORS["cpi"], fp),
        ).fetchall()
        ids = [r[0] for r in runs]
        q = lambda sql: conn.execute(sql, (ids,)).fetchone()[0]  # noqa: E731
        out["integrity"] = {
            "runs": len(runs),
            "backtest_runs": sum(1 for r in runs if r[1] == "backtest"),
            "forecast_runs": sum(1 for r in runs if r[1] == "forecast"),
            "rows": q("select count(*) from forecasts where run_id = any(%s)"),
            "target_not_after_origin": q("select count(*) from forecasts where run_id = any(%s) and target_date <= origin_date"),
            "target_not_origin_plus_step": q("select count(*) from forecasts where run_id = any(%s)"
                                             " and target_date <> (origin_date + make_interval(months => step))::date"),
            "backtest_target_before_join": q("select count(*) from forecasts f join forecast_runs fr on fr.id=f.run_id"
                                             " where f.run_id = any(%s) and fr.kind='backtest' and f.target_date < '2025-01-01'"),
            "backtest_actual_differs_from_official": q(
                "select count(*) from forecasts f join forecast_runs fr on fr.id=f.run_id"
                " join observations o on o.series_id=fr.series_id and o.period_date=f.target_date"
                " where f.run_id = any(%s) and fr.kind='backtest' and f.actual_value <> o.value"),
            "backtest_actual_missing": q("select count(*) from forecasts f join forecast_runs fr on fr.id=f.run_id"
                                         " where f.run_id = any(%s) and fr.kind='backtest' and f.actual_value is null"),
            "interval_80_outside_95": q("select count(*) from forecasts where run_id = any(%s) and lower_80 is not null"
                                        " and lower_95 is not null and (lower_80 < lower_95 or upper_80 > upper_95)"),
            "point_outside_80": q("select count(*) from forecasts where run_id = any(%s) and lower_80 is not null"
                                  " and (point_forecast < lower_80 or point_forecast > upper_80)"),
            "future_row_not_after_last_obs": q("select count(*) from forecasts f join forecast_runs fr on fr.id=f.run_id"
                                               " where f.run_id = any(%s) and fr.kind='forecast' and f.target_date <= '2026-10-01'"),
        }  # fmt: skip
        out["stored_runs"] = [
            {"id": r[0], "kind": r[1], "model": r[2], "h": r[3], "status": r[4], "n_origins": r[5], "training_start": r[6],
             "training_cutoff": r[7], "suite": r[8], "experiment_id": r[9]} for r in runs
        ]  # fmt: skip
        fc = conn.execute(
            "select fr.model_name, f.step, f.target_date, f.point_forecast, f.lower_80, f.upper_80, f.lower_95, f.upper_95,"
            " f.interval_method from forecasts f join forecast_runs fr on fr.id=f.run_id"
            " where f.run_id = any(%s) and fr.kind='forecast' order by 1, 2",
            (ids,),
        ).fetchall()
        out["future_forecasts"] = [
            {"model": m, "step": s, "target": t, "point": float(p), "80": [float(a), float(b)] if a is not None else None,
             "95": [float(c), float(d)] if c is not None else None, "method": meth} for m, s, t, p, a, b, c, d, meth in fc
        ]  # fmt: skip

        # ---- sensitivity, in memory only ----
        name = "linked_current"
        cfg = LINKED_SUITES[name]
        out["evaluation_current_targets"] = summary(suite_records(ts, "cpi", name))
        long_recs = []
        for mid in cfg["models"]:
            long_recs += backtest_records(
                ts, "cpi", mid, (1, 3, 6), initial_train=18, suite="sensitivity_long"
            )
        out["sensitivity_long_history_core"] = summary(long_recs)
        init = suite_initial_train(ts, name)
        roll = []
        for mid in cfg["models"]:
            roll += backtest_records(
                ts, "cpi", mid, (1, 3, 6), initial_train=init, window=60, suite="sensitivity_roll60"
            )
        out["sensitivity_rolling_60"] = summary(roll)
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
