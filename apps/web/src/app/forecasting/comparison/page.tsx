import type { Metadata } from "next";
import { Suspense } from "react";
import { type ComparisonMap, ComparisonView } from "@/components/forecasting/comparison-view";
import { getComparison, getForecastSeries } from "@/lib/api";
import { HORIZONS, INDICATOR_IDS } from "@/lib/forecasting";

export const metadata: Metadata = { title: "Model comparison" };

async function Data() {
  const combos = INDICATOR_IDS.flatMap((i) => HORIZONS.map((h) => ({ i, h })));
  const [results, series] = await Promise.all([Promise.all(combos.map(({ i, h }) => getComparison(i, h))), getForecastSeries()]);
  const data: ComparisonMap = {};
  combos.forEach(({ i, h }, k) => {
    const r = results[k];
    data[`${i}-${h}`] = r.ok ? r.data : null;
  });
  const firstError = results.find((r) => !r.ok);
  return <ComparisonView data={data} series={series.ok ? series.data : []} apiError={firstError && !firstError.ok ? firstError.error : undefined} />;
}

export default function Page() {
  return (
    <>
      <header className="mb-6 max-w-3xl">
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Model comparison</h1>
        <p className="mt-2 text-base text-ink-muted">How accurate each model was on past months it had not seen. Models are compared only on identical test months.</p>
      </header>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse rounded-md border border-rule bg-surface" />}>
        <Data />
      </Suspense>
    </>
  );
}
