import type { Metadata } from "next";
import { Suspense } from "react";
import { type ComparisonMap, ComparisonView } from "@/components/forecasting/comparison-view";
import { PageHeader } from "@/components/ui/primitives";
import { getComparison } from "@/lib/api";
import { HORIZONS, INDICATOR_IDS } from "@/lib/forecasting";

export const metadata: Metadata = { title: "Model comparison" };

async function Data() {
  const combos = INDICATOR_IDS.flatMap((i) => HORIZONS.map((h) => ({ i, h })));
  const results = await Promise.all(combos.map(({ i, h }) => getComparison(i, h)));
  const data: ComparisonMap = {};
  combos.forEach(({ i, h }, k) => {
    const r = results[k];
    data[`${i}-${h}`] = r.ok ? r.data : null;
  });
  const firstError = results.find((r) => !r.ok);
  return <ComparisonView data={data} apiError={firstError && !firstError.ok ? firstError.error : undefined} />;
}

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Forecasting"
        title="Model comparison"
        lede="Models are compared only when they were tested on identical data and forecast origins. Small evaluation sets are flagged, never ranked."
      />
      <Suspense
        fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse rounded-md border border-rule bg-surface" />}
      >
        <Data />
      </Suspense>
    </>
  );
}
