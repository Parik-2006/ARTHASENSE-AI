"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { Tour, TourButton } from "@/components/guide/tour";
import { Panel } from "@/components/ui/primitives";
import {
  applyExperimentFilters,
  type ExperimentFilters,
  paginate,
  parseExperimentFilters,
  serializeExperimentFilters,
  type SortKey,
} from "@/lib/experiments-filter";
import { fmtMetric, monthLabel, type Run, runsToCsv } from "@/lib/forecasting";
import { EXPERIMENTS_TOUR } from "@/lib/guide";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`;

/** Experiment history. All filters, sorting and the page number live in the URL, so a filtered view can
 *  be shared and Back/Forward work. Skipped and failed runs stay visible unless the user filters them. */
export function ExperimentsView({ runs, total }: { runs: Run[]; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of runs) m.set(r.model, r.model_name); // readable name; the id stays in the URL
    return m;
  }, [runs]);
  const f = useMemo(() => parseExperimentFilters((k) => params?.get(k) ?? null, [...names.keys()]), [params, names]);
  const horizons = useMemo(() => [...new Set(runs.map((r) => r.horizon))].sort((a, b) => a - b), [runs]);

  const filtered = useMemo(() => applyExperimentFilters(runs, f), [runs, f]);
  const pg = paginate(filtered, f.page);
  const push = (patch: Partial<ExperimentFilters>, resetPage = true) => {
    const qs = serializeExperimentFilters({ ...f, ...patch, page: resetPage ? 1 : (patch.page ?? f.page) }).toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    // Typing (search, min origins) refines the current step; choosing a filter, sort or page is a new step.
    if ("q" in patch || "minOrigins" in patch) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  };
  const hasFilters = serializeExperimentFilters(f).toString() !== "";

  const th = (key: SortKey, label: string, right = false) => {
    const on = f.sort === key;
    return (
      <th scope="col" aria-sort={on ? (f.dir === "asc" ? "ascending" : "descending") : "none"} className={`py-2 pr-4 ${right ? "text-right" : ""}`}>
        <button type="button" className={`inline-flex items-center gap-1 font-semibold ${focusRing}`} onClick={() => push({ sort: key, dir: on && f.dir === "desc" ? "asc" : "desc" })}>
          {label}
          <span aria-hidden className="text-ink-muted">{on ? (f.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([runsToCsv(filtered)], { type: "text/csv;charset=utf-8" }));
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
  const select = (label: string, value: string | null, key: keyof ExperimentFilters, options: [string, string][]) => (
    <label key={label} className="text-sm">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <select aria-label={label} className={selectClass} value={value ?? ""} onChange={(e) => push({ [key]: e.target.value === "" ? null : key === "horizon" ? Number(e.target.value) : e.target.value } as Partial<ExperimentFilters>)}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <Tour steps={EXPERIMENTS_TOUR} />
      <Panel title="Experiments">
        <div data-tour="fe-filters" className="-mt-1 mb-4 flex flex-wrap items-end gap-3">
          {select("Indicator", f.indicator, "indicator", [["cpi", "CPI"], ["wpi", "WPI"], ["iip", "IIP"]])}
          {select("Model", f.model, "model", [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])))}
          {select("Status", f.status, "status", [["completed", "Completed"], ["skipped", "Skipped"], ["failed", "Failed"]])}
          {select("Run type", f.kind, "kind", [["backtest", "Backtest"], ["forecast", "Forecast"]])}
          {select("Horizon", f.horizon === null ? null : String(f.horizon), "horizon", horizons.map((h) => [String(h), `${h} month${h > 1 ? "s" : ""}`]))}
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Min. origins</span>
            <input aria-label="Minimum origins" type="number" min={1} inputMode="numeric" className={`${selectClass} w-24`} value={f.minOrigins ?? ""} onChange={(e) => push({ minOrigins: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value)) || 1) })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Search run # or model</span>
            <input aria-label="Search runs" type="search" className={`${selectClass} w-44`} value={f.q} placeholder="#12 or ARIMA" onChange={(e) => push({ q: e.target.value })} />
          </label>
          <button type="button" onClick={() => router.push(pathname, { scroll: false })} disabled={!hasFilters} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-40 ${focusRing}`}>
            Reset filters
          </button>
          <TourButton className={`rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-bg ${focusRing}`}>Take a Tour</TourButton>
          <button type="button" onClick={download} className={`ml-auto rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
            Download CSV ({filtered.length})
          </button>
        </div>
        <p className="mb-3 text-sm text-ink-muted" aria-live="polite">
          {filtered.length} of {runs.length} loaded runs match ({total} stored in total
          {total > runs.length ? `; only the newest ${runs.length} are loaded here` : ""}). Skipped and failed runs are kept so every exclusion is visible
          and explained. Backtests need at least 5 origins to report accuracy <HelpTip id="backtesting" />.
        </p>
        <div data-tour="fe-table" className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <caption className="sr-only">Stored forecasting experiments, page {pg.page} of {pg.pages}</caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs">
                <th scope="col" className="py-2 pr-4 font-semibold">Run</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Indicator</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Type</th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">Horizon</th>
                {th("n_origins", "Origins", true)}
                <th scope="col" className="py-2 pr-4 font-semibold">Training range</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Evaluation window</th>
                {th("mae", "MAE", true)}
                {th("mase", "MASE", true)}
                <th scope="col" className="py-2 pr-4 font-semibold">Status</th>
                {th("created_at", "Stored")}
              </tr>
            </thead>
            <tbody>
              {pg.items.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-6 text-center text-ink-muted">No runs match these filters. Use Reset filters to see all.</td>
                </tr>
              )}
              {pg.items.map((r) => (
                <tr key={r.id} className="border-b border-rule align-top last:border-b-0">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    <Link href={`/forecasting/experiments/${r.id}`} className={`figure underline ${focusRing}`}>#{r.id}</Link>
                  </th>
                  <td className="py-2 pr-4 uppercase">{r.indicator ?? "—"}</td>
                  <td className="py-2 pr-4">{r.model_name}</td>
                  <td className="py-2 pr-4 text-ink-muted">{r.kind}{r.suite ? ` · ${r.suite}` : ""}</td>
                  <td className="figure py-2 pr-4 text-right">{r.horizon}</td>
                  <td className="figure py-2 pr-4 text-right">{r.n_origins ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-muted">{r.training_start ? `${monthLabel(r.training_start)} to ${monthLabel(r.training_cutoff)}` : "Not recorded"}</td>
                  <td className="py-2 pr-4 text-ink-muted">{r.evaluation_start && r.evaluation_end ? `${monthLabel(r.evaluation_start)} to ${monthLabel(r.evaluation_end)}` : "—"}</td>
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
        {pg.pages > 1 && (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
            <button type="button" disabled={pg.page <= 1} onClick={() => push({ page: pg.page - 1 }, false)} className={`rounded border border-rule px-3 py-1.5 hover:bg-bg disabled:opacity-40 ${focusRing}`}>Previous</button>
            <span>Page {pg.page} of {pg.pages}</span>
            <button type="button" disabled={pg.page >= pg.pages} onClick={() => push({ page: pg.page + 1 }, false)} className={`rounded border border-rule px-3 py-1.5 hover:bg-bg disabled:opacity-40 ${focusRing}`}>Next</button>
          </nav>
        )}
      </Panel>
    </>
  );
}

