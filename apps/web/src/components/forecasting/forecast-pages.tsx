import Link from "next/link";
import { Suspense } from "react";
import { ForecastExplorer, type StoredForecast } from "@/components/forecasting/forecast-explorer";
import { Panel, StatusPill, type StatusTone } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/primitives";
import { getForecastModels, getForecastSeries, getIndicator, getLatestForecast, getRuns } from "@/lib/api";
import {
  fmt,
  HORIZONS,
  INDICATOR_IDS,
  INDICATOR_NAMES,
  type IndicatorId,
  loadErrorText,
  monthLabel,
  type ModelInfo,
  type Result,
  type SeriesInfo,
} from "@/lib/forecasting";
import { formatTimestamp } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";

export const DISCLAIMER =
  "Forecasts are statistical estimates of index levels, not official statistics and not guaranteed outcomes. " +
  "Accuracy figures come from rolling-origin backtests on a short history, so they are indicative.";

const STATUS: Record<SeriesInfo["forecast_status"], { tone: StatusTone; text: string }> = {
  no_data: { tone: "warn", text: "No data imported" },
  insufficient_history: { tone: "warn", text: "History too short to evaluate" },
  ready_not_run: { tone: "unknown", text: "Ready, no experiment yet" },
  has_experiments: { tone: "ok", text: "Experiments available" },
};

function ApiError({ what, error = "" }: { what: string; error?: string }) {
  return (
    <p role="alert" className="rounded-md border border-up bg-surface px-4 py-3 text-sm text-up">
      {loadErrorText(what, error)}
    </p>
  );
}

