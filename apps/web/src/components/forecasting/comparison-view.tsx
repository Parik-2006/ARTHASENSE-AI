"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { ReliabilityMeter } from "@/components/forecasting/reliability-meter";
import { Segmented } from "@/components/forecasting/segmented";
import { ForecastTourButton, SpotlightTour } from "@/components/forecasting/spotlight-tour";
import { parseView, withView } from "@/components/forecasting/view-mode";
import { Panel } from "@/components/ui/primitives";
import { BASELINE, displayOrder, monthsNeeded, primaryGroup, reliabilityOnGroup } from "@/lib/forecast-evidence";
import { COMPARISON_STEPS } from "@/lib/forecast-tours";
import {
  type Comparison,
  type ComparisonGroup,
  comparisonToCsv,
  CORE_MODELS,
  fmtMetric,
  FORECAST_IDS,
  FORECAST_NAMES,
  type ForecastId,
  FREQUENCY,
  HORIZONS_BY_FREQ,
  isForecastId,
  loadErrorText,
  METRIC_LABELS,
  type ModelStatus,
  periodAdj,
  periodLabel,
  periodsText,
  type SeriesInfo,
  STATUS_TEXT,
} from "@/lib/forecasting";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`;
const TABLE_METRICS = ["mae", "rmse", "mase", "smape", "coverage_80", "coverage_95"] as const;
const BAR_METRICS = ["mae", "rmse", "mase", "smape"] as const;
const DEFAULT_HORIZON = { monthly: 6, quarterly: 4 } as const;

export type ComparisonMap = Record<string, Comparison | null>; // key `${indicator}-${horizon}`
/** The model (and horizon) the Forecasts pages use by default, from the same rule (chooseView). */
export type DefaultMap = Partial<Record<ForecastId, { model: string; horizon: number } | null>>;
export type StatusMap = Partial<Record<ForecastId, ModelStatus[]>>;

/** Horizontal error bars on one scale; the naive baseline is grey and marked with a reference line. */
export function ErrorBars({ group, metric }: { group: ComparisonGroup; metric: string }) {
  const rows = displayOrder(group.models.filter((m) => m.metrics[metric] !== undefined), group.rankable, metric);
  if (!rows.length) return <p className="text-sm text-ink-muted">No model has this metric on this test set.</p>;
  const max = Math.max(...rows.map((m) => m.metrics[metric])) * 1.08 || 1;
  const base = group.models.find((m) => m.model === BASELINE)?.metrics[metric];
  return (
    <div className="relative">
      <ul className="space-y-2.5" aria-label={`${METRIC_LABELS[metric]} by model, lower is better`}>
        {rows.map((m) => {
          const isBase = m.model === BASELINE;
          return (
            <li key={m.model} className="grid grid-cols-[minmax(5.5rem,9rem)_1fr_4rem] items-center gap-3 text-sm">
              <span className="truncate" title={m.model_name}>
                {m.model_name}
              </span>
              <span className="relative h-4 rounded-sm bg-bg" aria-hidden>
                <span className={`absolute inset-y-0 left-0 rounded-r-[4px] ${isBase ? "bg-ink-muted" : "bg-accent"}`} style={{ width: `${Math.max(1.5, (m.metrics[metric] / max) * 100)}%` }} />
                {base !== undefined && <span className="absolute -inset-y-1 w-px border-l border-dashed border-ink" style={{ left: `${(base / max) * 100}%` }} />}
              </span>
              <span className="figure text-right">{fmtMetric(metric, m.metrics[metric])}</span>
            </li>
          );
        })}
      </ul>
      {base !== undefined && (
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
          <span aria-hidden className="inline-block h-3 border-l border-dashed border-ink" /> Naive baseline level. Bars left of this line had a smaller error than the baseline.
        </p>
      )}
    </div>
  );
}

export function ComparisonView({
  data,
  series = [],
  apiError = "",
  defaults = {},
  status = {},
}: {
  data: ComparisonMap;
  series?: SeriesInfo[];
  apiError?: string;
  defaults?: DefaultMap;
  status?: StatusMap;
}) {
  // Indicator, horizon and test set live in the URL (?indicator=&horizon=&set=&view=) so the view can be shared.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = parseView(params?.get("view"));
  const research = view === "research";
  const indParam = params?.get("indicator") ?? "";
  const indicator: ForecastId = isForecastId(indParam) ? indParam : "wpi";
  const freq = FREQUENCY[indicator];
  const horizons = HORIZONS_BY_FREQ[freq];
  const pl = (iso: string) => periodLabel(iso, freq);
  const hParam = Number(params?.get("horizon"));
  const horizon: number = horizons.includes(hParam) ? hParam : DEFAULT_HORIZON[freq];
  const cmp = data[`${indicator}-${horizon}`] ?? null;
  const ref = primaryGroup(cmp);
  const setParam = params?.get("set");
  const groupIdx =
    setParam !== null && setParam !== undefined && /^\d+$/.test(setParam)
      ? Math.min(Number(setParam), Math.max(0, (cmp?.groups.length ?? 1) - 1))
      : Math.max(0, cmp?.groups.findIndex((g) => g.group_id === ref?.group_id) ?? 0);
  const group = cmp?.groups[groupIdx];
  const setView = (patch: { indicator?: string; horizon?: number; set?: number | null }) => {
    const p = new URLSearchParams();
    p.set("indicator", patch.indicator ?? indicator);
    p.set("horizon", String(patch.horizon ?? horizon));
    if (patch.set !== undefined && patch.set !== null) p.set("set", String(patch.set));
    router.push(`${pathname}?${withView(p, view).toString()}`, { scroll: false });
  };
  const [barMetric, setBarMetric] = useState<string>("mae");
  const info = series.find((s) => s.indicator === indicator);
  const best = group?.rankable ? group.best.mae : undefined;
  const def = defaults[indicator];
  const defaultModel = def && def.horizon === horizon ? def.model : null;
  const st = status[indicator] ?? [];
  const missing = CORE_MODELS.filter((m) => !group?.models.some((x) => x.model === m)).map((m) => ({
    model: m,
    s: st.find((x) => x.model === m),
    excluded: cmp?.excluded.find((e) => e.model === m)?.reason,
  }));

  const download = () => {
    if (!group) return;
    const url = URL.createObjectURL(new Blob([comparisonToCsv(group)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `comparison-${indicator}-h${horizon}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SpotlightTour steps={COMPARISON_STEPS} label="Model comparison tour" />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="text-sm" data-tour="fc-indicator">
          <span id="fc-ind-label" className="mb-1 block text-ink-muted">Indicator</span>
          <Segmented labelledBy="fc-ind-label" value={indicator} onChange={(i) => setView({ indicator: i, set: null })} options={FORECAST_IDS.map((i) => ({ value: i, label: i.toUpperCase(), title: FORECAST_NAMES[i] }))} />
        </div>
        <div className="text-sm" data-tour="fc-horizon">
          <span id="fc-h-label" className="mb-1 block text-ink-muted">
            Forecast horizon <HelpTip id="forecast-horizon" />
          </span>
          <Segmented labelledBy="fc-h-label" value={horizon} onChange={(h) => setView({ horizon: h, set: null })} options={horizons.map((h) => ({ value: h, label: freq === "quarterly" ? `${h} qtr` : `${h} mo` }))} />
        </div>
        {cmp && cmp.groups.length > 1 && (
          <label className="min-w-0 max-w-full text-sm">
            <span className="mb-1 block text-ink-muted">Test set</span>
            <select aria-label="Test set" className={`${selectClass} w-full max-w-full truncate sm:w-auto`} value={groupIdx} onChange={(e) => setView({ set: Number(e.target.value) })}>
              {cmp.groups.map((g, i) => (
                <option key={g.group_id} value={i}>
                  {g.n_origins} {freq === "quarterly" ? "quarters" : "months"} · {g.models.length} models{g.evaluation_start ? ` · ${pl(g.evaluation_start)}–${pl(g.evaluation_end ?? g.evaluation_start)}` : ""}
                  {g.group_id === ref?.group_id ? " (largest)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <ForecastTourButton className={`ml-auto rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-surface ${focusRing}`}>Take a tour</ForecastTourButton>
      </div>

      {!cmp ? (
        <Panel title="Comparison">
          <p role="alert" className="text-sm text-up">{loadErrorText("the comparison", apiError)}</p>
        </Panel>
      ) : !group ? (
        <Panel title="Nothing to compare yet">
          <p className="text-sm text-ink-muted">
            No model has been tested on {FORECAST_NAMES[indicator]} at a {periodAdj(horizon, freq)} horizon.
            {info && info.evaluable_horizons.length === 0 && freq === "monthly"
              ? ` The current series has ${info.n_observations} monthly observations; a fair test at this horizon needs at least ${monthsNeeded(horizon)}.`
              : ""}
          </p>
          <Missing rows={missing} />
          {research && <Excluded cmp={cmp} />}
        </Panel>
      ) : (
        <>
          <section className="rounded-md border border-rule bg-surface" aria-labelledby="fc-title">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3">
              <h2 id="fc-title" className="text-sm font-semibold">
                {indicator.toUpperCase()} · {periodAdj(horizon, freq)}-ahead accuracy
              </h2>
              <p className="text-xs text-ink-muted">
                {group.n_origins} test {freq === "quarterly" ? "quarters" : "months"}
                {group.evaluation_start ? `, ${pl(group.evaluation_start)} to ${pl(group.evaluation_end ?? group.evaluation_start)}` : ""} · same periods for every model
              </p>
            </div>
            <div className="overflow-x-auto px-5 py-3 focus-visible:outline-2 focus-visible:outline-accent" data-tour="fc-table" role="region" aria-label="Accuracy table (scrollable)" tabIndex={0}>
              <table className="w-full min-w-[46rem] text-sm">
                <caption className="sr-only">Backtest accuracy by model on identical forecast origins</caption>
                <thead>
                  <tr className="border-b border-rule text-left text-xs">
                    <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">
                      MAE <HelpTip id="mae" />
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">RMSE</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">sMAPE</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">Tests</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">vs Naive</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">
                      Inside 80% <HelpTip id="coverage" />
                    </th>
                    <th scope="col" className="py-2 font-semibold">Track record</th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrder(group.models, group.rankable).map((m) => {
                      const r = reliabilityOnGroup(group, m.model);
                      return (
                        <tr key={m.model} className={`border-b border-rule last:border-b-0 ${m.model === BASELINE ? "bg-bg/60" : ""}`}>
                          <th scope="row" className="py-2 pr-4 text-left font-medium">
                            {m.model_name}
                            {m.model === BASELINE && <span className="ml-2 rounded border border-rule px-1.5 text-[10px] uppercase tracking-wide text-ink-muted">baseline</span>}
                            {best === m.model && <span className="ml-2 rounded border border-ok px-1.5 text-[10px] uppercase tracking-wide text-ok">lowest error</span>}
                            {defaultModel === m.model && (
                              <span data-tour="fc-default" data-testid="default-badge" className="ml-2 rounded border border-accent bg-accent px-1.5 text-[10px] uppercase tracking-wide text-accent-ink">
                                selected default
                              </span>
                            )}
                          </th>
                          <td className="figure py-2 pr-4 text-right">{fmtMetric("mae", m.metrics.mae)}</td>
                          <td className="figure py-2 pr-4 text-right">{fmtMetric("rmse", m.metrics.rmse)}</td>
                          <td className="figure py-2 pr-4 text-right">{m.metrics.smape === undefined ? "—" : `${m.metrics.smape.toFixed(2)}%`}</td>
                          <td className="figure py-2 pr-4 text-right">{m.n_origins}</td>
                          <td className="figure py-2 pr-4 text-right">
                            {m.vs_baseline_mae_pct === null ? "—" : `${m.vs_baseline_mae_pct > 0 ? "+" : ""}${m.vs_baseline_mae_pct.toFixed(1)}%`}
                          </td>
                          <td className="figure py-2 pr-4 text-right">{fmtMetric("coverage_80", m.metrics.coverage_80)}</td>
                          <td className="py-2">{r ? <ReliabilityMeter level={r.level} /> : "—"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 border-t border-rule px-5 py-3 text-xs text-ink-muted" data-tour="fc-baseline">
              <p>
                <span className="font-medium text-ink">Lower error is generally better.</span> The naive baseline simply repeats the last official value; a model is useful only if it
                beats it. A negative &quot;vs baseline&quot; means a smaller error than the baseline.
              </p>
              <p>
                {group.rankable
                  ? "“Lowest error” marks the smallest average error on these months. Differences are not tested for statistical significance."
                  : `No model is marked as best: ${group.n_origins < 12 ? `only ${group.n_origins} test months (fewer than 12)` : "too few models"} is not enough to rank fairly, so models are listed baseline first, then alphabetically.`}{" "}
                “—” means not available, never zero.
              </p>
              {defaultModel === null && def && (
                <p>The selected default for {indicator.toUpperCase()} is {def.model} at {periodsText(def.horizon, freq)}; switch to that horizon to see it marked.</p>
              )}
              {group.warnings
                .filter((w) => !/not tested for statistical significance/.test(w))
                .map((w) => (
                  <p key={w} className="text-warn">
                    {w}
                  </p>
                ))}
            </div>
          </section>

          {missing.length > 0 && (
            <section className="rounded-md border border-rule bg-surface px-5 py-3" aria-label="Models not in this comparison">
              <Missing rows={missing} />
            </section>
          )}

          <section className="rounded-md border border-rule bg-surface" aria-labelledby="fc-chart-title" data-tour="fc-chart">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3">
              <h2 id="fc-chart-title" className="text-sm font-semibold">
                Error by model <span className="font-normal text-ink-muted">(lower is better)</span>
              </h2>
              {research && (
                <label className="text-xs">
                  <span className="mr-2 text-ink-muted">Metric</span>
                  <select className={selectClass} value={barMetric} onChange={(e) => setBarMetric(e.target.value)}>
                    {BAR_METRICS.map((k) => (
                      <option key={k} value={k}>
                        {METRIC_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="px-5 py-4">
              <ErrorBars group={group} metric={research ? barMetric : "mae"} />
            </div>
          </section>

          {research && (
            <div className="space-y-6" data-testid="research-view">
              <Panel title="All metrics on this test set" footnote="MASE is scaled by one-month changes in the training data, so longer horizons naturally score higher. Coverage should be near its nominal level; a narrower interval is not a better one.">
                <div className="-mt-1 mb-3 flex justify-end">
                  <button type="button" onClick={download} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
                    Download CSV
                  </button>
                </div>
                <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="All metrics table (scrollable)" tabIndex={0}>
                  <table className="w-full min-w-[44rem] text-sm">
                    <caption className="sr-only">All backtest metrics by model on identical forecast origins</caption>
                    <thead>
                      <tr className="border-b border-rule text-left text-xs">
                        <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
                        {TABLE_METRICS.map((k) => (
                          <th key={k} scope="col" className="py-2 pr-4 text-right font-semibold">
                            {METRIC_LABELS[k]}
                          </th>
                        ))}
                        <th scope="col" className="py-2 pr-4 text-right font-semibold">Origins</th>
                        <th scope="col" className="py-2 text-right font-semibold">Run</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.models.map((m) => (
                        <tr key={m.model} className="border-b border-rule last:border-b-0">
                          <th scope="row" className="py-2 pr-4 text-left font-medium">
                            {m.model_name}
                          </th>
                          {TABLE_METRICS.map((k) => (
                            <td key={k} className="figure py-2 pr-4 text-right">
                              {fmtMetric(k, m.metrics[k])}
                            </td>
                          ))}
                          <td className="figure py-2 pr-4 text-right">{m.n_origins}</td>
                          <td className="figure py-2 text-right">
                            <Link href={`/forecasting/experiments/${m.run_id}?view=research`} className="text-accent underline">
                              #{m.run_id}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="Models not compared">
                <Excluded cmp={cmp} />
                <p className="mt-2 text-xs text-ink-muted">{cmp.note}</p>
              </Panel>
            </div>
          )}
        </>
      )}
      <p className="text-sm">
        <Link href={`/forecasting/${indicator}${research ? "?view=research" : ""}`} className="text-accent underline">
          {indicator.toUpperCase()} forecast →
        </Link>
        <span className="mx-2 text-ink-muted">·</span>
        <Link href={`/forecasting/experiments?indicator=${indicator}&horizon=${horizon}${research ? "&view=research" : ""}`} className="text-accent underline">
          Experiments →
        </Link>
      </p>
    </div>
  );
}

/** The eight-model contract: every algorithm missing from this test set is listed with its status and reason. */
function Missing({ rows }: { rows: { model: string; s?: ModelStatus; excluded?: string }[] }) {
  if (!rows.length) return null;
  return (
    <div data-testid="missing-models">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Not in this comparison</p>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map(({ model, s, excluded }) => (
          <li key={model}>
            <span className="font-medium">{s?.model_name ?? model}</span>{" "}
            <span className="text-ink-muted">
              · {s ? (s.status === "available" ? "not evaluated at this horizon" : STATUS_TEXT[s.status]) : "status unknown"}
              {excluded ? `: ${excluded}` : s?.reason && s.status !== "available" ? `: ${s.reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Excluded({ cmp }: { cmp: Comparison }) {
  if (cmp.excluded.length === 0) return <p className="text-sm text-ink-muted">Every stored model was compared.</p>;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {cmp.excluded.map((e) => (
        <li key={e.model}>
          <span className="font-medium">{e.model_name}</span> <span className="text-ink-muted">excluded: {e.reason}</span>
        </li>
      ))}
    </ul>
  );
}
