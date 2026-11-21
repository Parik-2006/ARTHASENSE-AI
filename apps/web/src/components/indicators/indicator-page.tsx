import { Suspense } from "react";
import { IndicatorSkeleton } from "@/components/indicators/indicator-dashboard";
import { IndicatorWorkspace } from "@/components/indicators/indicator-workspace";
import { PageHeader } from "@/components/ui/primitives";
import type { IndicatorConfig } from "@/lib/indicators";
import { loadAllSeries } from "@/lib/series-data";

async function Data({ config }: { config: IndicatorConfig }) {
  // Server-side: reads every stored official series via FastAPI (PostgreSQL). MoSPI is never called from here.
  const bundles = await loadAllSeries(config.key);
  return <IndicatorWorkspace config={config} bundles={bundles} />;
}

export function IndicatorPage({ config }: { config: IndicatorConfig }) {
  return (
    <>
      <PageHeader eyebrow="Indicators" title={config.title} lede={config.lede} />
      <Suspense fallback={<IndicatorSkeleton />}>
        <Data config={config} />
      </Suspense>
    </>
  );
}
