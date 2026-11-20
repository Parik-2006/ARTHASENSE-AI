"""Research tables and figures, generated ONLY from stored data and stored experiment records.

    python -m pipeline.forecasting.report --out docs/research/generated

Writes CSV + Markdown tables and PNG figures. Re-running on the same database content gives the same
numbers. If a table has no supporting experiment it is written as "pending" instead of being invented.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

import psycopg

from pipeline.forecasting import registry
from pipeline.forecasting.experiments import INDICATORS
from pipeline.ingest.config import database_url

METRICS = ["mae", "rmse", "mase", "smape", "bias"]


def fetch_runs(conn: psycopg.Connection) -> list[dict[str, Any]]:
    cols = ("id", "indicator", "model", "kind", "status", "error", "horizon", "suite", "n_origins", "training_start",
            "training_cutoff", "dataset_fingerprint", "origins_fingerprint", "runtime_seconds", "seed")  # fmt: skip
    rows = conn.execute(
        "SELECT fr.id, s.code, fr.model_name, fr.kind, fr.status, fr.error, fr.horizon, fr.suite, fr.n_origins,"
        " fr.training_start, fr.training_cutoff, fr.dataset_fingerprint, fr.origins_fingerprint, fr.runtime_seconds,"
        " fr.random_seed FROM forecast_runs fr JOIN series s ON s.id = fr.series_id ORDER BY fr.id"
    ).fetchall()
    code_to_ind = {v: k for k, v in INDICATORS.items()}
    runs = [dict(zip(cols, r, strict=True)) for r in rows]
    for r in runs:
        r["indicator"] = code_to_ind.get(r["indicator"], r["indicator"])
        r["metrics"] = {}
    by_id = {r["id"]: r for r in runs}
    for rid, metric, value, n in conn.execute("SELECT run_id, metric, metric_value, n_samples FROM scores"):
        by_id[rid]["metrics"][metric] = (float(value), n)
    return runs


def write_table(
    out: Path, name: str, title: str, header: list[str], rows: list[list[Any]], note: str = ""
) -> str:
    out.mkdir(parents=True, exist_ok=True)
    with (out / f"{name}.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    md = [f"### {title}", ""]
    if not rows:
        md += ["*Pending: no stored experiment supports this table.*", ""]
    else:
        md += ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
        md += ["| " + " | ".join("" if c is None else str(c) for c in r) + " |" for r in rows]
        md += [""]
    if note:
        md += [note, ""]
    text = "\n".join(md)
    (out / f"{name}.md").write_text(text + "\n", encoding="utf-8")
    return text


def f3(v: Any) -> str:
    return "" if v is None else f"{v:.3f}"


def build_tables(conn: psycopg.Connection, runs: list[dict[str, Any]], out: Path) -> list[str]:
    md: list[str] = []
    # 1. data coverage (dataset characteristics)
    rows = []
    for ind, code in INDICATORS.items():
        r = conn.execute(
            "SELECT s.base_year, count(DISTINCT o.period_date), min(o.period_date), max(o.period_date),"
            " (SELECT max(r2.retrieved_at) FROM releases r2 JOIN observations o2 ON o2.release_id = r2.id"
            "   WHERE o2.series_id = s.id) FROM series s LEFT JOIN observations o ON o.series_id = s.id"
            " WHERE s.code = %s GROUP BY s.id",
            (code,),
        ).fetchone()
        if r:
            n = r[1]
            span = (r[3].year * 12 + r[3].month) - (r[2].year * 12 + r[2].month) + 1 if n else 0
            rows.append([ind.upper(), code, r[0], str(r[2]), str(r[3]), n, span - n, "MoSPI eSankhyiki API", str(r[4])[:19], "not provided by the API"])  # fmt: skip
    md.append(write_table(out, "table1_dataset_coverage", "Table 1: Dataset characteristics (stored headline index series)",
                          ["Indicator", "Series", "Base year", "First month", "Last month", "Observations", "Missing months",
                           "Source", "Retrieved (UTC)", "Publication date"], rows,
                          "Index levels only. Retrieval time is when the data was downloaded, not when it was published."))  # fmt: skip
    # 2. model configurations
    rows = []
    for s in registry.SPECS.values():
        ok, why = registry.availability(s.id)
        rows.append([s.id, s.family.replace("_", " "), json.dumps(s.cls.__name__), json.dumps(s.config, sort_keys=True),
                     registry.min_train(s.id), "available" if ok else "unavailable: " + str(why)])  # fmt: skip
    md.append(write_table(out, "table2_model_configurations", "Table 2: Model configurations",
                          ["Model", "Family", "Class", "Configuration", "Min. training obs.", "Status"], rows))  # fmt: skip
    # 3. error comparison (completed backtests; one block per suite)
    done = [r for r in runs if r["kind"] == "backtest" and r["status"] == "completed"]
    rows = []
    for r in sorted(done, key=lambda r: (r["indicator"], r["suite"] or "", r["horizon"], r["model"])):
        m = r["metrics"]
        rows.append([r["indicator"].upper(), r["suite"], r["horizon"], r["model"], r["n_origins"]] + [f3(m[k][0]) if k in m else "" for k in METRICS]
                    + ["yes" if (r["n_origins"] or 0) >= 12 else "indicative"])  # fmt: skip
    md.append(write_table(out, "table3_forecast_errors", "Table 3: Backtest errors by indicator, suite, horizon and model",
                          ["Indicator", "Suite", "Horizon (months)", "Model", "Origins", "MAE", "RMSE", "MASE", "sMAPE (%)", "Bias", "Rankable (>=12 origins)"], rows,
                          "MAE/RMSE/bias are in index points. MASE scales by the training-window mean absolute one-step change. Only models evaluated on identical origins within a suite are comparable."))  # fmt: skip
    # 4. MASE by horizon (core suite)
    rows = []
    for ind in INDICATORS:
        models = sorted({r["model"] for r in done if r["indicator"] == ind and r["suite"] == "core"})
        for mdl in models:
            cells = []
            for h in (1, 3, 6, 12):
                hit = next(
                    (
                        r
                        for r in done
                        if r["indicator"] == ind
                        and r["suite"] == "core"
                        and r["model"] == mdl
                        and r["horizon"] == h
                    ),
                    None,
                )
                cells.append(f3(hit["metrics"]["mase"][0]) if hit and "mase" in hit["metrics"] else "")
            rows.append([ind.upper(), mdl, *cells])
    md.append(write_table(out, "table4_mase_by_horizon", "Table 4: MASE by forecast horizon (core suite, initial training window 18 months)",
                          ["Indicator", "Model", "h=1", "h=3", "h=6", "h=12"], rows,
                          "MASE < 1 means better than the one-step naive in-sample error. Origins shrink as the horizon grows (see Table 3)."))  # fmt: skip
    # 5. interval coverage
    rows = []
    for r in sorted(done, key=lambda r: (r["indicator"], r["suite"] or "", r["horizon"], r["model"])):
        m = r["metrics"]
        if True:  # every completed run is listed; unavailable coverage shows as n/a
            rows.append([r["indicator"].upper(), r["suite"], r["horizon"], r["model"], r["n_origins"],
                         m["coverage_80"][1] if "coverage_80" in m else "", m["coverage_95"][1] if "coverage_95" in m else "",
                         f3(m["coverage_80"][0]) if "coverage_80" in m else "n/a", f3(m["coverage_95"][0]) if "coverage_95" in m else "n/a",
                         f3(m["width_80"][0]) if "width_80" in m else ""])  # fmt: skip
    md.append(write_table(out, "table5_interval_coverage", "Table 5: Empirical prediction-interval coverage (nominal 0.80 and 0.95)",
                          ["Indicator", "Suite", "Horizon", "Model", "Origins", "Coverage n (80%)", "Coverage n (95%)", "Coverage 80%", "Coverage 95%", "Mean width 80%"], rows,
                          "n/a: not enough earlier errors to calibrate (online conformal 95% needs >= 19) or the model has no intervals. Coverage far below nominal means the intervals are too narrow."))  # fmt: skip
    # 6. skipped / excluded
    sk = sorted(
        {
            (r["indicator"].upper(), r["model"], r["error"])
            for r in runs
            if r["status"] != "completed" and r["kind"] == "backtest"
        }
    )
    md.append(
        write_table(
            out,
            "table6_excluded_runs",
            "Table 6: Runs that were not evaluated, and why",
            ["Indicator", "Model", "Reason"],
            [list(x) for x in sk],
        )
    )
    return md


def build_figures(conn: psycopg.Connection, runs: list[dict[str, Any]], out: Path) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    names = []
    done = [r for r in runs if r["kind"] == "backtest" and r["status"] == "completed"]
    for ind, code in INDICATORS.items():
        hist = conn.execute(
            "SELECT DISTINCT ON (o.period_date) o.period_date, o.value FROM observations o JOIN series s ON s.id=o.series_id"
            " JOIN releases r ON r.id=o.release_id WHERE s.code=%s ORDER BY o.period_date, r.retrieved_at DESC", (code,)
        ).fetchall()  # fmt: skip
        if len(hist) < 2:
            continue
        base = conn.execute("SELECT base_year FROM series WHERE code=%s", (code,)).fetchone()[0]
        # Figure A: actual vs h=3 backtest predictions (core suite) + stored future forecast
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.plot(
            [h[0] for h in hist],
            [float(h[1]) for h in hist],
            color="#0e6b66",
            lw=2,
            label="Observed (official)",
        )
        for r in (
            r
            for r in done
            if r["indicator"] == ind
            and r["suite"] == "core"
            and r["horizon"] == 3
            and r["model"] in ("naive", "ets")
        ):
            pts = conn.execute(
                "SELECT target_date, point_forecast FROM forecasts WHERE run_id=%s ORDER BY target_date",
                (r["id"],),
            ).fetchall()
            ax.plot(
                [p[0] for p in pts],
                [float(p[1]) for p in pts],
                lw=1.2,
                ls="--",
                marker=".",
                label=f"{r['model']} 3-month-ahead (backtest)",
            )
        fut = next(
            (
                r
                for r in runs
                if r["indicator"] == ind
                and r["kind"] == "forecast"
                and r["model"] == "ets"
                and r["status"] == "completed"
            ),
            None,
        )
        if fut:
            rows = conn.execute(
                "SELECT target_date, point_forecast, lower_80, upper_80 FROM forecasts WHERE run_id=%s ORDER BY target_date",
                (fut["id"],),
            ).fetchall()
            ax.plot(
                [x[0] for x in rows],
                [float(x[1]) for x in rows],
                color="#8a6d1f",
                lw=2,
                label="ETS forecast (future)",
            )
            if rows and rows[0][2] is not None:
                ax.fill_between(
                    [x[0] for x in rows],
                    [float(x[2]) for x in rows],
                    [float(x[3]) for x in rows],
                    color="#8a6d1f",
                    alpha=0.2,
                    label="ETS 80% interval",
                )
        ax.set_title(f"{ind.upper()} index: observed, backtest and forecast (base {base})")
        ax.set_xlabel("Month")
        ax.set_ylabel(f"{ind.upper()} index ({base} = 100)")
        ax.legend(fontsize=7)
        ax.grid(alpha=0.3)
        fig.autofmt_xdate()
        fig.tight_layout()
        p = f"fig_actual_vs_forecast_{ind}.png"
        fig.savefig(out / p, dpi=150)
        plt.close(fig)
        names.append(p)
        # Figure B: MASE by horizon, core suite
        core = [r for r in done if r["indicator"] == ind and r["suite"] == "core" and "mase" in r["metrics"]]
        if core:
            fig, ax = plt.subplots(figsize=(6.5, 4))
            for mdl in sorted({r["model"] for r in core}):
                pts = sorted((r["horizon"], r["metrics"]["mase"][0]) for r in core if r["model"] == mdl)
                ax.plot([x[0] for x in pts], [x[1] for x in pts], marker="o", label=mdl)
            ax.axhline(1.0, color="grey", lw=0.8, ls=":")
            ax.set_title(f"{ind.upper()}: MASE by forecast horizon (core suite)")
            ax.set_xlabel("Forecast horizon (months ahead)")
            ax.set_ylabel("MASE (lower is better; <1 beats naive in-sample)")
            ax.set_xticks([1, 3, 6, 12])
            ax.legend(fontsize=7)
            ax.grid(alpha=0.3)
            fig.tight_layout()
            p = f"fig_mase_by_horizon_{ind}.png"
            fig.savefig(out / p, dpi=150)
            plt.close(fig)
            names.append(p)
        # Figure C: interval coverage at h=1,3 for models with intervals (core suite)
        cov = [
            r
            for r in done
            if r["indicator"] == ind
            and r["suite"] == "core"
            and "coverage_80" in r["metrics"]
            and r["horizon"] in (1, 3)
        ]
        if cov:
            fig, ax = plt.subplots(figsize=(6.5, 4))
            labels = [f"{r['model']}\nh={r['horizon']}" for r in cov]
            ax.bar(range(len(cov)), [r["metrics"]["coverage_80"][0] for r in cov], color="#0e6b66")
            ax.axhline(0.8, color="#a15c00", ls="--", label="nominal 80%")
            ax.set_xticks(range(len(cov)), labels, fontsize=7)
            ax.set_ylim(0, 1.05)
            ax.set_ylabel("Empirical coverage of 80% interval")
            ax.set_title(f"{ind.upper()}: 80% interval coverage")
            ax.legend(fontsize=7)
            fig.tight_layout()
            p = f"fig_interval_coverage_{ind}.png"
            fig.savefig(out / p, dpi=150)
            plt.close(fig)
            names.append(p)
    return names


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline.forecasting.report", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    p.add_argument("--out", default="docs/research/generated")
    args = p.parse_args(argv)
    url = database_url()
    if not url:
        print("Error: ARTHASENSE_DATABASE_URL is not set", file=sys.stderr)
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            runs = fetch_runs(conn)
            md = build_tables(conn, runs, out)
            figs = build_figures(conn, runs, out)
    except psycopg.Error as exc:
        print(f"Database error: {str(exc).strip().splitlines()[0]}", file=sys.stderr)
        return 1
    (out / "all_tables.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"Wrote {len(md)} tables and {len(figs)} figures to {out} from {len(runs)} stored runs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
