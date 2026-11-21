import Link from "next/link";
import { Suspense } from "react";
import { ForecastChart } from "@/components/forecasting/forecast-chart";
import { ForecastExplorer, ReliabilityBanner } from "@/components/forecasting/forecast-explorer";
import { HelpTip } from "@/components/guide/help-tip";
import { Tour, TourButton } from "@/components/guide/tour";
import { SourceAttribution } from "@/components/source/source-attribution";
import { Panel, PageHeader, StatusPill } from "@/components/ui/primitives";
import { getForecastModels, getRuns } from "@/lib/api";
import { type IndicatorForecastData, loadIndicatorForecast } from "@/lib/forecast-data";
import { assessReliability, changeFrom, directionOf, FLAT_THRESHOLD_PCT, pickDefault, type Reliability, reliabilityFor, RELIABILITY_LABEL } from "@/lib/forecast-v2";
import {
  fmt,
  HORIZONS,
  INDICATOR_IDS,
  INDICATOR_NAMES,
  type IndicatorId,
  loadErrorText,
  methodLabel,
  monthLabel,
  type ModelInfo,
} from "@/lib/forecasting";
import { FORECAST_OVERVIEW_TOUR } from "@/lib/guide";
import { formatPeriod } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";
import { sourceFor } from "@/lib/source";

export const DISCLAIMER =
  "Forecasts are statistical estimates of index levels, not official statistics and not guaranteed outcomes. " +
  "Accuracy figures come from rolling-origin backtests on a short history, so they are indicative.";


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

// ---------- per-indicator forecast summary (shared by the overview cards and the outlook) ----------

export interface Summary {
  id: IndicatorId;
  state: "error" | "no_data" | "insufficient_history" | "no_stored_forecast" | "stale" | "available";
  reason: string;
  data: IndicatorForecastData;
  selected: null | {
    model: string;
    modelName: string;
    horizon: number;
    rows: IndicatorForecastData["stored"][number]["items"];
    run: IndicatorForecastData["stored"][number]["run"];
    reliability: Reliability;
    stale: boolean;
    why: string;
  };
}

/** Pure: turns loaded data into the card state. Never invents a forecast. */
export function summarize(data: IndicatorForecastData): Summary {
  const id = data.id;
  const mk = (state: Summary["state"], reason: string, selected: Summary["selected"] = null): Summary => ({ id, state, reason, data, selected });
  if (data.error) return mk("error", data.error);
  if (!data.hist || data.hist.observations.every((o) => o.index === null)) return mk("no_data", "No observations are stored for this indicator.");
  const latest = [...data.hist.observations].reverse().find((o) => o.index !== null)!;
  const isStale = (items: { origin_date: string | null }[]) => !!items[0]?.origin_date && items[0].origin_date.slice(0, 7) < latest.period.slice(0, 7);
  const candidates = data.stored.map((s) => {
    const bt = data.runs.find((r) => r.kind === "backtest" && r.status === "completed" && r.model === s.model && r.horizon === s.run.horizon);
    return { model: s.model, horizon: s.run.horizon, level: reliabilityFor(bt, data.comparisons[s.run.horizon], s.model, isStale(s.items)).level, mae: bt?.metrics.mae ?? null, createdAt: s.run.created_at };
  });
  const pick = pickDefault(candidates);
  if (!pick) {
    const info = data.info;
    if (info?.forecast_status === "insufficient_history") return mk("insufficient_history", info.reason ?? "The history is too short to evaluate any model.");
    return mk("no_stored_forecast", info?.reason ?? "No stored forecast exists for this indicator.");
  }
  const s = data.stored.find((x) => x.model === pick.model && x.run.horizon === pick.horizon)!;
  const bt = data.runs.find((r) => r.kind === "backtest" && r.status === "completed" && r.model === s.model && r.horizon === s.run.horizon);
  const stale = isStale(s.items);
  const reliability = reliabilityFor(bt, data.comparisons[s.run.horizon], s.model, stale);
  return mk(stale ? "stale" : "available", stale ? "The stored forecast was issued before the latest official observation." : "", {
    model: s.model,
    modelName: data.models.find((m) => m.id === s.model)?.name ?? s.model,
    horizon: s.run.horizon,
    rows: s.items,
    run: s.run,
    reliability,
    stale,
    why: pick.reason,
  });
}

const STATE_TEXT: Record<Summary["state"], string> = {
  error: "Backend unavailable",
  no_data: "No data",
  insufficient_history: "History insufficient",
  no_stored_forecast: "No stored forecast",
  stale: "Forecast stale",
  available: "Forecast available",
};