function ModelsTable({ models }: { models: ModelInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">Forecasting models and their status</caption>
        <thead>
          <tr className="border-b border-rule text-left text-xs">
            <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Type</th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold">Min. history</th>
            <th scope="col" className="py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} className="border-b border-rule align-top last:border-b-0">
              <th scope="row" className="py-2 pr-4 text-left font-medium">
                {m.name}
                {m.is_baseline && <span className="ml-2 rounded border border-rule px-1.5 text-[10px] uppercase tracking-wide text-ink-muted">baseline</span>}
                <span className="block text-xs font-normal text-ink-muted">{m.explanation}</span>
              </th>
              <td className="py-2 pr-4 text-ink-muted">{m.family.replace("_", " ")}</td>
              <td className="figure py-2 pr-4 text-right">{m.min_train} mo</td>
              <td className="py-2">
                {m.status === "evaluated" && <StatusPill tone="ok">{`Evaluated (${m.completed_runs} runs)`}</StatusPill>}
                {m.status === "not_evaluated" && <StatusPill tone="unknown">Not evaluated</StatusPill>}
                {m.status === "unavailable" && <StatusPill tone="warn">Unavailable</StatusPill>}
                {m.unavailable_reason && <span className="mt-1 block max-w-sm text-xs text-ink-muted">{m.unavailable_reason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function OverviewData() {
  const [series, models, runs] = await Promise.all([getForecastSeries(), getForecastModels(), getRuns("?limit=8&status=completed")]);
  return (
    <div className="space-y-6">
      {series.ok ? (
        <section aria-label="Indicator forecasting status" className="grid gap-4 md:grid-cols-3">
          {INDICATOR_IDS.map((id) => {
            const s = series.data.find((x) => x.indicator === id);
            const st = s ? STATUS[s.forecast_status] : STATUS.no_data;
            return (
              <div key={id} className="flex flex-col gap-2 rounded-md border border-rule bg-surface p-4">
                <p className="font-serif text-xl font-semibold">{id.toUpperCase()}</p>
                <StatusPill tone={st.tone}>{st.text}</StatusPill>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-2"><dt className="text-ink-muted">Observations</dt><dd className="figure">{s?.n_observations ?? 0}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-muted">Coverage</dt><dd className="figure">{s?.first_period ? `${monthLabel(s.first_period)} to ${monthLabel(s.last_period ?? s.first_period)}` : "—"}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-muted">Latest index</dt><dd className="figure">{fmt(s?.latest_value)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-muted">Evaluable horizons</dt><dd className="figure">{s && s.evaluable_horizons.length ? s.evaluable_horizons.join(", ") + " mo" : "none"}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-muted">Backtests / forecasts</dt><dd className="figure">{s?.completed_backtests ?? 0} / {s?.future_forecasts ?? 0}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-muted">Last experiment</dt><dd className="figure text-right">{s?.last_experiment_at ? formatTimestamp(s.last_experiment_at) : "—"}</dd></div>
                </dl>
                {s?.reason && <p className="text-xs text-ink-muted">{s.reason}</p>}
                <Link href={`/forecasting/${id}`} className="mt-auto rounded text-sm font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
                  {id.toUpperCase()} forecasts →
                </Link>
              </div>
            );
          })}
        </section>
      ) : (
        <ApiError what="forecasting status" error={series.error} />
      )}
      <Panel title="Models">{models.ok ? <ModelsTable models={models.data} /> : <ApiError what="the model list" error={models.error} />}</Panel>
      <Panel title="Latest completed experiments" footnote="Open Experiments for the full history, including skipped runs and the reason for each.">
        {runs.ok ? (
          runs.data.items.length ? (
            <ul className="divide-y divide-rule text-sm">
              {runs.data.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/forecasting/experiments/${r.id}`} className="underline focus-visible:outline-2 focus-visible:outline-accent">
                    #{r.id} · {r.indicator?.toUpperCase()} · {r.model_name} · {r.horizon}-month {r.kind}
                  </Link>
                  <span className="figure text-xs text-ink-muted">{r.n_origins ? `${r.n_origins} origins · ` : ""}{r.created_at.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No experiments have been stored yet.</p>
          )
        ) : (
          <ApiError what="experiments" error={runs.error} />
        )}
      </Panel>
    </div>
  );
}

export function ForecastOverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Forecasting"
        title="AI Economic Forecasting"
        lede="Index-level forecasts for CPI, WPI and IIP, each tested against its own history before it is shown."
      />
      <p className="mb-6 rounded-md border border-rule bg-surface px-4 py-3 text-sm text-ink-muted">{DISCLAIMER} Models that cannot run here are listed as unavailable and never produce numbers.</p>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-md border border-rule bg-surface" />}>
        <OverviewData />
      </Suspense>
    </>
  );
}

async function IndicatorData({ id }: { id: IndicatorId }) {
  const config = CONFIGS[id];
  const [hist, series, models, runs] = await Promise.all([
    getIndicator(id, config.apiQuery),
    getForecastSeries(),
    getForecastModels(),
    getRuns(`?indicator=${id}&limit=200`),
  ]);
  const failed = [hist, series, models, runs].find((r) => !r.ok);
  if (!hist.ok || !series.ok || !models.ok || !runs.ok)
    return <ApiError what={`${id.toUpperCase()} forecasts`} error={failed && !failed.ok ? failed.error : ""} />;
  const info = series.data.find((s) => s.indicator === id);
  const obs = hist.data.observations.filter((o) => o.index !== null);
  const history = obs.map((o) => ({ period: o.period, index: o.index as number }));
  const last = obs[obs.length - 1];
  const futureRuns = runs.data.items.filter((r) => r.kind === "forecast" && r.status === "completed");
  const stored: StoredForecast[] = [];
  for (const m of [...new Set(futureRuns.map((r) => r.model))]) {
    const run = futureRuns.find((r) => r.model === m);
    if (!run) continue;
    const latest: Result<{ run: StoredForecast["run"] | null; items: StoredForecast["items"] }> = await getLatestForecast(id, m, run.horizon);
    if (latest.ok && latest.data.run) stored.push({ model: m, run: latest.data.run, items: latest.data.items });
  }
  const backtests = runs.data.items.filter((r) => r.kind === "backtest");

  return (
    <div className="space-y-6">
      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Indicator", config.shortName, `Base year ${hist.data.baseYear}`],
          ["Latest observed", last ? fmt(last.index) : "—", last ? monthLabel(last.period, true) : "No data"],
          ["Observations", String(info?.n_observations ?? 0), info?.first_period ? `${monthLabel(info.first_period)} to ${monthLabel(info.last_period ?? info.first_period)}` : "—"],
          ["Last experiment", info?.last_experiment_at ? info.last_experiment_at.slice(0, 10) : "—", `${info?.completed_backtests ?? 0} backtests · ${info?.future_forecasts ?? 0} forecasts`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-md border border-rule bg-surface p-4">
            <p className="text-sm text-ink-muted">{label}</p>
            <p className="figure mt-1 text-2xl font-medium tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-ink-muted">{sub}</p>
          </div>
        ))}
      </section>
      {info && info.forecast_status !== "has_experiments" && (
        <Panel title="Why there is no forecast here">
          <p className="text-sm">{info.reason ?? "No experiment has been run."}</p>
          <p className="mt-2 text-sm text-ink-muted">
            A model is shown only after it has been backtested on the indicator&apos;s own history. Inventing a forecast
            from too little data would be misleading, so none is displayed.
          </p>
          <p className="mt-2 text-xs text-ink-muted">Evaluable horizons for this series: {info.evaluable_horizons.length ? info.evaluable_horizons.join(", ") + " months" : "none"} (of {HORIZONS.join(", ")}).</p>
        </Panel>
      )}
      {info?.forecast_status === "has_experiments" && (
        <ForecastExplorer
          indicator={id}
          indexName={config.indexName}
          axisLabel={`${config.shortName} index (${hist.data.baseYear} = 100)`}
          history={history}
          forecasts={stored}
          backtests={backtests}
          models={models.data}
        />
      )}
      <Panel title="Research disclaimer">
        <p className="text-sm text-ink-muted">{DISCLAIMER}</p>
        <p className="mt-2 text-sm text-ink-muted">
          Compare models on <Link href="/forecasting/comparison" className="underline">the comparison page</Link> and inspect every run on <Link href="/forecasting/experiments" className="underline">the experiments page</Link>.
        </p>
      </Panel>
    </div>
  );
}

export function ForecastIndicatorPage({ id }: { id: IndicatorId }) {
  return (
    <>
      <PageHeader
        eyebrow="Forecasting"
        title={`${INDICATOR_NAMES[id]} forecasts`}
        lede="Stored forecasts of the index level with their backtested accuracy. Official figures and forecasts are always shown separately."
      />
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse rounded-md border border-rule bg-surface" />}>
        <IndicatorData id={id} />
      </Suspense>
    </>
  );
}
