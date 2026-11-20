"""Forecasting command line.

    python -m pipeline.forecasting.cli models
    python -m pipeline.forecasting.cli backtest --indicator wpi --models naive,snaive,ets --horizons 1,3,6
    python -m pipeline.forecasting.cli forecast --indicator iip --model ets --horizon 3
    python -m pipeline.forecasting.cli backtest ... --save        # also store in PostgreSQL

Reads the stored index series (read-only). Nothing is written unless --save is given, and --save
needs migration 0002. Results printed here are real backtest outputs, never samples.
"""

from __future__ import annotations

import argparse
import json
import sys

import psycopg

from pipeline.forecasting import registry
from pipeline.forecasting.experiments import (
    DEFAULT_HORIZONS,
    FUTURE_HORIZON,
    FUTURE_MODELS,
    INDICATORS,
    SUITES,
    RunRecord,
    backtest_records,
    forecast_record,
    load_indicator,
    suite_records,
)
from pipeline.forecasting.persistence import store_run
from pipeline.ingest.config import database_url
from pipeline.research.loader import LoaderError


def _ints(text: str) -> tuple[int, ...]:
    return tuple(int(x) for x in text.split(",") if x.strip())


def _fmt(v: float | None, digits: int = 3) -> str:
    return "  n/a" if v is None else f"{v:.{digits}f}"


def print_table(records: list[RunRecord]) -> None:
    print(
        f"{'model':8} {'h':>2} {'n':>3} {'MAE':>7} {'RMSE':>7} {'MASE':>6} {'sMAPE%':>7} {'cov80':>6} {'cov95':>6}  note"
    )
    for r in records:
        m = {k: v["value"] for k, v in r.metrics.items()}
        note = r.error or ("indicative only (<12 origins)" if not r.rankable else "")
        print(f"{r.model_id:8} {r.horizon:>2} {r.n_origins:>3} {_fmt(m.get('mae'))} {_fmt(m.get('rmse'))}"
              f" {_fmt(m.get('mase'), 2)} {_fmt(m.get('smape'), 2)} {_fmt(m.get('coverage_80'), 2)} {_fmt(m.get('coverage_95'), 2)}  {note}")  # fmt: skip


