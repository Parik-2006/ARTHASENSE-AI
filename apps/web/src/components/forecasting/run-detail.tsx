import { Panel } from "@/components/ui/primitives";
import { type ForecastRow, fmt, fmtMetric, METRIC_LABELS, periodLabel, periodsText, type RunDetail } from "@/lib/forecasting";

export function RunDetailView({ run, rows, totalRows }: { run: RunDetail; rows: ForecastRow[]; totalRows: number }) {
  // Quarterly runs (GDP) are labelled in fiscal quarters; older APIs omit `frequency` (monthly).
  const freq = run.frequency ?? (run.indicator === "gdp" ? "quarterly" : "monthly");
  const monthLabel = (iso: string, long = false) => periodLabel(iso, freq, long);
  const facts: [string, string][] = [
    ["Indicator", run.indicator?.toUpperCase() ?? "—"],
    ["Model", `${run.model_name} (${run.model})`],
    ["Type", run.kind === "backtest" ? "Historical backtest" : "Genuine future forecast"],
    ["Status", run.status],
    ["Model configuration", run.model_label ?? "—"],
    ["Horizon", periodsText(run.horizon, freq)],
    ["Suite", run.suite ?? "—"],
    ["Forecast origins", String(run.n_origins ?? "—")],
    [
      "Training range",
      run.training_start ? `${monthLabel(run.training_start, true)} to ${monthLabel(run.training_cutoff, true)}` : "—",
    ],
    [
      "Evaluation targets",
      run.evaluation_start
        ? `${monthLabel(run.evaluation_start, true)} to ${monthLabel(run.evaluation_end ?? run.evaluation_start, true)}`
        : "—",
    ],
    ["Snapshot policy", run.snapshot_policy ?? "—"],
    ["Dataset fingerprint", run.dataset_fingerprint ?? "—"],
    ["Origins fingerprint", run.origins_fingerprint ?? "—"],
    ["Experiment id", run.experiment_id ?? "—"],
    ["Random seed", String(run.random_seed ?? "—")],
    ["Runtime", run.runtime_seconds === null ? "—" : `${run.runtime_seconds.toFixed(2)} s (whole model, all horizons)`],
    ["Stored", run.created_at],
  ];
  return (
    <div className="space-y-6">
      {run.error && (
        <p className="rounded-md border border-warn px-4 py-3 text-sm text-warn" role="note">
          {run.error}
        </p>
      )}
      <Panel title="Provenance">
        <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="figure break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      {Object.keys(run.metrics).length > 0 && (
        <Panel title="Scores" footnote={run.rankable ? undefined : "Fewer than 12 origins: indicative only."}>
          <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[14rem_1fr]">
            {Object.entries(run.metrics).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{METRIC_LABELS[k] ?? k}</dt>
                <dd className="figure">
                  {fmtMetric(k, v)}{" "}
                  <span className="text-xs text-ink-muted">
                    n = {run.score_samples[k] ?? "—"}
                    {run.score_notes[k] ? ` · ${run.score_notes[k]}` : ""}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
      <Panel title="Configuration">
        <pre className="figure overflow-x-auto text-xs focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="Run configuration (scrollable)" tabIndex={0}>{JSON.stringify(run.configuration, null, 2)}</pre>
      </Panel>
      {rows.length > 0 && (
        <Panel
          title={run.kind === "backtest" ? "Backtest predictions" : "Forecast"}
          footnote={`${rows.length} of ${totalRows} rows shown. ${run.disclaimer}`}
        >
          <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="Stored predictions (scrollable)" tabIndex={0}>
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Stored predictions for this run</caption>
              <thead>
                <tr className="border-b border-rule text-left text-xs">
                  <th scope="col" className="py-2 pr-4 font-semibold">Origin</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Target</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Forecast</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Actual</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Error</th>
                  <th scope="col" className="py-2 text-right font-semibold">80% interval</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.target_date} className="border-b border-rule last:border-b-0">
                    <td className="py-1.5 pr-4 text-ink-muted">{r.origin_date ? monthLabel(r.origin_date) : "—"}</td>
                    <th scope="row" className="py-1.5 pr-4 text-left font-medium">
                      {monthLabel(r.target_date)}
                    </th>
                    <td className="figure py-1.5 pr-4 text-right">{fmt(r.forecast)}</td>
                    <td className="figure py-1.5 pr-4 text-right">{fmt(r.actual)}</td>
                    <td className="figure py-1.5 pr-4 text-right">{r.actual === null ? "—" : fmt(r.forecast - r.actual)}</td>
                    <td className="figure py-1.5 text-right">
                      {r.lower_80 === null ? "—" : `${fmt(r.lower_80)} to ${fmt(r.upper_80)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
