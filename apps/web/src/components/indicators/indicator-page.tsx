import { Suspense } from "react";
import { IndicatorDashboard, IndicatorSkeleton } from "@/components/indicators/indicator-dashboard";
import { IipSectorPanel } from "@/components/indicators/iip-sector-panel";
import { PageHeader } from "@/components/ui/primitives";
import { getIipSectors, getIndicator } from "@/lib/api";
import type { IndicatorConfig } from "@/lib/indicators";

async function Data({ config }: { config: IndicatorConfig }) {
  // Server-side: reads stored observations via FastAPI. MoSPI is never called from here.
  const [result, sectors] = await Promise.all([
    getIndicator(config.key, config.apiQuery),
    config.key === "iip" ? getIipSectors() : Promise.resolve(null),
  ]);
  return (
    <IndicatorDashboard config={config} result={result}>
      {sectors && <IipSectorPanel result={sectors} />}
    </IndicatorDashboard>
  );
}

export function IndicatorPage({ config }: { config: IndicatorConfig }) {
  return (
    <>
      <PageHeader
        eyebrow="Indicators"
        title={config.title}
        lede={config.lede}
        aside={
          <ul aria-label="Dataset" className="flex max-w-md flex-wrap gap-1.5 sm:justify-end">
            {config.chips.map((c) => (
              <li key={c} className="rounded border border-rule bg-surface px-2 py-0.5 text-xs text-ink-muted">
                {c}
              </li>
            ))}
          </ul>
        }
      />
      <Suspense fallback={<IndicatorSkeleton />}>
        <Data config={config} />
      </Suspense>
    </>
  );
}
