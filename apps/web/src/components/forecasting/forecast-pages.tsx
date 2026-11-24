import Link from "next/link";
import { Suspense } from "react";
import { ForecastExplorer, ReliabilityBanner } from "@/components/forecasting/forecast-explorer";
import { OutlookChart } from "@/components/forecasting/outlook-chart";
import { ReliabilityMeter } from "@/components/forecasting/reliability-meter";
import { ResearchOnly } from "@/components/forecasting/research-only";
import { ForecastTourButton, SpotlightTour } from "@/components/forecasting/spotlight-tour";
import { StatusPill } from "@/components/ui/primitives";
import { getForecastModels, getRuns } from "@/lib/api";
import { type IndicatorForecastData, loadIndicatorForecast } from "@/lib/forecast-data";
import { chooseView, type Evidence, type ForecastView, forecastViews, indicatorHref, monthsNeeded, plainReliability } from "@/lib/forecast-evidence";
import { FORECAST_OVERVIEW_STEPS } from "@/lib/forecast-tours";
import { changeFrom, FLAT_THRESHOLD_PCT } from "@/lib/forecast-v2";
import { forecastMeta, impliedYoy } from "@/lib/forecast-meta";
import { fmt, FORECAST_IDS, FORECAST_NAMES, type ForecastId, loadErrorText, modelDetail, type ModelInfo, periodsText, trainingLine } from "@/lib/forecasting";
import { DEFINITION } from "@/lib/indicator-view";

export const DISCLAIMER =
  "Forecasts are statistical estimates of index levels, not official statistics and not guaranteed outcomes. " +
  "Accuracy figures come from rolling-origin backtests on a short history, so they are indicative.";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Shown while no tested forecast is stored. Older official history exists; say what it is and why it is not used yet. */
const OLDER_HISTORY: Partial<Record<ForecastId, string>> = {
  cpi: "Older official CPI does exist: MoSPI's back series on the same 2024 base (Jan 2013 – Dec 2024) and the discontinued 2012-base series. A forecast is shown only after models are tested on the official back + current history and those results are stored. The 2012-base levels are never mixed in.",
};

function ApiError({ what, error = "" }: { what: string; error?: string }) {
  return (
    <p role="alert" className="rounded-md border border-up bg-surface px-4 py-3 text-sm text-up">
      {loadErrorText(what, error)}
    </p>
  );
}

// ---------- per-indicator summary (pure) ----------

export interface Summary {
  id: ForecastId;
  state: "error" | "no_data" | "insufficient_history" | "no_stored_forecast" | "available";
  reason: string;
  data: IndicatorForecastData;
  latest: { period: string; value: number } | null;
  selected: null | { view: ForecastView; evidence: Evidence; modelName: string; why: string };
}

/** Turns loaded data into the card state, using the same evidence logic as the explorer. Never invents a forecast. */
export function summarize(data: IndicatorForecastData): Summary {
  const obs = data.hist?.observations.filter((o) => o.index !== null) ?? [];
  const latest = obs.length ? { period: obs[obs.length - 1].period, value: obs[obs.length - 1].index as number } : null;
  const mk = (state: Summary["state"], reason: string, selected: Summary["selected"] = null): Summary => ({ id: data.id, state, reason, data, latest, selected });
  if (data.error) return mk("error", data.error);
  if (!latest) return mk("no_data", "No observations are stored for this indicator.");
  const M = forecastMeta(data.id);
  const pick = chooseView(forecastViews(data.stored, M.horizons), data.comparisons, latest.period, {}, M.preferH, M.frequency);
  if (!pick) {
    if (data.info?.forecast_status === "insufficient_history") return mk("insufficient_history", data.info.reason ?? "The history is too short to test any model.");
    return mk("no_stored_forecast", data.info?.reason ?? "No stored forecast exists for this indicator.");
  }
  return mk("available", "", { view: pick.view, evidence: pick.evidence, modelName: data.models.find((m) => m.id === pick.view.model)?.name ?? pick.view.model, why: pick.reason });
}

const changeText = (latest: number, value: number) => {
  const c = changeFrom(latest, value);
  if (!c || c.pct === null) return null;
  return { pct: c.pct, text: `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)}%`, dir: Math.abs(c.pct) <= FLAT_THRESHOLD_PCT ? "flat" : c.pct > 0 ? "up" : "down" };
};

