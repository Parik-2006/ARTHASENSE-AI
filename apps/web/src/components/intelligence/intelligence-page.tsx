import Link from "next/link";
import { Suspense } from "react";
import { ScenarioCalculator, type ScenarioStart } from "@/components/intelligence/scenario";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { getComparison, getForecastModels, getIndicator, getLatestForecast, getRuns } from "@/lib/api";
import { beatsBaseline, INDICATOR_IDS, type IndicatorId, type Statement } from "@/lib/forecasting";
import { forecastStatements, observedStatements } from "@/lib/intelligence";
import { latestObservation, withMomChange } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";

const TAG: Record<Statement["kind"], string> = {
  observed: "Official / observed",
  derived: "Derived from stored values",
  forecast: "Model forecast",
};
const TAG_CLASS: Record<Statement["kind"], string> = {
  observed: "border-ok text-ok",
  derived: "border-rule text-ink-muted",
  forecast: "border-target text-target",
};

export function StatementList({ items }: { items: Statement[] }) {
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.text} className="flex flex-col gap-1 text-sm sm:flex-row sm:gap-3">
          <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TAG_CLASS[s.kind]}`}>{TAG[s.kind]}</span>
          <span>{s.text}</span>
        </li>
      ))}
    </ul>
  );
}

const PREFERRED_MODEL = "ets";

async function Section({ id }: { id: IndicatorId }) {
  const config = CONFIGS[id];
  const hist = await getIndicator(id, config.apiQuery);
  if (!hist.ok) {
    return (
      <Panel title={config.title}>
        <p role="alert" className="text-sm text-up">Unable to load {config.shortName} data. Please check the API connection.</p>
      </Panel>
    );
  }
  const rows = withMomChange(hist.data.observations);
  const latest = latestObservation(rows);
  const observed = observedStatements(config.shortName, hist.data.baseYear, rows, id === "iip" ? "year-on-year growth" : id === "cpi" ? "year-on-year inflation" : null);
  if (id === "wpi") observed.push({ kind: "observed", text: "The source provides no official WPI inflation figure; none is shown." });

  // Forecast: use a stored genuine-future forecast only. Never compute one here.
  let forecastBlock: Statement[] = [];
  let note = "";
  const [runs, models] = await Promise.all([getRuns(`?indicator=${id}&kind=forecast&status=completed&limit=50`), getForecastModels()]);
  if (runs.ok && models.ok && runs.data.items.length > 0) {
    const modelIds = [...new Set(runs.data.items.map((r) => r.model))];
    const pick = modelIds.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : modelIds[0];
    const run = runs.data.items.find((r) => r.model === pick);
    if (run) {
      const horizon = Math.min(run.horizon, 3);
      const [fc, cmp] = await Promise.all([getLatestForecast(id, pick, run.horizon), getComparison(id, horizon)]);
      if (fc.ok && fc.data.run) {
        const beats = beatsBaseline(cmp.ok ? cmp.data : null, pick);
        const grp = cmp.ok ? cmp.data.groups.find((g) => g.models.some((m) => m.model === pick)) : undefined;
        forecastBlock = forecastStatements({
          name: config.shortName, modelName: models.data.find((m) => m.id === pick)?.name ?? pick,
          latestIndex: latest?.index ?? null, items: fc.data.items, horizon, run: fc.data.run,
          beatsNaive: beats, backtestOrigins: grp?.n_origins ?? null,
        }); // prettier-ignore
        note = `Forecast statements use the ${horizon}-month horizon.`;
      }
    }
  }
  return (
    <Panel title={config.title.replace(" Intelligence", "")} footnote={note || undefined}>
      <StatementList items={[...observed, ...forecastBlock]} />
      {forecastBlock.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          No stored forecast exists for {config.shortName}. {id === "cpi" ? "The CPI Current series has too little history to evaluate any model." : "Run a forecasting experiment to add one."}
        </p>
      )}
      <p className="mt-3 text-sm">
        <Link href={config.path} className="underline">{config.shortName} data</Link> · <Link href={`/forecasting/${id}`} className="underline">{config.shortName} forecasts</Link>
      </p>
    </Panel>
  );
}

async function Scenario() {
  const results = await Promise.all(INDICATOR_IDS.map((id) => getIndicator(id, CONFIGS[id].apiQuery)));
  const starts: ScenarioStart[] = [];
  results.forEach((r, i) => {
    if (!r.ok) return;
    const last = latestObservation(r.data.observations);
    if (last && last.index !== null) starts.push({ id: INDICATOR_IDS[i], name: CONFIGS[INDICATOR_IDS[i]].title.replace(" Intelligence", ""), index: last.index, period: last.period });
  });
  return <ScenarioCalculator starts={starts} />;
}

export function IntelligencePage() {
  const fallback = <div role="status" aria-label="Loading" className="h-40 animate-pulse rounded-md border border-rule bg-surface" />;
  return (
    <>
      <PageHeader
        eyebrow="Decision support"
        title="Economic Intelligence"
        lede="Plain-language readings of the stored data and forecasts. Every statement is filled from numbers in the database and labelled as official, derived or forecast."
      />
      <p className="mb-6 rounded-md border border-rule bg-surface px-4 py-3 text-sm text-ink-muted">
        These statements are template-based, not written by an AI language model, and they are not investment or policy
        advice. Forecasts are estimates and can be wrong; each one names its model and forecast origin.
      </p>
      <div className="space-y-6">
        {INDICATOR_IDS.map((id) => (
          <Suspense key={id} fallback={fallback}>
            <Section id={id} />
          </Suspense>
        ))}
        <Suspense fallback={fallback}>
          <Scenario />
        </Suspense>
      </div>
    </>
  );
}