def run_suites(conn: psycopg.Connection, args: argparse.Namespace) -> int:
    names = [*SUITES, "future"] if args.name == "all" else [args.name]
    inds = sorted(INDICATORS) if args.indicator == "all" else [args.indicator]
    totals = {"stored": 0, "exists": 0, "records": 0, "skipped": 0}
    for ind in inds:
        try:
            ts = load_indicator(conn, ind)
        except LoaderError as exc:
            print(f"{ind.upper()}: not available ({exc})")
            continue
        span = f"{ts.periods[0]:%Y-%m}..{ts.periods[-1]:%Y-%m}"
        print(f"\n== {ind.upper()}: {len(ts)} months {span}, base {ts.base_year}")
        for name in names:
            if name == "future":
                recs = []
                for mid in FUTURE_MODELS:
                    try:
                        recs.append(forecast_record(ts, ind, mid, FUTURE_HORIZON, seed=args.seed))
                    except ValueError as exc:
                        print(f"  future {mid}: refused ({exc})")
                print(f"-- future forecasts (h={FUTURE_HORIZON}): {len(recs)} run(s)")
            else:
                recs = suite_records(ts, ind, name, args.seed)
                print(f"-- suite {name} (initial train {SUITES[name]['initial_train']})")
                print_table([r for r in recs if r.status == "completed"])
                for r in recs:
                    if r.status != "completed":
                        totals["skipped"] += 1
                skipped = sorted({(r.model_id, r.error) for r in recs if r.status != "completed"})
                for mid, why in skipped[:8]:
                    print(f"  skipped {mid}: {why}")
            totals["records"] += len(recs)
            if args.save:
                for r in recs:
                    state, _ = store_run(conn, r)
                    totals[state] += 1
    print(
        f"\nrecords: {totals['records']}  stored: {totals['stored']}  "
        f"already stored: {totals['exists']}  skipped runs: {totals['skipped']}"
    )
    if not args.save:
        print("(not saved: add --save to store in PostgreSQL)")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.forecasting.cli", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("models", help="list models, minimum history and availability")
    b = sub.add_parser("backtest", help="rolling-origin backtest")
    b.add_argument("--indicator", required=True, choices=sorted(INDICATORS))
    b.add_argument("--models", required=True, help="comma-separated ids (see `models`)")
    b.add_argument("--horizons", default=",".join(map(str, DEFAULT_HORIZONS)))
    b.add_argument("--initial-train", type=int, default=18)
    b.add_argument("--step", type=int, default=1)
    b.add_argument("--window", type=int, default=None, help="rolling window length (default: expanding)")
    b.add_argument("--seed", type=int, default=0)
    b.add_argument("--suite", default=None)
    b.add_argument("--json", action="store_true")
    b.add_argument("--save", action="store_true", help="store runs in PostgreSQL (idempotent)")
    su = sub.add_parser("suite", help="run a predefined research suite (reproducible)")
    su.add_argument("--name", required=True, choices=[*SUITES, "future", "all"])
    su.add_argument("--indicator", default="all", choices=[*sorted(INDICATORS), "all"])
    su.add_argument("--seed", type=int, default=0)
    su.add_argument("--save", action="store_true", help="store runs in PostgreSQL (idempotent)")
    f = sub.add_parser("forecast", help="forecast the genuine future from the full stored series")
    f.add_argument("--indicator", required=True, choices=sorted(INDICATORS))
    f.add_argument("--model", required=True)
    f.add_argument("--horizon", required=True, type=int)
    f.add_argument("--initial-train", type=int, default=18)
    f.add_argument("--seed", type=int, default=0)
    f.add_argument("--json", action="store_true")
    f.add_argument("--save", action="store_true")
    args = p.parse_args(argv)

    if args.cmd == "models":
        print(f"{'id':10} {'family':17} {'min train':>9}  availability")
        for s in registry.SPECS.values():
            ok, why = registry.availability(s.id)
            print(
                f"{s.id:10} {s.family:17} {registry.min_train(s.id):>9}  {'available' if ok else 'UNAVAILABLE: ' + str(why)}"
            )
        return 0

    url = database_url()
    if not url:
        print("Error: ARTHASENSE_DATABASE_URL is not set (see .env.example)", file=sys.stderr)
        return 2
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            if args.cmd == "suite":
                return run_suites(conn, args)
            ts = load_indicator(conn, args.indicator)
            n = len(ts)
            print(
                f"{args.indicator.upper()} index, base {ts.base_year}, {n} months {ts.periods[0]:%Y-%m} to {ts.periods[-1]:%Y-%m}"
            )
            if args.cmd == "backtest":
                horizons = _ints(args.horizons)
                records: list[RunRecord] = []
                for mid in [m.strip() for m in args.models.split(",") if m.strip()]:
                    records += backtest_records(ts, args.indicator, mid, horizons, initial_train=args.initial_train,
                                                step=args.step, window=args.window, seed=args.seed, suite=args.suite)  # fmt: skip
            else:
                records = [forecast_record(ts, args.indicator, args.model, args.horizon,
                                           initial_train=args.initial_train, seed=args.seed)]  # fmt: skip
            if args.json:
                print(json.dumps([{**{k: getattr(r, k) for k in ("experiment_id", "kind", "model_id", "horizon", "status",
                                                                  "error", "n_origins", "metrics", "rankable")},
                                   "rows": r.rows} for r in records], default=str, indent=2))  # fmt: skip
            elif args.cmd == "backtest":
                print_table(records)
            else:
                for row in records[0].rows:
                    lo, hi = row.get("lower_80"), row.get("upper_80")
                    iv = f"  80%: [{lo:.2f}, {hi:.2f}]" if lo is not None else "  (no interval)"
                    print(f"  {row['target_date']:%Y-%m}  {row['point']:.2f}{iv}")
            if args.save:
                for r in records:
                    state, run_id = store_run(conn, r)
                    print(f"  saved {r.model_id} h={r.horizon}: {state} (run {run_id})")
            else:
                print("(not saved: add --save to store in PostgreSQL)")
    except (LoaderError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except psycopg.Error as exc:
        text = str(exc).strip().splitlines()
        print(f"Database error: {text[0] if text else 'unknown'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
