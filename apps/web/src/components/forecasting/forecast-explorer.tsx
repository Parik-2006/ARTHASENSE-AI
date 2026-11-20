"use client";

import { useState } from "react";
import { ForecastChart, type HistoryPoint } from "@/components/forecasting/forecast-chart";
import { Panel } from "@/components/ui/primitives";
import {
  fmt,
  fmtMetric,
  type ForecastRow,
  forecastsToCsv,
  type ModelInfo,
  methodLabel,
  monthLabel,
  type Run,
} from "@/lib/forecasting";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`;

export interface StoredForecast {
  model: string;
  run: Run;
  items: ForecastRow[]; // steps 1..run.horizon from the stored genuine-future forecast
}

/** Model + horizon selection over STORED forecasts. Only models with a stored forecast and a completed
 *  backtest for the chosen horizon can be selected: nothing is generated in the browser. */
export function ForecastExplorer({
  indicator,
  indexName,
  axisLabel,
  history,
  forecasts,
  backtests,
  models,
}: {
  indicator: string;
  indexName: string;
  axisLabel: string;
  history: HistoryPoint[];
  forecasts: StoredForecast[];
  backtests: Run[];
  models: ModelInfo[];
}) {
  const evaluated = (model: string, h: number) =>
    backtests.find((r) => r.model === model && r.horizon === h && r.status === "completed" && r.kind === "backtest");
  const options = forecasts.filter((f) => backtests.some((r) => r.model === f.model && r.status === "completed"));
  const [model, setModel] = useState(options[0]?.model ?? "");
  const current = options.find((f) => f.model === model) ?? options[0];
  const horizonChoices = current ? [...new Set(current.items.map((i) => i.step ?? 0))].filter((x) => x > 0) : [];
  const validated = horizonChoices.filter((h) => current && evaluated(current.model, h));
  const [h, setH] = useState<number | null>(null);
  const horizon = h !== null && horizonChoices.includes(h) ? h : (validated[validated.length - 1] ?? horizonChoices[horizonChoices.length - 1]);

  if (!current) {
    return (
      <Panel title="Forecast">
        <p className="text-sm text-ink-muted">
          No stored forecast exists for this indicator. A forecast is shown only after it has been generated and its
          horizon backtested; none has been, so nothing is displayed.
        </p>
      </Panel>
    );
  }
  const rows = current.items.filter((i) => (i.step ?? 0) <= horizon);
  const info = models.find((m) => m.id === current.model);
  const bt = evaluated(current.model, horizon);
  const hasInterval = rows.some((r) => r.lower_80 !== null);
  const lastObserved = history[history.length - 1];

  const download = () => {
    const url = URL.createObjectURL(new Blob([forecastsToCsv(rows, current.model, indicator)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `forecast-${indicator}-${current.model}-h${horizon}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Model</span>
          <select className={selectClass} value={current.model} onChange={(e) => { setModel(e.target.value); setH(null); }}>
            {options.map((o) => (
              <option key={o.model} value={o.model}>
                {models.find((m) => m.id === o.model)?.name ?? o.model}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Forecast horizon</span>
          <select className={selectClass} value={horizon} onChange={(e) => setH(Number(e.target.value))}>
            {horizonChoices.map((x) => (
              <option key={x} value={x}>
                {x} month{x > 1 ? "s" : ""} ahead{evaluated(current.model, x) ? "" : " (not backtested)"}
              </option>
            ))}
          </select>
        </label>
        <p className="pb-1.5 text-xs text-ink-muted">
          Forecast origin: <span className="figure text-ink">{lastObserved ? monthLabel(lastObserved.period, true) : "—"}</span> · stored{" "}
          <span className="figure text-ink">{current.run.created_at.slice(0, 10)}</span>
        </p>
      </div>

      <Panel title={`${indexName}: observed and forecast`} footnote="Forecasts are estimates of the index level, not official figures and not guaranteed outcomes.">
        <ForecastChart history={history} forecast={rows} axisLabel={axisLabel} name={indexName} />
        {!hasInterval && (
          <p className="mt-3 text-xs text-warn">
            This model provides no prediction interval at this point (intervals need enough earlier backtest errors to
            calibrate), so none is drawn.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Panel title="Forecast table">
          <div className="-mt-1 mb-3 flex items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">{rows.length} forecast months</p>
            <button type="button" onClick={download} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
              Download CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <caption className="sr-only">Stored forecasts for {indexName} using {info?.name ?? current.model}</caption>
              <thead>
                <tr className="border-b border-rule text-left text-xs">
                  <th scope="col" className="py-2 pr-4 font-semibold">Target month</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Forecast index</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">80% interval</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">95% interval</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
                  <th scope="col" className="py-2 font-semibold">Origin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.target_date} className="border-b border-rule last:border-b-0">
                    <th scope="row" className="py-2 pr-4 text-left font-medium">{monthLabel(r.target_date, true)}</th>
                    <td className="figure py-2 pr-4 text-right">{fmt(r.forecast)}</td>
                    <td className="figure py-2 pr-4 text-right">{r.lower_80 === null ? "—" : `${fmt(r.lower_80)} to ${fmt(r.upper_80)}`}</td>
                    <td className="figure py-2 pr-4 text-right">{r.lower_95 === null ? "—" : `${fmt(r.lower_95)} to ${fmt(r.upper_95)}`}</td>
                    <td className="py-2 pr-4 text-ink-muted">{info?.name ?? current.model}</td>
                    <td className="py-2 text-ink-muted">{r.origin_date ? monthLabel(r.origin_date) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            “—” means the model supplied no interval. Interval method: {methodLabel(rows.find((r) => r.interval_method)?.interval_method)}.
          </p>
        </Panel>

        <div className="space-y-6">
          <Panel title="About this model">
            <p className="text-sm font-medium">{info?.name ?? current.model}</p>
            <p className="mt-1 text-sm text-ink-muted">{info?.explanation}</p>
          </Panel>
          <Panel title={`Backtest accuracy, ${horizon}-month horizon`}>
            {bt ? (
              <dl className="space-y-1 text-sm">
                {["mae", "rmse", "mase", "smape", "coverage_80", "coverage_95"].map((k) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-ink-muted">{k === "mae" ? "MAE" : k === "rmse" ? "RMSE" : k === "mase" ? "MASE" : k === "smape" ? "sMAPE (%)" : k === "coverage_80" ? "80% coverage" : "95% coverage"}</dt>
                    <dd className="figure">{fmtMetric(k, bt.metrics[k])}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-rule pt-1">
                  <dt className="text-ink-muted">Backtest origins</dt>
                  <dd className="figure">{bt.n_origins}</dd>
                </div>
                {bt.n_origins !== null && bt.n_origins < 12 && (
                  <p className="pt-2 text-xs text-warn">Only {bt.n_origins} origins: indicative, not a reliable ranking.</p>
                )}
                <p className="pt-1 text-xs text-ink-muted">MASE below 1 means better than a one-step naive forecast on training data.</p>
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
