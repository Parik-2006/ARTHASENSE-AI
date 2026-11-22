import { Suspense } from "react";
import { MonthlyDetail } from "@/components/indicators/detail/indicator-detail";
import { PageHeader } from "@/components/ui/primitives";
import type { IndicatorConfig } from "@/lib/indicators";
import { loadAllSeries } from "@/lib/series-data";

export function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading data" className="animate-pulse space-y-5">
      <div className="h-12 rounded-md border border-rule bg-surface" />
      <div className="h-20 rounded-md border border-rule bg-surface" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-80 rounded-md border border-rule bg-surface" />
        <div className="h-80 rounded-md border border-rule bg-surface" />
      </div>
    </div>
  );
}

async function Data({ config }: { config: IndicatorConfig }) {
  // Server-side: reads every stored official series via FastAPI (PostgreSQL). MoSPI is never called from here.
  const bundles = await loadAllSeries(config.key);
  return <MonthlyDetail config={config} bundles={bundles} />;
}

export function IndicatorPage({ config }: { config: IndicatorConfig }) {
  return (
    <>
      <PageHeader eyebrow="Indicators" title={config.title} />
      <Suspense fallback={<DetailSkeleton />}>
        <Data config={config} />
      </Suspense>
    </>
  );
}