function ForecastCard({ s }: { s: Summary }) {
  const config = CONFIGS[s.id];
  const d = s.data;
  const obs = d.hist?.observations.filter((o) => o.index !== null) ?? [];
  const latest = obs[obs.length - 1];
  const sel = s.selected;
  const last = sel?.rows[sel.rows.length - 1];
  const change = latest && last ? changeFrom(latest.index as number, last.forecast) : null;
  const link = `/forecasting/${s.id}${sel ? `?model=${sel.model}&horizon=${sel.horizon}` : ""}`;
  const src = d.hist ? sourceFor(config, d.hist) : null;
  return (
    <article aria-label={`${config.shortName} forecast`} className="flex flex-col gap-3 rounded-md border border-rule bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg font-semibold">{INDICATOR_NAMES[s.id]}</h3>
          <p className="text-xs text-ink-muted">{d.hist ? `Base year ${d.hist.baseYear}` : "Base year unavailable"}</p>
        </div>
        <StatusPill tone={s.state === "available" ? "ok" : s.state === "error" ? "down" : "warn"}>{STATE_TEXT[s.state]}</StatusPill>
      </div>
      {latest ? (
        <p className="text-sm">
          Latest official index <span className="figure text-lg font-medium">{fmt(latest.index)}</span> <span className="text-ink-muted">({formatPeriod(latest.period, true)})</span>
        </p>
      ) : (
        <p className="text-sm text-ink-muted">No latest observation available.</p>
      )}

      {sel && last ? (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-muted">Model</dt>
            <dd>{sel.modelName}</dd>
            <dt className="text-ink-muted">Forecast origin</dt>
            <dd>{sel.rows[0]?.origin_date ? monthLabel(sel.rows[0].origin_date, true) : "Not recorded"}</dd>
            <dt className="text-ink-muted">Horizon · target</dt>
            <dd>{sel.horizon} mo · {monthLabel(last.target_date, true)}</dd>
            <dt className="text-ink-muted">Forecast index</dt>
            <dd className="figure">{fmt(last.forecast)}</dd>
            <dt className="text-ink-muted">Change vs latest</dt>
            <dd className="figure" title="Model-derived, not an official rate">
              {change ? `${change.abs > 0 ? "+" : ""}${change.abs.toFixed(2)}${change.pct === null ? "" : ` (${change.pct > 0 ? "+" : ""}${change.pct.toFixed(2)}%)`}` : "Not available"}
            </dd>
            <dt className="text-ink-muted">80% interval</dt>
            <dd className="figure">{last.lower_80 === null ? "Not available" : `${fmt(last.lower_80)} to ${fmt(last.upper_80)}`}</dd>
            <dt className="text-ink-muted">95% interval</dt>
            <dd className="figure">{last.lower_95 === null ? "Not available" : `${fmt(last.lower_95)} to ${fmt(last.upper_95)}`}</dd>
          </dl>
          {d.hist && obs.length > 1 && (
            <ForecastChart
              compact
              history={obs.slice(-24).map((o) => ({ period: o.period, index: o.index as number }))}
              forecast={sel.rows}
              axisLabel={`${config.shortName} index`}
              name={config.indexName}
            />
          )}
          <p className={`rounded border px-2 py-1 text-xs ${sel.reliability.level === "concerning" ? "border-up text-up" : "border-rule text-ink-muted"}`} data-testid="card-reliability" data-level={sel.reliability.level}>
            <span className="font-medium">Reliability: {sel.reliability.label}.</span> {sel.reliability.reasons[0]}
          </p>
          {sel.stale && <p className="text-xs text-warn">{s.reason}</p>}
        </>
      ) : (
        <div className="rounded border border-dashed border-rule px-3 py-4 text-sm text-ink-muted" data-testid="card-unavailable">
          <p className="font-medium text-ink">{STATE_TEXT[s.state]}</p>
          <p className="mt-1">{s.reason}</p>
          {s.state === "insufficient_history" && s.id === "cpi" && (
            <p className="mt-2 text-xs">
              CPI base years are never spliced: the official Back series is a separate segment, and a model is only trained on one continuous series. More
              Current-series history (or a validated linking method) is needed before CPI can be evaluated.
            </p>
          )}
        </div>
      )}
      {src && (
        <SourceAttribution
          cls={sel ? "forecast" : "official"}
          sources={[src]}
          period={latest ? formatPeriod(latest.period, true) : "no observations"}
          units="Index level"
          method={sel ? `${sel.modelName} (${sel.model}) · run #${sel.run.id} · stored ${sel.run.created_at.slice(0, 10)} · intervals: ${methodLabel(sel.rows.find((r) => r.interval_method)?.interval_method)}` : undefined}
          retrievedAt={sel ? sel.run.created_at : undefined}
        />
      )}
      <div className="mt-auto flex flex-wrap gap-4 text-sm">
        <Link href={link} className="font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
          Open {config.shortName} forecast explorer →
        </Link>
        <Link href={`/indicators/${s.id}`} className="text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
          Historical {config.shortName} data →
        </Link>
      </div>
    </article>
  );
}

