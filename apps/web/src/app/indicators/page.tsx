import type { Metadata } from "next";
import { Suspense } from "react";
import { IndicatorsOverview } from "@/components/indicators/indicators-overview";
import { PageHeader } from "@/components/ui/primitives";
import { getIndicator } from "@/lib/api";
import { CONFIG_LIST } from "@/lib/indicators";

export const metadata: Metadata = { title: "Indicators" };

async function Overview() {
  const entries = await Promise.all(
    CONFIG_LIST.map(async (config) => ({ config, result: await getIndicator(config.key, config.apiQuery) })),
  );
  return <IndicatorsOverview entries={entries} />;
}

export default function IndicatorsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Indicators"
        title="Indicators"
        lede="Official monthly statistics, each shown on its own base year with its source and retrieval time. GDP and the repo rate are not ingested yet."
      />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-md border border-rule bg-surface" />}>
        <Overview />
      </Suspense>
    </>
  );
}
