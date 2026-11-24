"""Forecasts V4 research evaluations. READ-ONLY: nothing is stored (the session is forced read-only).

    ARTHASENSE_DATABASE_URL=<db> python tools/forecasts_v4_eval.py linked  --indicator wpi  > linked-wpi.json
    ARTHASENSE_DATABASE_URL=<db> python tools/forecasts_v4_eval.py strategy --indicator cpi > strategy-cpi.json

linked   : does the official linked history (2011-12 back-cast with the publisher's factor) forecast the CURRENT
           series better than the current series alone? Fair test: the same models, horizons and scored target
           months. Origins are aligned by DATE: the linked backtest is restricted to origins on or after the current
           backtest's first origin (both expanding windows), so both are scored on identical target months; only
           the length of the training history differs.
strategy : recursive vs direct multi-step forecasting for Random Forest and XGBoost on the same origins.

Both print a JSON report (metrics per model and horizon, origin counts, scored windows).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
import psycopg

sys.path.insert(0, os.environ.get("REPO") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.forecasting.experiments import (  # noqa: E402
    backtest_records,
    load_training,
    suite_initial_train,
)

HORIZONS = (1, 3, 6, 12)


def _metrics(rows: list[dict]) -> dict:
    a = np.array([r["actual"] for r in rows], float)
    f = np.array([r["point"] for r in rows], float)
    e = f - a
    out = {"n": len(rows), "mae": float(np.mean(np.abs(e))), "rmse": float(math.sqrt(np.mean(e**2))),
           "smape": float(np.mean(200 * np.abs(e) / (np.abs(a) + np.abs(f)))), "bias": float(np.mean(e))}  # fmt: skip
    for lv in (80, 95):
        have = [r for r in rows if r.get(f"lower_{lv}") is not None]
        if len(have) >= 5:
            inside = [r[f"lower_{lv}"] <= r["actual"] <= r[f"upper_{lv}"] for r in have]
            out[f"coverage_{lv}"] = float(np.mean(inside))
            out[f"width_{lv}"] = float(np.mean([r[f"upper_{lv}"] - r[f"lower_{lv}"] for r in have]))
    if rows:
        out["window"] = [str(rows[0]["target_date"]), str(rows[-1]["target_date"])]
    return out


def linked(conn: psycopg.Connection, ind: str) -> dict:
    cur = load_training(conn, ind, "current")
    lnk = load_training(conn, ind, "linked")
    models = [
        "naive",
        "snaive",
        "drift",
        "ets",
        "arima",
    ]  # the models eligible on BOTH (18-month current window)
    rep: dict = {"indicator": ind, "current": {"n": len(cur), "span": [str(cur.periods[0]), str(cur.periods[-1])]},
                 "linked": {"n": len(lnk), "span": [str(lnk.periods[0]), str(lnk.periods[-1])], "link": lnk.link,
                            "join": str(lnk.join_period)}, "models": {}}  # fmt: skip
    first_origin = cur.periods[18 - 1]  # current backtest: initial_train 18 -> first origin = 18th month
    for mid in models:
        rc = {
            r.horizon: r for r in backtest_records(cur, ind, mid, HORIZONS, initial_train=18, config_set="v4")
        }
        start = sum(
            1 for p in lnk.periods if p <= first_origin
        )  # linked origin with the same last observed month
        rl = {
            r.horizon: r
            for r in backtest_records(lnk, ind, mid, HORIZONS, initial_train=start, config_set="v4")
        }
        rep["models"][mid] = {}
        for h in HORIZONS:
            a, b = rc.get(h), rl.get(h)
            if not a or not b or a.status != "completed" or b.status != "completed":
                rep["models"][mid][h] = {"status": [a.status if a else None, b.status if b else None],
                                         "error": [a.error if a else None, b.error if b else None]}  # fmt: skip
                continue
            ta = {r["origin_date"]: r for r in a.rows}
            tb = {r["origin_date"]: r for r in b.rows}
            common = sorted(set(ta) & set(tb))
            rep["models"][mid][h] = {"common_origins": len(common),
                                     "current": _metrics([ta[o] for o in common]),
                                     "linked": _metrics([tb[o] for o in common])}  # fmt: skip
    return rep


def strategy(conn: psycopg.Connection, ind: str) -> dict:
    ts = load_training(conn, ind, "linked")
    start = suite_initial_train(ts, "v4_linked")
    rep: dict = {"indicator": ind, "n": len(ts), "initial_train": start, "models": {}}
    for mid in ("rf", "xgboost"):
        for strat in ("recursive", "direct"):
            recs = backtest_records(ts, ind, mid, HORIZONS, initial_train=start, config_set="v4",
                                    overrides={"strategy": strat})  # fmt: skip
            rep["models"][f"{mid}:{strat}"] = {
                r.horizon: ({"status": r.status, "error": r.error} if r.status != "completed"
                            else {**_metrics(r.rows), "origins_fingerprint": r.origins_fingerprint})
                for r in recs
            }  # fmt: skip
    return rep


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("what", choices=["linked", "strategy"])
    p.add_argument("--indicator", required=True, choices=["cpi", "wpi", "iip"])
    a = p.parse_args()
    url = os.environ["ARTHASENSE_DATABASE_URL"]
    with psycopg.connect(url, options="-c default_transaction_read_only=on") as conn:
        assert conn.execute("show default_transaction_read_only").fetchone()[0] == "on"
        rep = linked(conn, a.indicator) if a.what == "linked" else strategy(conn, a.indicator)
    print(json.dumps(rep, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
