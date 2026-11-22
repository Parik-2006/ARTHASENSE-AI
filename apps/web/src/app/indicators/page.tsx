import type { Metadata } from "next";
import { Suspense } from "react";
import { IndicatorsOverview } from "@/components/indicators/indicators-overview";
import { PageHeader } from "@/components/ui/primitives";
import { loadAllSeries } from "@/lib/series-data";
import { CONFIG_LIST } from "@/lib/indicators";

export const metadata: Metadata = { title: "Indicators" };

async function Overview() {
  // One shared loader: the hub, Overview V2 and the detail pages all read the same stored series.
  const all = await Promise.all(CONFIG_LIST.map(async (config) => [config, await loadAllSeries(config.key)] as const));
  const entries = all.map(([config, bundles]) => ({ config, result: bundles[0].result }));
  const allSeries = Object.fromEntries(all.map(([config, bundles]) => [config.key, bundles]));
  return <IndicatorsOverview entries={entries} allSeries={allSeries} />;
}

export default function IndicatorsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Indicators"
        title="Indicators"
        lede="Official statistics on prices, industrial output and growth (CPI, WPI, IIP and GDP), each shown on its own base year with its source and retrieval time."
      />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-md border border-rule bg-surface" />}>
        <Overview />
      </Suspense>
    </>
  );
}