/** Plain outlook: one line per indicator plus at most one caution. Stored numbers only. */
export function outlookStatements(sums: Summary[]): string[] {
  const out: string[] = [];
  for (const s of sums) {
    const short = s.id.toUpperCase();
    const M = forecastMeta(s.id);
    if (!s.selected || !s.latest) {
      out.push(s.state === "insufficient_history" ? `${short}: not enough comparable history to test a model yet.` : `${short}: no forecast available (${s.reason.replace(/\.$/, "").toLowerCase()}).`);
      continue;
    }
    const last = s.selected.view.rows[s.selected.view.rows.length - 1];
    if (M.frequency === "quarterly") {
      const y = impliedYoy(last.target_date, last.forecast, s.data.hist?.observations ?? []);
      const g = y === null ? "a level whose year-on-year change cannot be computed" : `real GDP about ${Math.abs(y).toFixed(1)}% ${y >= 0 ? "above" : "below"} the same quarter a year earlier`;
      out.push(`${short}: ${s.selected.modelName} points to ${g} in ${M.period(last.target_date, true)}. Track record: ${plainLevel(s.selected.evidence)}.`);
      continue;
    }
    const c = changeText(s.latest.value, last.forecast);
    const move = !c ? "a change that cannot be computed" : c.dir === "flat" ? "little change" : `a ${c.dir === "up" ? "rise" : "fall"} of about ${Math.abs(c.pct).toFixed(1)}%`;
    out.push(`${short}: ${s.selected.modelName} points to ${move} by ${M.period(last.target_date, true)}. Track record: ${plainLevel(s.selected.evidence)}.`);
  }
  const avail = sums.filter((s) => s.selected);
  if (avail.some((s) => s.selected!.evidence.level === "concerning")) out.push("At least one estimate has a weak track record in past tests, so read its direction and size as uncertain.");
  return out;
}
const plainLevel = (e: Evidence) => ({ supported: "stronger", limited: "limited", concerning: "weak", insufficient: "not yet tested" })[e.level];

// ---------- overview ----------

