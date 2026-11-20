import Link from "next/link";
import { Suspense } from "react";
import { IndicatorSummary } from "@/components/indicators/indicator-summary";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { CONFIG_LIST } from "@/lib/indicators";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="India's economy, measured and forecast with stated uncertainty"
        lede="ArthaSense shows official statistics with their source and release date, forecasts from evaluated models, and a public record of how those forecasts performed."
      />

      <section aria-label="Latest official figures" className="grid gap-4 md:grid-cols-3">
        {CONFIG_LIST.map((config) => (
          <Suspense
            key={config.key}
            fallback={<div className="h-36 animate-pulse rounded-md border border-rule bg-surface" />}
          >
            <IndicatorSummary config={config} />
          </Suspense>
        ))}
      </section>
      <p className="mt-2 text-xs text-ink-muted">
        Each card shows its own import status. Each index has its own base year, so levels are not comparable
        between cards. GDP and the repo rate are not yet ingested.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Panel title="What it will explain">
          <p className="text-sm text-ink-muted">
            Latest CPI, IIP, WPI, GDP and repo-rate figures. Each one shows the publisher, the
            statistical base year and the release date.
          </p>
        </Panel>
        <Panel title="What it will forecast">
          <p className="text-sm text-ink-muted">
            CPI inflation first, then IIP. Forecasts come from SARIMA, XGBoost, Chronos-2 and
            TimesFM 2.5, are computed offline and stored, and always carry prediction intervals.
          </p>
        </Panel>
        <Panel title="How reliable it is">
          <p className="text-sm text-ink-muted">
            The Report Card scores every stored forecast once the official figure is released.
            Forecasts are never edited after the fact.
          </p>
        </Panel>
      </div>

      <p className="mt-8 text-sm text-ink-muted">
        Developers: check the <Link href="/status" className="text-accent underline">system status</Link>{" "}
        page to confirm the API and database are reachable.
      </p>
    </>
  );
}