/** Deterministic outlook: states only what stored forecasts and backtests support. */
export function outlookStatements(sums: Summary[]): string[] {
  const out: string[] = [];
  const avail = sums.filter((s) => s.selected);
  if (avail.length === 0) return ["No indicator currently has a stored, evaluable forecast, so there is no outlook to summarise. Official history is available in Indicators."];
  for (const s of avail) {
    const sel = s.selected!;
    const obs = s.data.hist?.observations.filter((o) => o.index !== null) ?? [];
    const latest = obs[obs.length - 1];
    const last = sel.rows[sel.rows.length - 1];
    const c = latest && last ? changeFrom(latest.index as number, last.forecast) : null;
    const dir = directionOf(c);
    const short = s.id.toUpperCase();
    const move = !c || !dir ? "a change that cannot be computed" : dir === "flat" ? `a broadly unchanged index (within ±${FLAT_THRESHOLD_PCT}%)` : `an index ${dir === "up" ? "higher" : "lower"} by ${Math.abs(c.pct ?? 0).toFixed(1)}%`;
    out.push(`${short}: ${sel.modelName} projects ${move} by ${monthLabel(last.target_date, true)} (${sel.horizon}-month horizon). Evidence: ${RELIABILITY_LABEL[sel.reliability.level].toLowerCase()}.`);
  }
  for (const s of sums.filter((x) => !x.selected)) out.push(`${s.id.toUpperCase()}: no outlook — ${s.reason.replace(/\.$/, "")}.`);
  if (avail.some((s) => s.selected!.reliability.level === "concerning")) out.push("At least one forecast has concerning backtest performance. Treat its direction and size as uncertain.");
  if (avail.every((s) => (s.selected!.run.n_origins ?? 0) < 12 && s.selected!.reliability.level !== "supported")) out.push("All forecasts rest on short evaluation histories, so every conclusion here is tentative.");
  return out;
}

