"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { OutlookChart } from "@/components/forecasting/outlook-chart";
import { Segmented } from "@/components/forecasting/segmented";
import { ReliabilityMeter } from "@/components/forecasting/reliability-meter";
import { ForecastTourButton, SpotlightTour } from "@/components/forecasting/spotlight-tour";
import { useViewMode, withView } from "@/components/forecasting/view-mode";
import { SourceAttribution } from "@/components/source/source-attribution";
import { Panel } from "@/components/ui/primitives";
import { inWindow, type RangeKey, resolveWindow, withDerived } from "@/lib/analysis";
import { chooseView, type Evidence, forecastViews, indicatorHref, plainReliability } from "@/lib/forecast-evidence";
import { FORECAST_EXPLORER_STEPS } from "@/lib/forecast-tours";
import {
  changeFrom,
  FLAT_THRESHOLD_PCT,
  type ForecastFilters,
  forecastsToCsvV2,
  interpretForecast,
  parseForecastFilters,
  type Reliability,
  serializeForecastFilters,
} from "@/lib/forecast-v2";
import { forecastMeta, forecastsToCsvV4, impliedYoy } from "@/lib/forecast-meta";
import {
  type Comparison,
  CORE_MODELS,
  fmt,
  fmtMetric,
  type ForecastId,
  type ForecastRow,
  methodLabel,
  type ModelInfo,
  modelDetail,
  type ModelStatus,
  monthLabel,
  periodAdj,
  periodsText,
  type Run,
  STATUS_TEXT,
  type TrainingHistory,
  trainingLine,
} from "@/lib/forecasting";
import type { Observation } from "@/lib/indicator";
import { seriesIds, type SourceInfo } from "@/lib/source";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2.5 py-1.5 text-sm ${focusRing}`;

export interface StoredForecast {
  model: string;
  run: Run;
  items: ForecastRow[]; // steps 1..run.horizon from the stored genuine-future forecast
}

const TONE: Record<Reliability["level"], string> = { supported: "border-ok", limited: "border-target", insufficient: "border-rule", concerning: "border-up" };

/** Full rule-based reliability with every reason (Research View). */
export function ReliabilityBanner({ r, className = "" }: { r: Reliability; className?: string }) {
  return (
    <div role="note" data-testid="reliability" data-level={r.level} className={`rounded-md border bg-surface px-4 py-3 text-sm ${TONE[r.level]} ${className}`}>
      <p className="font-medium">
        Reliability: {r.label} <HelpTip id="reliability" />
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
        {r.reasons.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-ink-muted">A rule-based summary of backtest evidence, not a probability. Past accuracy does not guarantee future accuracy.</p>
    </div>
  );
}

const HISTORY_RANGES: RangeKey[] = ["1Y", "2Y", "3Y", "5Y", "All"];
const order = (m: string) => {
  const i = (CORE_MODELS as readonly string[]).indexOf(m);
  return i < 0 ? 99 : i;
};

/** Compact, readable model parameters from the run's stored configuration (Research View). */
export function configText(c: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(c)) {
    if (k === "selected_per_origin") continue;
    parts.push(`${k.replace(/_/g, " ")}: ${Array.isArray(v) ? `(${v.join(",")})` : String(v)}`);
  }
  const sel = c.selected_per_origin;
  if (Array.isArray(sel) && sel.length > 1) parts.push(`configurations chosen across backtest origins: ${sel.join("; ")}`);
  return parts.join(" · ");
}
const pctText = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** Plain-English "What this means": three short sentences from stored numbers only. */
export function plainMeaning(o: {
  short: string;
  modelName: string;
  latest: { period: string; value: number } | null;
  rows: ForecastRow[];
  evidence: Evidence;
  /** Quarterly GDP: level formatting, quarter labels and the year-on-year growth implied by the forecast level. */
  value?: (v: number) => string;
  period?: (iso: string, long?: boolean) => string;
  what?: string;
  yoy?: number | null;
}): string[] {
  const last = o.rows[o.rows.length - 1];
  if (!last) return [];
  const v = o.value ?? ((x: number) => fmt(x));
  const pl = o.period ?? ((iso: string, long?: boolean) => monthLabel(iso, long));
  const what = o.what ?? `the ${o.short} index`;
  const out: string[] = [];
  const c = o.latest ? changeFrom(o.latest.value, last.forecast) : null;
  const when = pl(last.target_date, true);
  if (o.yoy !== undefined) {
    out.push(
      `${o.modelName} estimates ${what} at ${v(last.forecast)} in ${when}${o.yoy === null ? "" : `, ${o.yoy >= 0 ? "up" : "down"} ${Math.abs(o.yoy).toFixed(1)}% on the same quarter a year earlier (calculated by ArthaSense from official and forecast levels)`}.`,
    );
  } else if (o.latest && c && c.pct !== null) {
    const rel =
      Math.abs(c.pct) <= FLAT_THRESHOLD_PCT
        ? "roughly level with"
        : `about ${Math.abs(c.pct).toFixed(1)}% ${c.pct > 0 ? "above" : "below"}`;
    out.push(`${o.modelName} estimates ${what} at ${v(last.forecast)} in ${when}, ${rel} the official ${v(o.latest.value)} for ${pl(o.latest.period, true)}.`);
  } else out.push(`${o.modelName} estimates ${what} at ${v(last.forecast)} in ${when}.`);
  if (last.lower_80 !== null && last.upper_80 !== null) {
    const cov = o.evidence.set?.model.metrics.coverage_80;
    out.push(
      `Its 80% range for ${when} is ${v(last.lower_80)} to ${v(last.upper_80)}.${cov !== undefined ? ` In past tests, ${Math.round(cov * 100)}% of actual values fell inside its 80% ranges.` : ""} Values outside the range are possible.`,
    );
  } else out.push("Uncertainty interval unavailable: this model has no validated range here, so the spread of possible outcomes is not quantified.");
  out.push(plainReliability(o.evidence));
  return out;
}

/** Model, horizon and history window over STORED forecasts. State lives in the URL
 *  (?range=&from=&to=&model=&horizon=&view=). Nothing is generated in the browser. */
export function ForecastExplorer({
  indicator,
  shortName,
  indexName,
  axisLabel,
  baseYear,
  observations,
  source,
  stored,
  runs,
  models,
  comparisons,
  trainingHistory = null,
  status = [],
}: {
  indicator: ForecastId;
  shortName: string;
  indexName: string;
  axisLabel: string;
  baseYear: string;
  observations: Observation[];
  source: SourceInfo;
  stored: StoredForecast[];
  runs: Run[];
  models: ModelInfo[];
  comparisons: Record<number, Comparison | null>;
  /** Official linked training history (CPI, WPI, IIP); null when models train on the current series alone. */
  trainingHistory?: TrainingHistory | null;
  /** V4: status of each of the eight algorithms, so unavailable ones are explained rather than hidden. */
  status?: ModelStatus[];
}) {
  const M = useMemo(() => forecastMeta(indicator), [indicator]);
  const quarterly = M.frequency === "quarterly";
  const pl = M.period;
  const fv = (v: number | null | undefined) => (quarterly ? M.value(v) : fmt(v));
  /** KPI figure: GDP shows "₹81.36" with "lakh cr" in small type so the figure never wraps. */
  const big = (v: number) =>
    quarterly ? (
      <span className="whitespace-nowrap">
        ₹{(v / 100_000).toFixed(2)}
        <span className="ml-1 whitespace-nowrap text-sm font-normal text-ink-muted">lakh cr</span>
      </span>
    ) : (
      fmt(v)
    );
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = useViewMode();
  const research = view === "research";

  const obs = useMemo(() => observations.filter((o) => o.index !== null), [observations]);
  const derived = useMemo(() => withDerived(obs), [obs]);
  const latest = obs.length ? { period: obs[obs.length - 1].period, value: obs[obs.length - 1].index as number } : null;
  const views = useMemo(() => forecastViews(stored, M.horizons), [stored, M]);
  const avail = useMemo(() => {
    const byModel: Record<string, number[]> = {};
    for (const v of views) byModel[v.model] = [...(byModel[v.model] ?? []), v.horizon].sort((a, b) => a - b);
    return { models: Object.keys(byModel), horizons: [...new Set(views.map((v) => v.horizon))].sort((a, b) => a - b), byModel };
  }, [views]);
  const { filters, notices } = useMemo(() => parseForecastFilters((k) => params?.get(k) ?? null, avail), [params, avail]);
  const chosen = useMemo(
    () => chooseView(views, comparisons, latest?.period ?? null, { model: filters.model, horizon: filters.horizon }, M.preferH, M.frequency),
    [views, comparisons, latest?.period, filters.model, filters.horizon, M],
  );

  const push = (patch: Partial<ForecastFilters>) => {
    const qs = withView(serializeForecastFilters({ ...filters, ...patch }), view).toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;

  if (!chosen) {
    return (
      <Panel title="Forecast">
        <p className="text-sm text-ink-muted">No stored forecast exists for this indicator, so nothing is displayed. Forecasts appear only after a model has been run and tested.</p>
      </Panel>
    );
  }

  const { view: cur, evidence: ev } = chosen;
  const rows = cur.rows;
  const horizon = cur.horizon;
  const modelName = nameOf(cur.model);
  const last = rows[rows.length - 1];
  const change = latest ? changeFrom(latest.value, last.forecast) : null;
  const origin = rows[0]?.origin_date ?? null;
  const stale = ev.flags.stale;
  const hasInterval = rows.some((r) => r.lower_80 !== null);
  const win = resolveWindow(obs, filters.range, filters.custom);
  const history = inWindow(derived, win).map((o) => ({ period: o.period, index: o.index as number }));
  const historyHref = indicatorHref(indicator, filters.range);
  const detail = modelDetail(modelName, cur.run);
  const yoy = quarterly ? impliedYoy(last.target_date, last.forecast, obs) : undefined;
  const meaning = plainMeaning({ short: shortName, modelName, latest, rows, evidence: ev, ...(quarterly ? { value: (v: number) => M.value(v), period: pl, what: "real GDP", yoy } : {}) });
  const unavailable = CORE_MODELS.map((id) => status.find((x) => x.model === id)).filter((x): x is ModelStatus => !!x && x.status !== "available" && !avail.models.includes(x.model));
  const bt = ev.set ? runs.find((r) => r.id === ev.set!.model.run_id) : undefined;
  const officialLabel = source.short;

  const download = () => {
    const meta = {
      indicator: shortName, baseYear, seriesId: quarterly ? source.seriesIds[0] : seriesIds(indicator as "cpi" | "wpi" | "iip", baseYear)[0], publisher: source.publisher,
      modelId: cur.model, modelName, run: cur.run, latest, reliability: ev.label,
    }; // prettier-ignore
    const csv = quarterly ? forecastsToCsvV4(rows, { ...meta, unit: M.unit(baseYear), history: obs }) : forecastsToCsvV2(rows, meta);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `forecast-${indicator}-${cur.model}-h${horizon}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SpotlightTour steps={FORECAST_EXPLORER_STEPS} label={`${shortName} forecast tour`} />

      {/* 1. KPI strip */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule lg:grid-cols-4" data-testid="kpis">
        <div className="bg-surface p-4" data-tour="fx-official">
          <dt className="text-sm text-ink-muted">Latest official</dt>
          <dd className="figure mt-1 text-2xl font-medium tracking-tight">{latest ? big(latest.value) : "—"}</dd>
          <dd className="mt-1 text-xs text-ink-muted">{latest ? `${pl(latest.period, true)} · ${quarterly ? M.unit(baseYear) : `base ${baseYear} = 100`}` : "No data"}</dd>
        </div>
        <div className="bg-surface p-4">
          <dt className="text-sm text-ink-muted">Forecast · {pl(last.target_date, true)}</dt>
          <dd className="figure mt-1 text-2xl font-medium tracking-tight text-target">{big(last.forecast)}</dd>
          <dd className="mt-1 text-xs text-ink-muted" data-testid="kpi-model">
            Model: <span className="font-medium text-ink">{modelName}</span>
            {detail && research ? <span className="figure"> · {detail}</span> : null}
          </dd>
        </div>
        <div className="bg-surface p-4">
          <dt className="text-sm text-ink-muted">{quarterly ? "Implied year-on-year growth" : "Expected change"}</dt>
          {quarterly ? (
            <>
              <dd className="figure mt-1 text-2xl font-medium tracking-tight">{yoy == null ? "—" : pctText(yoy)}</dd>
              <dd className="mt-1 text-xs text-ink-muted">{yoy == null ? "Not available" : "Forecast level vs the same quarter a year earlier · calculated by ArthaSense"}</dd>
            </>
          ) : (
            <>
              <dd className="figure mt-1 text-2xl font-medium tracking-tight">{change?.pct != null ? pctText(change.pct) : "—"}</dd>
              <dd className="mt-1 text-xs text-ink-muted">{change ? `${change.abs > 0 ? "+" : ""}${change.abs.toFixed(2)} points vs ${latest ? monthLabel(latest.period) : "latest"} · model-derived` : "Not available"}</dd>
            </>
          )}
        </div>
        <div className="bg-surface p-4" data-tour="fx-reliability">
          <dt className="text-sm text-ink-muted">
            Reliability <HelpTip id="reliability" />
          </dt>
          <dd className="mt-1.5">
            <ReliabilityMeter level={ev.level} />
          </dd>
          <dd className="mt-1 text-xs text-ink-muted">{plainReliability(ev)}</dd>
        </div>
      </dl>

      {/* 2. Forecast controls (model + horizon), separate from the history window on the chart */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="text-sm" data-tour="fx-model">
          <span className="mb-1 block text-ink-muted">Model</span>
          <select
            aria-label="Model"
            className={selectClass}
            value={cur.model}
            onChange={(e) => {
              const hs = avail.byModel[e.target.value] ?? [];
              push({ model: e.target.value, horizon: hs.includes(horizon) ? horizon : (hs[hs.length - 1] ?? null) });
            }}
          >
            {[...avail.models].sort((a, b) => order(a) - order(b)).map((m) => (
              <option key={m} value={m}>
                {nameOf(m)}
                {m === "naive" ? " (baseline)" : ""}
              </option>
            ))}
            {unavailable.map((u) => (
              <option key={u.model} value={u.model} disabled>
                {u.model_name} — {STATUS_TEXT[u.status].toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm" data-tour="fx-horizon">
          <span id="fx-horizon-label" className="mb-1 block text-ink-muted">
            Forecast horizon <HelpTip id="forecast-horizon" />
          </span>
          <Segmented
            labelledBy="fx-horizon-label"
            value={horizon}
            onChange={(h) => push({ model: cur.model, horizon: h })}
            options={(avail.byModel[cur.model] ?? []).map((h) => ({ value: h, label: periodsText(h, M.frequency) }))}
          />
        </div>
        <ForecastTourButton className={`ml-auto rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-bg ${focusRing}`}>Take a tour</ForecastTourButton>
      </div>
      {unavailable.length > 0 && (
        <details className="-mt-3 text-xs text-ink-muted" data-testid="model-availability" data-tour="fx-availability">
          <summary className={`cursor-pointer ${focusRing}`}>
            {avail.models.length} of {CORE_MODELS.length} models have a tested forecast here · why not the other {unavailable.length}?
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {unavailable.map((u) => (
              <li key={u.model}>
                <span className="font-medium text-ink">{u.model_name}</span>: {STATUS_TEXT[u.status]}
                {u.reason ? <span> ({u.reason})</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {notices.map((n) => (
        <p key={n} role="status" className="-mt-3 text-xs text-warn">
          {n}
        </p>
      ))}
      {stale && (
        <p role="status" className="-mt-3 text-xs text-warn">
          This forecast was made before the latest official {quarterly ? "quarter" : "month"}, so newer data is not reflected in it.
        </p>
      )}

      {/* 3. Chart */}
      <section className="rounded-md border border-rule bg-surface" aria-labelledby="fx-chart-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
          <h2 id="fx-chart-title" className="text-sm font-semibold tracking-tight">
            {indexName}: official history and {periodAdj(horizon, M.frequency)} forecast
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted">History</span>
            <Segmented
              size="sm"
              label="History shown"
              value={filters.range}
              onChange={(r) => push({ range: r, custom: null })}
              options={[...HISTORY_RANGES, ...(HISTORY_RANGES.includes(filters.range) ? [] : [filters.range])].map((r) => ({ value: r, label: r }))}
            />
          </div>
        </div>
        <div className="px-3 py-4 sm:px-5" data-tour="fx-chart">
          {history.length < 2 ? (
            <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-muted">Not enough official {quarterly ? "quarters" : "months"} in this window to draw the history. Choose a longer window.</p>
          ) : (
            <OutlookChart
              history={history}
              forecast={rows}
              name={indexName}
              axisLabel={axisLabel}
              officialSource={officialLabel}
              modelName={modelName}
              bandsTourId="fx-bands"
              frequency={M.frequency}
              valueKind={quarterly ? "gdp" : "index"}
            />
          )}
          {!hasInterval && <p className="mt-2 text-xs text-warn">Uncertainty interval unavailable: this model provides no uncertainty range, so no band is drawn.</p>}
        </div>
        <p className="border-t border-rule px-5 py-2 text-xs text-ink-muted">
          Official data: {officialLabel}, base {baseYear}. Forecast: {modelName}, run #{cur.run.id}
          {cur.partial ? ` (first ${horizon} of ${cur.run.horizon} stored ${quarterly ? "quarters" : "months"})` : ""}, made from {origin ? pl(origin, true) : "an unrecorded period"} data.
          {trainingHistory && <span data-testid="training-history"> {trainingLine(trainingHistory)}</span>}
        </p>
      </section>

      {/* 4. What this means */}
      <div data-testid="meaning" className="rounded-md border-l-4 border-accent bg-surface px-4 py-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">What this means</p>
        {meaning.map((t) => (
          <p key={t} className="mt-1 first:mt-0">
            {t}
          </p>
        ))}
        {ev.caveats.map((c) => (
          <p key={c} className="mt-1 text-xs text-warn">
            {c}
          </p>
        ))}
      </div>

      {/* Data connection */}
      <p className="text-sm text-ink-muted" data-testid="data-connection">
        Historical observations come from the same official series shown in Indicators. Forecasts are separately generated statistical estimates, not official data
        and not guaranteed.{" "}
        <Link href={historyHref} className="whitespace-nowrap text-accent underline">
          View historical {shortName} →
        </Link>
      </p>

      {/* 5. Research View */}
      {research ? (
        <div className="space-y-6" data-testid="research-view">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
            <Panel title={`Backtest evidence · ${periodAdj(horizon, M.frequency)} horizon`}>
              {ev.set ? (
                <>
                  <p className="mb-3 text-xs text-ink-muted">
                    All figures below, including the naive baseline&apos;s, come from one test set: {ev.set.group.n_origins} forecast origins
                    {ev.set.group.evaluation_start ? `, targets ${pl(ev.set.group.evaluation_start)} to ${pl(ev.set.group.evaluation_end ?? ev.set.group.evaluation_start)}` : ""}.
                  </p>
                  <table className="w-full text-sm">
                    <caption className="sr-only">Backtest metrics for {modelName} and the naive baseline on identical origins</caption>
                    <thead>
                      <tr className="border-b border-rule text-left text-xs">
                        <th scope="col" className="py-1.5 pr-3 font-semibold">Metric</th>
                        <th scope="col" className="py-1.5 pr-3 text-right font-semibold">{modelName}</th>
                        <th scope="col" className="py-1.5 text-right font-semibold">Naive baseline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["mae", "rmse", "mase", "smape", "coverage_80", "coverage_95"] as const).map((k) => (
                        <tr key={k} className="border-b border-rule last:border-b-0">
                          <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-muted">
                            {{ mae: "MAE", rmse: "RMSE", mase: "MASE", smape: "sMAPE (%)", coverage_80: "80% coverage", coverage_95: "95% coverage" }[k]}{" "}
                            <HelpTip id={k.startsWith("coverage") ? "coverage" : k === "rmse" ? "mae" : k} />
                          </th>
                          <td className="figure py-1.5 pr-3 text-right">{fmtMetric(k, ev.set!.model.metrics[k])}</td>
                          <td className="figure py-1.5 text-right text-ink-muted">{fmtMetric(k, ev.set!.baseline?.metrics[k])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-ink-muted">
                    Lower is better for MAE, RMSE, MASE and sMAPE. MASE is scaled by one-month changes in the training data, so values above 1 at longer horizons do not by
                    themselves mean &quot;worse than naive&quot;; compare with the baseline column. “—” means not available, never zero.
                  </p>
                  <ReliabilityBanner r={ev} className="mt-3" />
                  {ev.caveats.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-warn">
                      {ev.caveats.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <Link href={`/forecasting/experiments/${ev.set.model.run_id}?view=research`} className="text-accent underline">
                      Backtest run #{ev.set.model.run_id} →
                    </Link>
                    <Link href={`/forecasting/comparison?indicator=${indicator}&horizon=${horizon}&view=research`} className="text-accent underline">
                      Compare models →
                    </Link>
                    <Link href={`/forecasting/experiments?indicator=${indicator}&model=${cur.model}&view=research`} className="text-accent underline">
                      All {modelName} runs →
                    </Link>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-muted">No backtest on a set that includes the naive baseline is stored for this horizon, so no accuracy is claimed.</p>
                  <ReliabilityBanner r={ev} className="mt-3" />
                </>
              )}
            </Panel>
            <Panel title="Provenance">
              <dl className="grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                {(
                  [
                    ["Model", `${modelName} (${cur.model})`],
                    ["Configuration", detail ?? cur.run.model_label ?? "As in the model description"],
                    ...(cur.run.model_parameters && Object.keys(cur.run.model_parameters).length
                      ? ([["Parameters", configText(cur.run.model_parameters)]] as [string, string][])
                      : []),
                    ["Method", models.find((m) => m.id === cur.model)?.explanation ?? "—"],
                    ["Forecast run", `#${cur.run.id}, ${periodsText(cur.run.horizon, M.frequency)}, stored ${cur.run.created_at.slice(0, 10)}`],
                    ["Horizon shown", cur.partial ? `${periodsText(horizon, M.frequency)} (steps 1–${horizon} of run #${cur.run.id})` : periodsText(horizon, M.frequency)],
                    ["Forecast origin", origin ? pl(origin, true) : "Not recorded"],
                    ["Training window", `${cur.run.training_start ? pl(cur.run.training_start) : "?"} – ${pl(cur.run.training_cutoff)}`],
                    ...(trainingHistory
                      ? ([["Training data", `${trainingHistory.components.map((c) => `${c.series_code} (${monthLabel(c.first_period)} – ${monthLabel(c.last_period)}, ${c.n_observations} mo)`).join(" + ")}. ${trainingHistory.note}`]] as [string, string][])
                      : []),
                    ["Intervals", methodLabel(rows.find((r) => r.interval_method)?.interval_method)],
                    ["Data fingerprint", cur.run.dataset_fingerprint ?? "Not recorded"],
                    ["Backtest training", bt?.training_start ? `${pl(bt.training_start)} – ${pl(bt.training_cutoff)} (expanding)` : "—"],
                    ["Selection", chosen.reason],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-muted">{k}</dt>
                    <dd className={`min-w-0 break-words ${k === "Data fingerprint" ? "figure text-xs" : ""}`}>{v}</dd>
                  </div>
                ))}
              </dl>
              {indicator === "iip" && (
                <p className="mt-3 text-xs text-warn">
                  IIP is not seasonally adjusted. {cur.model === "sarima" || cur.model === "snaive" ? "This model uses a yearly seasonal component." : "This model has no yearly seasonal component."}
                </p>
              )}
            </Panel>
          </div>

          <Panel title="Forecast table">
            <div className="-mt-1 mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-muted">{periodsText(rows.length, M.frequency)} of forecasts · model-generated, not official</p>
              <button type="button" onClick={download} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
                Download CSV
              </button>
            </div>
            <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="Forecast table (scrollable)" tabIndex={0}>
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Stored forecasts for {indexName} using {modelName}</caption>
                <thead>
                  <tr className="border-b border-rule text-left text-xs">
                    <th scope="col" className="py-2 pr-4 font-semibold">Target {quarterly ? "quarter" : "month"}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">{quarterly ? "Forecast real GDP" : "Forecast index"}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">{quarterly ? "Implied YoY growth" : "Change from latest"}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">80% interval</th>
                    <th scope="col" className="py-2 text-right font-semibold">95% interval</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = latest ? changeFrom(latest.value, r.forecast) : null;
                    const y = quarterly ? impliedYoy(r.target_date, r.forecast, obs) : null;
                    return (
                      <tr key={r.target_date} className="border-b border-rule last:border-b-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium">{pl(r.target_date, true)}</th>
                        <td className="figure py-2 pr-4 text-right">{fv(r.forecast)}</td>
                        <td className="figure py-2 pr-4 text-right">
                          {quarterly ? (y === null ? "—" : pctText(y)) : c ? `${c.abs > 0 ? "+" : ""}${c.abs.toFixed(2)}${c.pct === null ? "" : ` (${pctText(c.pct)})`}` : "—"}
                        </td>
                        <td className="figure py-2 pr-4 text-right">{r.lower_80 === null ? "—" : `${fv(r.lower_80)} to ${fv(r.upper_80)}`}</td>
                        <td className="figure py-2 text-right">{r.lower_95 === null ? "—" : `${fv(r.lower_95)} to ${fv(r.upper_95)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!quarterly && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                {interpretForecast({ indicator: shortName, modelName, horizon, latest, rows, reliability: ev }).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {quarterly && (
              <p className="mt-3 text-xs text-ink-muted">
                Growth is never forecast directly: the model forecasts the real GDP level, and year-on-year growth is the forecast level divided by the official level of the
                same quarter one year earlier, minus one. It is not quarter-on-quarter growth, which for this unadjusted series mostly reflects the season.
              </p>
            )}
          </Panel>

          <div className="space-y-2">
            <SourceAttribution
              cls="official"
              sources={[source]}
              period={history.length ? `${pl(history[0].period)} – ${pl(history[history.length - 1].period)}` : "no observations in this window"}
              units={M.unit(baseYear)}
            />
            <SourceAttribution
              cls="forecast"
              sources={[source]}
              period={`${pl(rows[0].target_date)} – ${pl(last.target_date)} (forecast ${quarterly ? "quarters" : "months"})`}
              units={quarterly ? M.unit(baseYear) : "Index level"}
              method={`${modelName}${detail ? ` [${detail}]` : ""} (${cur.model}) · run #${cur.run.id} · origin ${origin ? pl(origin) : "not recorded"} · horizon ${periodsText(horizon, M.frequency)} · intervals: ${methodLabel(rows.find((r) => r.interval_method)?.interval_method)} · training cutoff ${pl(cur.run.training_cutoff)}`}
              retrievedAt={cur.run.created_at}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">
          Want error metrics, backtest details, data fingerprints or a CSV? Switch to <span className="font-medium text-ink">Research</span> view at the top of the page.
        </p>
      )}
    </div>
  );
}
