"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { FilterBar } from "@/components/indicators/explorer";
import { ForecastChart } from "@/components/forecasting/forecast-chart";
import { Tour, TourButton } from "@/components/guide/tour";
import { HelpTip } from "@/components/guide/help-tip";
import { SourceAttribution } from "@/components/source/source-attribution";
import { Panel } from "@/components/ui/primitives";
import { inWindow, resolveWindow, withDerived } from "@/lib/analysis";
import {
  changeFrom,
  type ForecastFilters,
  forecastsToCsvV2,
  interpretForecast,
  parseForecastFilters,
  pickDefault,
  type Reliability,
  reliabilityFor,
  serializeForecastFilters,
  toIndicatorQuery,
} from "@/lib/forecast-v2";
import {
  type Comparison,
  fmt,
  fmtMetric,
  type ForecastRow,
  type IndicatorId,
  type ModelInfo,
  methodLabel,
  monthLabel,
  type Run,
} from "@/lib/forecasting";
import { FORECAST_EXPLORER_TOUR } from "@/lib/guide";
import type { Observation } from "@/lib/indicator";
import { seriesIds, type SourceInfo } from "@/lib/source";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`;

export interface StoredForecast {
  model: string;
  run: Run;
  items: ForecastRow[]; // steps 1..run.horizon from the stored genuine-future forecast
}

const TONE: Record<Reliability["level"], string> = {
  supported: "border-ok",
  limited: "border-target",
  insufficient: "border-rule",
  concerning: "border-up",
};
const GLYPH: Record<Reliability["level"], string> = { supported: "✓", limited: "◐", insufficient: "?", concerning: "⚠" };

export function ReliabilityBanner({ r, className = "" }: { r: Reliability; className?: string }) {
  return (
    <div role={r.level === "concerning" ? "alert" : "note"} data-testid="reliability" data-level={r.level} className={`rounded-md border bg-surface px-4 py-3 text-sm ${TONE[r.level]} ${className}`}>
      <p className="font-medium">
        <span aria-hidden className="mr-1.5">{GLYPH[r.level]}</span>
        Reliability: {r.label}
        <HelpTip id="reliability" />
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

/** History window, model and horizon over STORED forecasts. State lives in the URL
 *  (?range=&from=&to=&model=&horizon=). Nothing is generated in the browser. */
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
}: {
  indicator: IndicatorId;
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
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const obs = useMemo(() => observations.filter((o) => o.index !== null), [observations]);
  const derived = useMemo(() => withDerived(obs), [obs]);
  const latest = obs.length ? { period: obs[obs.length - 1].period, value: obs[obs.length - 1].index as number } : null;

  const avail = useMemo(() => {
    const byModel: Record<string, number[]> = {};
    for (const s of stored) byModel[s.model] = [...(byModel[s.model] ?? []), s.run.horizon].sort((a, b) => a - b);
    return { models: Object.keys(byModel), horizons: [...new Set(stored.map((s) => s.run.horizon))].sort((a, b) => a - b), byModel };
  }, [stored]);
  const { filters, notices } = useMemo(() => parseForecastFilters((k) => params?.get(k) ?? null, avail), [params, avail]);

  const backtestOf = (model: string, h: number) => runs.find((r) => r.kind === "backtest" && r.status === "completed" && r.model === model && r.horizon === h);
  const isStale = (s: StoredForecast) => {
    const origin = s.items[0]?.origin_date;
    return !!origin && !!latest && origin.slice(0, 7) < latest.period.slice(0, 7);
  };
  const candidates = useMemo(
    () =>
      stored.map((s) => {
        const bt = backtestOf(s.model, s.run.horizon);
        return { model: s.model, horizon: s.run.horizon, level: reliabilityFor(bt, comparisons[s.run.horizon], s.model, isStale(s)).level, mae: bt?.metrics.mae ?? null, createdAt: s.run.created_at };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stored, runs, comparisons, latest?.period],
  );
  const sel = pickDefault(candidates, { model: filters.model, horizon: filters.horizon });
  const current = sel ? stored.find((s) => s.model === sel.model && s.run.horizon === sel.horizon) : undefined;

  const push = (patch: Partial<ForecastFilters>) => {
    const qs = serializeForecastFilters({ ...filters, ...patch }).toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    // Presets, model and horizon are navigation steps (Back undoes them); month typing only refines one.
    if (patch.custom !== undefined && patch.range === undefined && patch.model === undefined && patch.horizon === undefined) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  };
  const reset = () => router.push(pathname, { scroll: false });
  const hasFilters = params ? [...params.keys()].length > 0 : false;

  const win = resolveWindow(obs, filters.range, filters.custom);
  const windowed = inWindow(derived, win);
  const history = windowed.map((o) => ({ period: o.period, index: o.index as number }));

  const indicatorLink = `/indicators/${indicator}${toIndicatorQuery({ range: filters.range, custom: filters.custom, metric: "index" })}`;

  if (!current || !sel) {
    return (
      <Panel title="Forecast">
        <p className="text-sm text-ink-muted">
          No stored forecast exists for this indicator. A forecast is shown only after it has been generated and its
          horizon backtested; none has been, so nothing is displayed.
        </p>
      </Panel>
    );
  }

  const horizon = current.run.horizon;
  const rows = current.items.filter((i) => (i.step ?? 0) <= horizon);
  const info = models.find((m) => m.id === current.model);
  const modelName = info?.name ?? current.model;
  const bt = backtestOf(current.model, horizon);
  const stale = isStale(current);
  const rel = reliabilityFor(bt, comparisons[horizon], current.model, stale);
  const hasInterval = rows.some((r) => r.lower_80 !== null);
  const origin = rows[0]?.origin_date ?? null;
  const others = stored
    .filter((s) => s.run.horizon === horizon && s.model !== current.model)
    .map((s) => ({ modelName: models.find((m) => m.id === s.model)?.name ?? s.model, finalForecast: s.items[s.items.length - 1]?.forecast ?? NaN, origin: s.items[0]?.origin_date ?? null }))
    .filter((o) => Number.isFinite(o.finalForecast));
  const statements = interpretForecast({ indicator: shortName, modelName, horizon, latest, rows, reliability: rel, others });
  const span = history.length ? `${monthLabel(history[0].period)} – ${monthLabel(history[history.length - 1].period)}` : "no observations in this window";

  const download = () => {
    const csv = forecastsToCsvV2(rows, {
      indicator: shortName,
      baseYear,
      seriesId: seriesIds(indicator, baseYear)[0],
      publisher: source.publisher,
      modelId: current.model,
      modelName,
      run: current.run,
      latest,
      reliability: rel.label,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `forecast-${indicator}-${current.model}-h${horizon}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Tour steps={FORECAST_EXPLORER_TOUR} />
      <div data-tour="fx-controls" className="rounded-md border border-rule bg-surface p-4">
        <FilterBar
          filters={filters}
          onChange={(p) => push({ ...(p.range !== undefined ? { range: p.range } : {}), ...(p.custom !== undefined ? { custom: p.custom } : {}) })}
          metrics={["index"]}
          rows={derived}
          mode="line"
          onMode={() => {}}
          modes={["line"]}
          lastMonth={latest ? latest.period.slice(0, 7) : null}
        />
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Model</span>
            <select
              aria-label="Model"
              className={selectClass}
              value={current.model}
              onChange={(e) => {
                const hs = avail.byModel[e.target.value] ?? [];
                push({ model: e.target.value, horizon: hs.includes(horizon) ? horizon : (hs[hs.length - 1] ?? null) });
              }}
            >
              {avail.models.map((m) => (
                <option key={m} value={m}>
                  {models.find((x) => x.id === m)?.name ?? m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">
              Forecast horizon <HelpTip id="forecast-horizon" />
            </span>
            <select aria-label="Forecast horizon" className={selectClass} value={horizon} onChange={(e) => push({ model: current.model, horizon: Number(e.target.value) })}>
              {(avail.byModel[current.model] ?? []).map((x) => (
                <option key={x} value={x}>
                  {x} month{x > 1 ? "s" : ""} ahead{backtestOf(current.model, x) ? "" : " (not backtested)"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={reset} disabled={!hasFilters} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-40 ${focusRing}`}>
            Reset filters
          </button>
          <TourButton className={`rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-bg ${focusRing}`}>Take a Tour</TourButton>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Forecast origin <HelpTip id="forecast-origin" />: <span className="figure text-ink">{origin ? monthLabel(origin, true) : "not recorded"}</span> · latest observation{" "}
          <span className="figure text-ink">{latest ? monthLabel(latest.period, true) : "—"}</span> · stored <span className="figure text-ink">{current.run.created_at.slice(0, 10)}</span> · run #{current.run.id}
        </p>
        <p className="mt-1 text-xs text-ink-muted">Selection: {sel.reason} Changing the history window does not change the forecast horizon.</p>
        {notices.map((n) => (
          <p key={n} role="status" className="mt-1 text-xs text-warn">
            {n}
          </p>
        ))}
      </div>

      <div data-tour="fx-reliability">
        <ReliabilityBanner r={rel} />
        {rel.level === "concerning" && stale === false && (
          <p className="mt-2 text-xs text-ink-muted">
            Other stored models can be compared on the <Link href={`/forecasting/comparison?indicator=${indicator}&horizon=${horizon}`} className="text-accent underline">comparison page</Link>.
          </p>
        )}
        {stale && (
          <p role="status" className="mt-2 text-xs text-warn">
            This forecast was issued before the latest official observation and is stale relative to the data above.
          </p>
        )}
      </div>

      <div data-tour="fx-chart">
        <Panel
          title={`${indexName}: observed and forecast`}
          footnote={
            <div className="space-y-2" data-tour="fx-source">
              <SourceAttribution cls="official" sources={[source]} period={span} units={`Index, base ${baseYear} = 100`} />
              <SourceAttribution
                cls="forecast"
                sources={[source]}
                period={`${rows.length ? `${monthLabel(rows[0].target_date)} – ${monthLabel(rows[rows.length - 1].target_date)}` : "—"} (forecast months)`}
                units="Index level"
                method={`${modelName} (${current.model}) · run #${current.run.id} · origin ${origin ? monthLabel(origin) : "not recorded"} · horizon ${horizon} mo · intervals: ${methodLabel(rows.find((r) => r.interval_method)?.interval_method)} · training cutoff ${monthLabel(current.run.training_cutoff)}`}
                retrievedAt={current.run.created_at}
              />
            </div>
          }
        >
          {history.length < 2 ? (
            <p className="rounded border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-muted">
              {filters.range === "Custom" && !win ? "Choose a valid start and end month to see this window." : "Not enough observations in this window to draw the history. Choose a longer window."}
            </p>
          ) : (
            <ForecastChart history={history} forecast={rows} axisLabel={axisLabel} name={indexName} />
          )}
          <p className="mt-2 text-xs text-ink-muted">Solid line: official observations. Dashed line and bands: model forecast with 80% and 95% prediction intervals <HelpTip id="interval" />. Gaps are real gaps.</p>
          {!hasInterval && <p className="mt-2 text-xs text-warn">This model provides no prediction interval here, so none is drawn.</p>}
        </Panel>
      </div>

      <div data-tour="fx-interpretation">
        <Panel title="What this means" footnote="Generated by fixed rules from the stored numbers. No cause is claimed, and none of this is official data.">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {statements.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link href={indicatorLink} className="text-accent underline">Historical {shortName} data in Indicators →</Link>
          </p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <div data-tour="fx-table">
          <Panel title="Forecast table">
            <div className="-mt-1 mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-ink-muted">{rows.length} forecast months · model-generated</p>
              <button type="button" onClick={download} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
                Download CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <caption className="sr-only">Stored forecasts for {indexName} using {modelName}</caption>
                <thead>
                  <tr className="border-b border-rule text-left text-xs">
                    <th scope="col" className="py-2 pr-4 font-semibold">Target month</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">Forecast index</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">Change from latest</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">80% interval</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">95% interval</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Origin</th>
                    <th scope="col" className="py-2 font-semibold">Run</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = latest ? changeFrom(latest.value, r.forecast) : null;
                    return (
                      <tr key={r.target_date} className="border-b border-rule last:border-b-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium">{monthLabel(r.target_date, true)}</th>
                        <td className="figure py-2 pr-4 text-right">{fmt(r.forecast)}</td>
                        <td className="figure py-2 pr-4 text-right" title="Model-derived, not an official rate">
                          {c ? `${c.abs > 0 ? "+" : ""}${c.abs.toFixed(2)}${c.pct === null ? "" : ` (${c.pct > 0 ? "+" : ""}${c.pct.toFixed(2)}%)`}` : "—"}
                        </td>
                        <td className="figure py-2 pr-4 text-right">{r.lower_80 === null ? "—" : `${fmt(r.lower_80)} to ${fmt(r.upper_80)}`}</td>
                        <td className="figure py-2 pr-4 text-right">{r.lower_95 === null ? "—" : `${fmt(r.lower_95)} to ${fmt(r.upper_95)}`}</td>
                        <td className="py-2 pr-4 text-ink-muted">{modelName}</td>
                        <td className="py-2 pr-4 text-ink-muted">{r.origin_date ? monthLabel(r.origin_date) : "—"}</td>
                        <td className="figure py-2 text-ink-muted">#{current.run.id}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              “—” means not available (the model supplied no interval, or no valid latest value exists). The change column is model-derived from the latest
              official observation; it is not an official inflation or growth rate. Interval method: {methodLabel(rows.find((r) => r.interval_method)?.interval_method)}.
            </p>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="About this model">
            <p className="text-sm font-medium">{modelName}</p>
            <p className="mt-1 text-sm text-ink-muted">{info?.explanation}</p>
            {indicator === "iip" && (
              <p className="mt-2 text-xs text-warn">
                IIP is not seasonally adjusted and has strong yearly patterns.{" "}
                {current.model === "sarima" || current.model === "snaive" ? "This model uses a yearly seasonal component." : "This model does not use a yearly seasonal component."}
              </p>
            )}
          </Panel>
          <Panel title={`Backtest accuracy, ${horizon}-month horizon`}>
            {bt ? (
              <dl className="space-y-1 text-sm">
                {["mae", "rmse", "mase", "smape", "coverage_80", "coverage_95"].map((k) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-ink-muted">
                      {k === "mae" ? "MAE" : k === "rmse" ? "RMSE" : k === "mase" ? "MASE" : k === "smape" ? "sMAPE (%)" : k === "coverage_80" ? "80% coverage" : "95% coverage"}
                    </dt>
                    <dd className="figure">{bt.metrics[k] === undefined ? "Not available" : fmtMetric(k, bt.metrics[k])}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-rule pt-1">
                  <dt className="text-ink-muted">Backtest origins <HelpTip id="backtesting" /></dt>
                  <dd className="figure">{bt.n_origins}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Training window <HelpTip id="training-window" /></dt>
                  <dd className="figure text-right">{bt.training_start ? `${monthLabel(bt.training_start)} – ` : ""}{monthLabel(bt.training_cutoff)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Data fingerprint <HelpTip id="data-fingerprint" /></dt>
                  <dd className="figure break-all text-right text-xs">{bt.dataset_fingerprint ? bt.dataset_fingerprint.slice(0, 16) : "Not recorded"}</dd>
                </div>
                <p className="pt-1 text-xs text-ink-muted">
                  What the metrics mean: MAE <HelpTip id="mae" />, MASE <HelpTip id="mase" />, sMAPE <HelpTip id="smape" />, coverage <HelpTip id="coverage" />.
                </p>
                <p className="text-xs text-ink-muted">
                  <Link href={`/forecasting/experiments/${bt.id}`} className="text-accent underline">Backtest run #{bt.id} →</Link>
                </p>
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">This horizon has not been backtested, so no accuracy is claimed for it.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
