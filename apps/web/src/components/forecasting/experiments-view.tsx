"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import { fmtMetric, monthLabel, type Run, runsToCsv } from "@/lib/forecasting";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`;
type SortKey = "created_at" | "mae" | "mase" | "n_origins";

export function ExperimentsView({ runs, total }: { runs: Run[]; total: number }) {
  const [indicator, setIndicator] = useState("all");
  const [model, setModel] = useState("all");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" });

  const models = useMemo(() => [...new Set(runs.map((r) => r.model))].sort(), [runs]);
  const shown = useMemo(() => {
    const f = runs.filter(
      (r) =>
        (indicator === "all" || r.indicator === indicator) &&
        (model === "all" || r.model === model) &&
        (status === "all" || r.status === status) &&
        (kind === "all" || r.kind === kind),
    );
    const val = (r: Run): number | string | null =>
      sort.key === "created_at" ? r.created_at : sort.key === "n_origins" ? r.n_origins : (r.metrics[sort.key] ?? null);
    return [...f].sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "asc" ? 1 : -1);
    });
  }, [runs, indicator, model, status, kind, sort]);

  const th = (key: SortKey, label: string, right = false) => {
    const on = sort.key === key;
    return (
      <th scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`py-2 pr-4 ${right ? "text-right" : ""}`}>
        <button type="button" className={`inline-flex items-center gap-1 font-semibold ${focusRing}`} onClick={() => setSort({ key, dir: on && sort.dir === "desc" ? "asc" : "desc" })}>
          {label}
          <span aria-hidden className="text-ink-muted">{on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([runsToCsv(shown)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "forecast-experiments.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (runs.length === 0) {
    return (
      <Panel title="Experiments">
        <p className="text-sm text-ink-muted">No forecasting experiments have been stored yet.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Experiments">
      <div className="-mt-1 mb-4 flex flex-wrap items-end gap-3">
        {[
          ["Indicator", indicator, setIndicator, ["cpi", "wpi", "iip"]],
          ["Model", model, setModel, models],
          ["Status", status, setStatus, ["completed", "skipped", "failed"]],
          ["Type", kind, setKind, ["backtest", "forecast"]],
        ].map(([label, value, set, opts]) => (
          <label key={label as string} className="text-sm">
            <span className="mb-1 block text-ink-muted">{label as string}</span>
            <select className={selectClass} value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)}>
              <option value="all">All</option>
              {(opts as string[]).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <button type="button" onClick={download} className={`ml-auto rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
          Download CSV
        </button>
      </div>
      <p className="mb-3 text-sm text-ink-muted">
        {shown.length} of {runs.length} shown ({total} stored in total). Skipped runs are kept so that every
        exclusion is visible and explained.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">Stored forecasting experiments</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs">
              <th scope="col" className="py-2 pr-4 font-semibold">Run</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Indicator</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Type</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">Horizon</th>
              {th("n_origins", "Origins", true)}
              <th scope="col" className="py-2 pr-4 font-semibold">Training range</th>
              {th("mae", "MAE", true)}
              {th("mase", "MASE", true)}
              <th scope="col" className="py-2 pr-4 font-semibold">Status</th>
              {th("created_at", "Stored")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-rule last:border-b-0 align-top">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  <Link href={`/forecasting/experiments/${r.id}`} className={`figure underline ${focusRing}`}>#{r.id}</Link>
                </th>
                <td className="py-2 pr-4 uppercase">{r.indicator ?? "—"}</td>
                <td className="py-2 pr-4">{r.model_name}</td>
                <td className="py-2 pr-4 text-ink-muted">{r.kind}{r.suite ? ` · ${r.suite}` : ""}</td>
                <td className="figure py-2 pr-4 text-right">{r.horizon}</td>
                <td className="figure py-2 pr-4 text-right">{r.n_origins ?? "—"}</td>
                <td className="py-2 pr-4 text-ink-muted">{r.training_start ? `${monthLabel(r.training_start)} to ${monthLabel(r.training_cutoff)}` : "—"}</td>
                <td className="figure py-2 pr-4 text-right">{fmtMetric("mae", r.metrics.mae)}</td>
                <td className="figure py-2 pr-4 text-right">{fmtMetric("mase", r.metrics.mase)}</td>
                <td className="py-2 pr-4">
                  {r.status}
                  {r.error && <span className="block max-w-xs text-xs text-ink-muted">{r.error}</span>}
                </td>
                <td className="figure py-2 text-ink-muted">{r.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
