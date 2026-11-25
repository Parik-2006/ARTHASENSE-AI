"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { ForecastTourButton, SpotlightTour } from "@/components/forecasting/spotlight-tour";
import { parseView, withView } from "@/components/forecasting/view-mode";
import { Panel } from "@/components/ui/primitives";
import {
  applyExperimentFilters,
  type ExperimentFilters,
  paginate,
  parseExperimentFilters,
  serializeExperimentFilters,
  type SortKey,
} from "@/lib/experiments-filter";
import { EXPERIMENTS_STEPS } from "@/lib/forecast-tours";
import { fmtMetric, METRIC_LABELS, periodLabel, type Run, runsToCsv } from "@/lib/forecasting";

const freqOf = (r: Run) => r.frequency ?? (r.indicator === "gdp" ? "quarterly" : "monthly");

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`;
const STATUS_TONE: Record<string, string> = { completed: "text-ok", skipped: "text-warn", failed: "text-up" };

function RunDetails({ r, tour }: { r: Run; tour: boolean }) {
  const monthLabel = (iso: string) => periodLabel(iso, freqOf(r));
  const facts: [string, string][] = [
    ["Training window", r.training_start ? `${monthLabel(r.training_start)} – ${monthLabel(r.training_cutoff)}` : `up to ${monthLabel(r.training_cutoff)}`],
    ["Test window", r.evaluation_start && r.evaluation_end ? `${monthLabel(r.evaluation_start)} – ${monthLabel(r.evaluation_end)}` : "—"],
    ["Test origins", r.n_origins === null ? "—" : String(r.n_origins)],
    ["Suite", r.suite ?? "—"],
  ];
  const metrics = ["mae", "mase", "smape", "coverage_80", "coverage_95"].filter((k) => r.metrics[k] !== undefined);
  const repro: [string, string][] = [
    ["Data fingerprint", r.dataset_fingerprint ?? "Not recorded"],
    ["Origins fingerprint", r.origins_fingerprint ?? "—"],
    ["Experiment id", r.experiment_id ?? "—"],
    ["Seed · snapshot", `${r.random_seed ?? "—"} · ${r.snapshot_policy ?? "—"}`],
  ];
  return (
    <div className="grid gap-4 py-3 text-sm md:grid-cols-3">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        {metrics.length ? (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
            {metrics.map((k) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{METRIC_LABELS[k]}</dt>
                <dd className="figure">{fmtMetric(k, r.metrics[k])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-ink-muted">{r.error ? `Not scored: ${r.error}` : "No scores (future forecasts have no actuals yet)."}</p>
        )}
      </div>
      <div {...(tour ? { "data-tour": "fe-repro" } : {})} className="min-w-0 rounded border border-rule px-3 py-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Reproducibility <HelpTip id="data-fingerprint" />
        </p>
        <dl className="space-y-0.5 text-xs">
          {repro.map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-x-2">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="figure break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <Link href={`/forecasting/experiments/${r.id}?view=research`} className="mt-2 inline-block text-xs text-accent underline">
          Open run #{r.id} →
        </Link>
      </div>
    </div>
  );
}

/** Experiment history. Filters, sorting and the page number live in the URL, so a filtered view can be shared and
 *  Back/Forward work. Skipped and failed runs stay visible unless the user filters them out. */
export function ExperimentsView({ runs, total }: { runs: Run[]; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = parseView(params?.get("view"));
  const research = view === "research";
  const [open, setOpen] = useState<Set<number>>(new Set());

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of runs) m.set(r.model, r.model_name);
    return m;
  }, [runs]);
  const f = useMemo(() => parseExperimentFilters((k) => params?.get(k) ?? null, [...names.keys()]), [params, names]);
  const horizons = useMemo(() => [...new Set(runs.map((r) => r.horizon))].sort((a, b) => a - b), [runs]);
  const filtered = useMemo(() => applyExperimentFilters(runs, f), [runs, f]);
  const pg = paginate(filtered, f.page);
  const push = (patch: Partial<ExperimentFilters>, resetPage = true) => {
    const qs = withView(serializeExperimentFilters({ ...f, ...patch, page: resetPage ? 1 : (patch.page ?? f.page) }), view).toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if ("q" in patch || "minOrigins" in patch) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  };
  const hasFilters = serializeExperimentFilters(f).toString() !== "";
  const advancedActive = !!(f.kind || f.horizon || f.minOrigins);
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
      <select
        aria-label={label}
        className={selectClass}
        value={value ?? ""}
        onChange={(e) => push({ [key]: e.target.value === "" ? null : key === "horizon" ? Number(e.target.value) : e.target.value } as Partial<ExperimentFilters>)}
      >
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const cols = research ? 10 : 7;

  return (
    <>
      <SpotlightTour steps={EXPERIMENTS_STEPS} label="Experiments tour" />
      <section className="rounded-md border border-rule bg-surface">
        <div data-tour="fe-filters" className="space-y-3 border-b border-rule px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-ink-muted">Search</span>
              <input aria-label="Search runs" type="search" className={`${selectClass} w-48`} value={f.q} placeholder="Run #12 or ARIMA" onChange={(e) => push({ q: e.target.value })} />
            </label>
            {select("Indicator", f.indicator, "indicator", [["cpi", "CPI"], ["wpi", "WPI"], ["iip", "IIP"], ["gdp", "GDP"]])}
            {select("Model", f.model, "model", [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])))}
            {select("Status", f.status, "status", [["completed", "Completed"], ["skipped", "Skipped"], ["failed", "Failed"]])}
            <ForecastTourButton className={`ml-auto rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-bg ${focusRing}`}>Take a tour</ForecastTourButton>
          </div>
          <details open={research || advancedActive} className="text-sm">
            <summary className={`cursor-pointer text-ink-muted hover:text-ink ${focusRing}`}>More filters{advancedActive ? " (active)" : ""}</summary>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              {select("Run type", f.kind, "kind", [["backtest", "Backtest"], ["forecast", "Forecast"]])}
              {select("Horizon", f.horizon === null ? null : String(f.horizon), "horizon", horizons.map((h) => [String(h), f.indicator === "gdp" ? `${h} quarter${h > 1 ? "s" : ""}` : `${h} month${h > 1 ? "s" : ""}`]))}
              <label className="text-sm">
                <span className="mb-1 block text-ink-muted">Min. test origins</span>
                <input
                  aria-label="Minimum origins"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className={`${selectClass} w-24`}
                  value={f.minOrigins ?? ""}
                  onChange={(e) => push({ minOrigins: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                />
              </label>
            </div>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-muted" aria-live="polite">
              {filtered.length} of {runs.length} runs{total > runs.length ? ` (newest ${runs.length} of ${total} loaded)` : ""}. Skipped runs stay listed so every exclusion is explained.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => router.push(research ? `${pathname}?view=research` : pathname, { scroll: false })} disabled={!hasFilters} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-40 ${focusRing}`}>
                Reset filters
              </button>
              <button type="button" onClick={download} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
                Download CSV ({filtered.length})
              </button>
            </div>
          </div>
        </div>
        <div data-tour="fe-table" className="overflow-x-auto px-5 focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="Experiments table (scrollable)" tabIndex={0}>
          <table className={`w-full text-sm ${research ? "min-w-[52rem]" : "min-w-[36rem]"}`}>
            <caption className="sr-only">
              Stored forecasting experiments, page {pg.page} of {pg.pages}
            </caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs">
                <th scope="col" className="py-2 pr-4 font-semibold">Run</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Indicator</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Type</th>
                {research && th("n_origins", "Origins", true)}
                {research && th("mae", "MAE", true)}
                {research && th("mase", "MASE", true)}
                <th scope="col" className="py-2 pr-4 font-semibold">Status</th>
                {th("created_at", "Stored")}
                <th scope="col" className="py-2 text-right font-semibold">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pg.items.length === 0 && (
                <tr>
                  <td colSpan={cols} className="py-6 text-center text-ink-muted">
                    No runs match these filters. Use Reset filters to see all.
                  </td>
                </tr>
              )}
              {pg.items.map((r, i) => {
                const isOpen = open.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <tr className={`align-top ${isOpen ? "" : "border-b border-rule"}`}>
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        <Link href={`/forecasting/experiments/${r.id}${research ? "?view=research" : ""}`} className={`figure underline ${focusRing}`}>
                          #{r.id}
                        </Link>
                      </th>
                      <td className="py-2 pr-4 uppercase">{r.indicator ?? "—"}</td>
                      <td className="py-2 pr-4">{r.model_name}</td>
                      <td className="py-2 pr-4 text-ink-muted">
                        {r.kind === "backtest" ? "Backtest" : "Forecast"} · {r.horizon} {freqOf(r) === "quarterly" ? "qtr" : "mo"}
                      </td>
                      {research && <td className="figure py-2 pr-4 text-right">{r.n_origins ?? "—"}</td>}
                      {research && <td className="figure py-2 pr-4 text-right">{fmtMetric("mae", r.metrics.mae)}</td>}
                      {research && <td className="figure py-2 pr-4 text-right">{fmtMetric("mase", r.metrics.mase)}</td>}
                      <td className={`py-2 pr-4 ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</td>
                      <td className="figure py-2 pr-4 text-ink-muted">{r.created_at.slice(0, 10)}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={`run-details-${r.id}`}
                          aria-label={`${isOpen ? "Hide" : "Show"} details for run ${r.id}`}
                          {...(i === 0 ? { "data-tour": "fe-details" } : {})}
                          onClick={() => toggle(r.id)}
                          className={`rounded border border-rule px-2 py-0.5 text-xs hover:border-accent ${focusRing}`}
                        >
                          {isOpen ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={`run-details-${r.id}`} className="border-b border-rule bg-bg/50">
                        <td colSpan={cols} className="px-2">
                          <RunDetails r={r} tour={i === 0} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {pg.pages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-rule px-5 py-3 text-sm">
            <button type="button" disabled={pg.page <= 1} onClick={() => push({ page: pg.page - 1 }, false)} className={`rounded border border-rule px-3 py-1.5 hover:bg-bg disabled:opacity-40 ${focusRing}`}>
              Previous
            </button>
            <span>
              Page {pg.page} of {pg.pages}
            </span>
            <button type="button" disabled={pg.page >= pg.pages} onClick={() => push({ page: pg.page + 1 }, false)} className={`rounded border border-rule px-3 py-1.5 hover:bg-bg disabled:opacity-40 ${focusRing}`}>
              Next
            </button>
          </nav>
        )}
      </section>
    </>
  );
}