export function ForecastCard({ s, anchor }: { s: Summary; anchor: boolean }) {
  const M = forecastMeta(s.id);
  const quarterly = M.frequency === "quarterly";
  const sel = s.selected;
  const last = sel?.view.rows[sel.view.rows.length - 1];
  const c = s.latest && last ? changeText(s.latest.value, last.forecast) : null;
  const obs = s.data.hist?.observations.filter((o) => o.index !== null) ?? [];
  const yoy = quarterly && last ? impliedYoy(last.target_date, last.forecast, obs) : null;
  const detail = sel ? modelDetail(sel.modelName, sel.view.run) : null;
  const fv = (v: number) => (quarterly ? M.value(v) : fmt(v));
  const tour = (name: string) => (anchor ? { "data-tour": name } : {});
  return (
    <article aria-labelledby={`card-${s.id}`} data-testid={`card-${s.id}`} {...(s.id === "gdp" ? { "data-tour": "fo-gdp" } : {})} className="flex min-w-0 flex-col rounded-md border border-rule bg-surface">
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id={`card-${s.id}`} className="font-serif text-2xl font-semibold leading-tight">
            {M.shortName}
          </h2>
          <p className="text-xs text-ink-muted">
            {FORECAST_NAMES[s.id].replace(/ \(.*\)$/, "")}
            {quarterly ? " · real, quarterly" : ""} · base {s.data.hist?.baseYear ?? "—"}
          </p>
        </div>
        {sel && (
          <span {...tour("fo-reliability")}>
            <ReliabilityMeter level={sel.evidence.level} />
          </span>
        )}
      </header>

      {sel && last && s.latest ? (
        <>
          <div className="grid grid-cols-2 gap-3 px-5 pt-4" {...tour("fo-official")}>
            <div>
              <p className="text-xs text-ink-muted">Latest official</p>
              <p className="figure text-xl font-medium">{fv(s.latest.value)}</p>
              <p className="text-xs text-ink-muted">{M.period(s.latest.period, true)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Model estimate</p>
              <p className="figure text-xl font-medium text-target">{fv(last.forecast)}</p>
              <p className="text-xs text-ink-muted">Forecast: {M.period(last.target_date, true)}</p>
            </div>
          </div>
          <p className="px-5 pt-2 text-sm" data-testid={`card-model-${s.id}`} {...tour("fo-model")}>
            <span className="text-ink-muted">Model: </span>
            <span className="font-medium" title={detail ?? undefined}>
              {sel.modelName}
            </span>
            {detail && <span className="sr-only"> ({detail})</span>}
          </p>
          <p className="px-5 pt-1 text-sm">
            {quarterly ? (
              yoy === null ? (
                <span className="text-ink-muted">Year-on-year change not available</span>
              ) : (
                <>
                  <span className="figure font-medium">
                    <span aria-hidden>{yoy > 0 ? "▲ " : yoy < 0 ? "▼ " : "■ "}</span>
                    {`${yoy > 0 ? "+" : ""}${yoy.toFixed(1)}%`}
                  </span>{" "}
                  <span className="text-ink-muted">vs the same quarter a year earlier (implied)</span>
                </>
              )
            ) : c ? (
              <>
                <span className={`figure font-medium ${c.dir === "flat" ? "text-ink" : "text-ink"}`}>
                  <span aria-hidden>{c.dir === "up" ? "▲ " : c.dir === "down" ? "▼ " : "■ "}</span>
                  {c.text}
                </span>{" "}
                <span className="text-ink-muted">expected change in {periodsText(sel.view.horizon, M.frequency)}</span>
              </>
            ) : (
              <span className="text-ink-muted">Change not available</span>
            )}
          </p>
          <div className="px-3 pt-3" {...tour("fo-chart")}>
            {obs.length > 1 && (
              <OutlookChart
                compact
                history={obs.slice(quarterly ? -12 : -24).map((o) => ({ period: o.period, index: o.index as number }))}
                forecast={sel.view.rows}
                name={M.seriesName}
                axisLabel=""
                officialSource={s.data.hist?.source.short ?? "MoSPI"}
                modelName={sel.modelName}
                frequency={M.frequency}
                formatValue={fv}
              />
            )}
          </div>
          <p className="px-5 pt-2 text-xs text-ink-muted">{plainReliability(sel.evidence)}</p>
          {s.data.info?.training_history && (
            <p className="px-5 pt-1 text-xs text-ink-muted" data-testid="card-training">
              {trainingLine(s.data.info.training_history)}
            </p>
          )}
        </>
      ) : (
        <div className="mx-5 mt-4 rounded border border-dashed border-rule px-4 py-5" data-testid="card-unavailable">
          {s.state === "insufficient_history" ? (
            <>
              <p className="font-medium">Not enough comparable history</p>
              <p className="mt-1 text-sm text-ink-muted">
                {s.data.info && !quarterly ? `The base ${s.data.hist?.baseYear ?? ""} series has ${s.data.info.n_observations} months; testing a model needs at least ${monthsNeeded(1)}.` : s.reason}
              </p>
              {OLDER_HISTORY[s.id] && <p className="mt-1 text-sm text-ink-muted">{OLDER_HISTORY[s.id]}</p>}
              {s.latest && (
                <p className="mt-3 text-sm">
                  Latest official <span className="figure font-medium">{fv(s.latest.value)}</span> <span className="text-ink-muted">({M.period(s.latest.period, true)})</span>
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-medium">{s.state === "error" ? "Forecasts unavailable" : s.state === "no_data" ? "No data" : "No stored forecast"}</p>
              <p className="mt-1 text-sm text-ink-muted">{s.state === "error" ? loadErrorText("forecasts", s.reason) : s.reason}</p>
            </>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-4">
        <Link
          href={`/forecasting/${s.id}`}
          {...(sel ? tour("fo-explore") : {})}
          className={`rounded border px-3 py-1.5 text-sm font-medium ${sel ? "border-accent bg-accent text-accent-ink" : "border-rule text-ink"} ${focusRing}`}
        >
          {sel ? "Explore forecast" : `About ${M.shortName} forecasts`}
        </Link>
        <Link href={indicatorHref(s.id)} className={`text-sm text-accent underline ${focusRing}`}>
          View historical {M.shortName}
        </Link>
      </div>
    </article>
  );
}

function ModelsTable({ models }: { models: ModelInfo[] }) {
  return (
    <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="Model inventory (scrollable)" tabIndex={0}>
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
  const [datas, models, runs] = await Promise.all([Promise.all(FORECAST_IDS.map(loadIndicatorForecast)), getForecastModels(), getRuns("?limit=8&status=completed")]);
  const sums = datas.map(summarize);
  const firstAvail = sums.find((s) => s.selected)?.id;
  return (
    <div className="space-y-8">
      <section aria-label="Forecast cards" data-tour="fo-cards" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4 [&>*]:min-w-0">
        {sums.map((s) => (
          <ForecastCard key={s.id} s={s} anchor={s.id === firstAvail} />
        ))}
      </section>

      <section aria-labelledby="outlook-title" data-tour="fo-outlook" className="rounded-md border-l-4 border-accent bg-surface px-5 py-4">
        <h2 id="outlook-title" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Economic outlook
        </h2>
        <ul className="space-y-1.5 text-sm">
          {outlookStatements(sums).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <ResearchOnly>
        <div className="space-y-6" data-testid="research-view">
          <section aria-label="Reliability details" className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4 [&>*]:min-w-0">
            {sums.map((s) => (
              <div key={s.id}>
                <p className="mb-1 text-sm font-medium">
                  {FORECAST_NAMES[s.id]}
                  {s.selected ? ` · ${s.selected.modelName}${modelDetail(s.selected.modelName, s.selected.view.run) ? ` [${modelDetail(s.selected.modelName, s.selected.view.run)}]` : ""}, ${periodsText(s.selected.view.horizon, forecastMeta(s.id).frequency)}` : ""}
                </p>
                {s.selected ? <ReliabilityBanner r={s.selected.evidence} /> : <p className="rounded-md border border-rule bg-surface px-4 py-3 text-sm text-ink-muted">{s.reason || "No stored forecast."}</p>}
                {s.selected && <p className="mt-1 text-xs text-ink-muted">Selection: {s.selected.why}</p>}
              </div>
            ))}
          </section>
          <details className="rounded-md border border-rule bg-surface" open>
            <summary className={`cursor-pointer px-5 py-3 text-sm font-semibold ${focusRing}`}>Model inventory</summary>
            <div className="border-t border-rule px-5 py-4">{models.ok ? <ModelsTable models={models.data} /> : <ApiError what="the model list" error={models.error} />}</div>
          </details>
          <section className="rounded-md border border-rule bg-surface">
            <h2 className="border-b border-rule px-5 py-3 text-sm font-semibold">Latest completed experiments</h2>
            <div className="px-5 py-3">
              {runs.ok ? (
                runs.data.items.length ? (
                  <ul className="divide-y divide-rule text-sm">
                    {runs.data.items.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link href={`/forecasting/experiments/${r.id}?view=research`} className={`underline ${focusRing}`}>
                          {r.indicator?.toUpperCase()} · {r.model_name} · {r.horizon}-month {r.kind}
                        </Link>
                        <span className="figure text-xs text-ink-muted">
                          {r.n_origins ? `${r.n_origins} origin${r.n_origins === 1 ? "" : "s"} · ` : ""}
                          {r.created_at.slice(0, 10)} · run #{r.id}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-muted">No experiments have been stored yet.</p>
                )
              ) : (
                <ApiError what="experiments" error={runs.error} />
              )}
            </div>
            <p className="border-t border-rule px-5 py-2 text-xs">
              <Link href="/forecasting/experiments?view=research" className="text-accent underline">
                Open all experiments →
              </Link>
            </p>
          </section>
        </div>
      </ResearchOnly>
    </div>
  );
}

export function ForecastOverviewPage() {
  return (
    <>
      <SpotlightTour steps={FORECAST_OVERVIEW_STEPS} label="Outlook tour" />
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">India&apos;s Economic Outlook</h1>
          <p className="mt-2 text-base text-ink-muted">Where prices and production may head next, according to statistical models tested on official data.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <ForecastTourButton className={`rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-surface ${focusRing}`}>Take a tour</ForecastTourButton>
          <Link href="/" className={`text-sm text-accent underline ${focusRing}`}>
            Back to economic overview
          </Link>
        </div>
      </header>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-80 animate-pulse rounded-md border border-rule bg-surface" />}>
        <OverviewData />
      </Suspense>
      <p className="mt-8 text-xs text-ink-muted">{DISCLAIMER}</p>
    </>
  );
}

// ---------- indicator page ----------

async function IndicatorData({ id }: { id: ForecastId }) {
  const M = forecastMeta(id);
  const config = { shortName: M.shortName, indexName: M.seriesName };
  const data = await loadIndicatorForecast(id);
  if (data.error || !data.hist) return <ApiError what={`${id.toUpperCase()} forecasts`} error={data.error ?? data.histError ?? ""} />;
  const sum = summarize(data);
  if (!sum.selected) {
    const n = data.info?.n_observations ?? data.hist.observations.filter((o) => o.index !== null).length;
    return (
      <div className="space-y-6">
        <section className="rounded-md border border-rule bg-surface px-6 py-8" data-testid="not-enough-history">
          <h2 className="font-serif text-2xl font-semibold">{sum.state === "insufficient_history" ? "Not enough comparable history" : "No forecast available"}</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            {sum.state === "insufficient_history"
              ? `The current ${config.shortName} series (base ${data.hist.baseYear}) has ${n} ${M.frequency} observations, too few to test a model fairly, so no forecast is shown.`
              : sum.reason || "No experiment has been run."}
          </p>
          {OLDER_HISTORY[id] && <p className="mt-2 max-w-2xl text-sm text-ink-muted">{OLDER_HISTORY[id]}</p>}
          {sum.latest && (
            <p className="mt-4 text-sm">
              Latest official {M.frequency === "quarterly" ? "level" : "index"} <span className="figure text-lg font-medium">{M.value(sum.latest.value)}</span> <span className="text-ink-muted">({M.period(sum.latest.period, true)})</span>
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-4 text-sm">
            <Link href={indicatorHref(id)} className={`rounded border border-accent bg-accent px-3 py-1.5 font-medium text-accent-ink ${focusRing}`}>
              View historical {config.shortName}
            </Link>
            <Link href="/forecasting" className={`self-center text-accent underline ${focusRing}`}>
              Back to the outlook
            </Link>
          </div>
        </section>
        <ResearchOnly>
          <section className="rounded-md border border-rule bg-surface px-5 py-4 text-sm" data-testid="research-view">
            <h2 className="mb-2 font-semibold">Details</h2>
            <p className="text-ink-muted">{sum.reason || data.info?.reason}</p>
            <p className="mt-2 text-ink-muted">
              Months needed per horizon: {[1, 3, 6].map((h) => `${h} mo → ${monthsNeeded(h)}`).join(", ")} (18 training months + 5 backtest origins + horizon − 1). Evaluable
              horizons now: {data.info?.evaluable_horizons.length ? data.info.evaluable_horizons.join(", ") : "none"}.
            </p>
            <p className="mt-2">
              <Link href={`/forecasting/experiments?indicator=${id}&view=research`} className="text-accent underline">
                Stored {config.shortName} runs (all skipped, with reasons) →
              </Link>
            </p>
          </section>
        </ResearchOnly>
      </div>
    );
  }
  return (
    <ForecastExplorer
      indicator={id}
      shortName={config.shortName}
      indexName={config.indexName}
      axisLabel={M.frequency === "quarterly" ? `₹ lakh crore (${data.hist.baseYear} prices)` : `Index (${data.hist.baseYear} = 100)`}
      baseYear={data.hist.baseYear}
      observations={data.hist.observations}
      source={data.hist.source}
      stored={data.stored}
      runs={data.runs}
      models={data.models}
      comparisons={data.comparisons}
      trainingHistory={data.info?.training_history ?? null}
      status={data.status}
    />
  );
}

export function ForecastIndicatorPage({ id }: { id: ForecastId }) {
  const config = { shortName: forecastMeta(id).shortName };
  return (
    <>
      <header className="mb-6 max-w-3xl">
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-accent">Forecast</p>
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{FORECAST_NAMES[id]}</h1>
        <p className="mt-2 text-base text-ink-muted">{DEFINITION[id]}</p>
      </header>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse rounded-md border border-rule bg-surface" />}>
        <IndicatorData id={id} />
      </Suspense>
      <nav aria-label="Related pages" className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link href={indicatorHref(id)} className="text-accent underline">
          Historical {config.shortName} data
        </Link>
        <Link href="/forecasting" className="text-accent underline">
          Economic outlook
        </Link>
        <Link href="/" className="text-accent underline">
          Back to economic overview
        </Link>
      </nav>
    </>
  );
}