async function OverviewData() {
  const [datas, models, runs] = await Promise.all([Promise.all(INDICATOR_IDS.map(loadIndicatorForecast)), getForecastModels(), getRuns("?limit=8&status=completed")]);
  const sums = datas.map(summarize);
  const statements = outlookStatements(sums);
  return (
    <div className="space-y-8">
      <section aria-label="Forecast cards" data-tour="fo-cards" className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {sums.map((s) => (
          <ForecastCard key={s.id} s={s} />
        ))}
      </section>

      <div data-tour="fo-outlook">
        <Panel title="Outlook summary" footnote="Built by fixed rules from stored forecasts and backtests. It describes model estimates of index levels, not official data, causes or certainties.">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {statements.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <section aria-label="Reliability overview" data-tour="fo-reliability" className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">How much evidence supports each forecast? <HelpTip id="reliability" /></h2>
        <div className="grid gap-3 lg:grid-cols-3 [&>*]:min-w-0">
          {sums.map((s) => (
            <div key={s.id}>
              <p className="mb-1 text-sm font-medium">{INDICATOR_NAMES[s.id]}</p>
              {s.selected ? (
                <ReliabilityBanner r={s.selected.reliability} />
              ) : (
                <ReliabilityBanner r={assessReliability({ nOrigins: null, mae: null, baselineMae: null, coverage80: null, coverage95: null })} />
              )}
            </div>
          ))}
        </div>
      </section>

      <div data-tour="fo-models">
        <details className="rounded-md border border-rule bg-surface">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Model inventory (technical)</summary>
          <div className="border-t border-rule px-5 py-4">{models.ok ? <ModelsTable models={models.data} /> : <ApiError what="the model list" error={models.error} />}</div>
        </details>
      </div>

      <div data-tour="fo-experiments">
        <Panel title="Latest completed experiments" footnote={<Link href="/forecasting/experiments" className="text-accent underline">Open all experiments →</Link>}>
          {runs.ok ? (
            runs.data.items.length ? (
              <ul className="divide-y divide-rule text-sm">
                {runs.data.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/forecasting/experiments/${r.id}`} className="underline focus-visible:outline-2 focus-visible:outline-accent">
                      {r.indicator?.toUpperCase()} · {r.model_name} · {r.horizon}-month {r.kind}
                    </Link>
                    <span className="figure text-xs text-ink-muted">{r.n_origins ? `${r.n_origins} origin${r.n_origins === 1 ? "" : "s"} · ` : ""}{r.created_at.slice(0, 10)} · run #{r.id}</span>
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
    </div>
  );
}

export function ForecastOverviewPage() {
  return (
    <>
      <Tour steps={FORECAST_OVERVIEW_TOUR} />
      <header data-tour="fo-hero" className="mb-6 border-b border-rule pb-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">Forecasting</p>
        <h1 className="font-serif text-4xl leading-[1.15] font-semibold tracking-tight">India&apos;s Economic Outlook</h1>
        <p className="mt-3 max-w-3xl text-base text-ink-muted">
          Explore model-based forecasts for consumer prices, wholesale prices, and industrial production, with transparent accuracy and uncertainty.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <TourButton className="rounded border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent">Take a Tour</TourButton>
          <Link href="/indicators" className="rounded border border-rule px-4 py-2 text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent">Historical indicators</Link>
        </div>
      </header>
      <p className="mb-6 rounded-md border border-rule bg-surface px-4 py-3 text-sm text-ink-muted">{DISCLAIMER} Models that cannot run here are listed as unavailable and never produce numbers.</p>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-md border border-rule bg-surface" />}>
        <OverviewData />
      </Suspense>
    </>
  );
}

async function IndicatorData({ id }: { id: IndicatorId }) {
  const config = CONFIGS[id];
  const data = await loadIndicatorForecast(id);
  if (data.error || !data.hist) return <ApiError what={`${id.toUpperCase()} forecasts`} error={data.error ?? data.histError ?? ""} />;
  const info = data.info;
  const obs = data.hist.observations.filter((o) => o.index !== null);
  const last = obs[obs.length - 1];
  const sum = summarize(data);

  return (
    <div className="space-y-6">
      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Indicator", config.shortName, `Base year ${data.hist.baseYear}`],
          ["Latest observed", last ? fmt(last.index) : "—", last ? monthLabel(last.period, true) : "No data"],
          ["Observations", String(info?.n_observations ?? obs.length), info?.first_period ? `${monthLabel(info.first_period)} to ${monthLabel(info.last_period ?? info.first_period)}` : "—"],
          ["Last experiment", info?.last_experiment_at ? info.last_experiment_at.slice(0, 10) : "—", `${info?.completed_backtests ?? 0} backtests · ${info?.future_forecasts ?? 0} forecasts`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-md border border-rule bg-surface p-4">
            <p className="text-sm text-ink-muted">{label}</p>
            <p className="figure mt-1 text-2xl font-medium tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-ink-muted">{sub}</p>
          </div>
        ))}
      </section>
      {!sum.selected && (
        <Panel title={`Why there is no ${config.shortName} forecast here`}>
          <p className="text-sm">{sum.reason || "No experiment has been run."}</p>
          <p className="mt-2 text-sm text-ink-muted">
            A model is shown only after it has been backtested on the indicator&apos;s own history. Inventing a forecast from too little data would be
            misleading, so none is displayed.
          </p>
          {id === "cpi" && (
            <p className="mt-2 text-sm text-ink-muted">
              CPI series with different base years or methods are never spliced into one training series, and no linking formula is assumed. The official
              Back series is shown separately on the CPI history page.
            </p>
          )}
          <p className="mt-2 text-xs text-ink-muted">Evaluable horizons for this series: {info?.evaluable_horizons.length ? info.evaluable_horizons.join(", ") + " months" : "none"} (of {HORIZONS.join(", ")}).</p>
          <p className="mt-3 text-sm">
            <Link href={`/indicators/${id}`} className="text-accent underline">Historical {config.shortName} data and source →</Link>
          </p>
        </Panel>
      )}
      {sum.selected && (
        <ForecastExplorer
          indicator={id}
          shortName={config.shortName}
          indexName={config.indexName}
          axisLabel={`${config.shortName} index (${data.hist.baseYear} = 100)`}
          baseYear={data.hist.baseYear}
          observations={data.hist.observations}
          source={sourceFor(config, data.hist)}
          stored={data.stored}
          runs={data.runs}
          models={data.models}
          comparisons={data.comparisons}
        />
      )}
      <Panel title="Research disclaimer">
        <p className="text-sm text-ink-muted">{DISCLAIMER}</p>
        <p className="mt-2 text-sm text-ink-muted">
          Compare models on <Link href={`/forecasting/comparison?indicator=${id}`} className="underline">the comparison page</Link> and inspect every run on{" "}
          <Link href={`/forecasting/experiments?indicator=${id}`} className="underline">the experiments page</Link>.
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
