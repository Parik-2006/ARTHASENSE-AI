import type { Metadata } from "next";
import { Suspense } from "react";
import { type ComparisonMap, ComparisonView, type DefaultMap, type StatusMap } from "@/components/forecasting/comparison-view";
import { summarize } from "@/components/forecasting/forecast-pages";
import { getComparison, getForecastSeries } from "@/lib/api";
import { loadIndicatorForecast } from "@/lib/forecast-data";
import { FORECAST_IDS, FREQUENCY, HORIZONS_BY_FREQ } from "@/lib/forecasting";

export const metadata: Metadata = { title: "Model comparison" };

async function Data() {
  const combos = FORECAST_IDS.flatMap((i) => HORIZONS_BY_FREQ[FREQUENCY[i]].map((h) => ({ i, h })));
  const [results, series, loaded] = await Promise.all([
    Promise.all(combos.map(({ i, h }) => getComparison(i, h))),
    getForecastSeries(),
    Promise.all(FORECAST_IDS.map(loadIndicatorForecast)),
  ]);
  const data: ComparisonMap = {};
  combos.forEach(({ i, h }, k) => {
    const r = results[k];
    data[`${i}-${h}`] = r.ok ? r.data : null;
  });
  // The default model per indicator is computed by the SAME rule the Outlook cards and explorers use (chooseView).
  const defaults: DefaultMap = {};
  const status: StatusMap = {};
  loaded.forEach((d) => {
    const s = summarize(d);
    defaults[d.id] = s.selected ? { model: s.selected.view.model, horizon: s.selected.view.horizon } : null;
    status[d.id] = d.status;
  });
  const firstError = results.find((r) => !r.ok);
  return <ComparisonView data={data} series={series.ok ? series.data : []} defaults={defaults} status={status} apiError={firstError && !firstError.ok ? firstError.error : undefined} />;
}

export default function Page() {
  return (
    <>
      <header className="mb-6 max-w-3xl">
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Model comparison</h1>
        <p className="mt-2 text-base text-ink-muted">Eight forecasting methods, scored on past periods they had not seen. Models are compared only on identical test periods.</p>
      </header>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse rounded-md border border-rule bg-surface" />}>
        <Data />
      </Suspense>
    </>
  );
}
