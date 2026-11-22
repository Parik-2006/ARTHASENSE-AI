import Link from "next/link";
import { Suspense } from "react";
import { Tour, TourButton } from "@/components/guide/tour";
import { OverviewV3 } from "@/components/overview/v3/overview-v3";
import { getGdp } from "@/lib/api";
import { OVERVIEW_TOUR } from "@/lib/guide";
import { loadBundles } from "@/lib/overview-data";

async function Body() {
  const [bundles, gdp] = await Promise.all([loadBundles(), getGdp()]);
  return <OverviewV3 bundles={bundles} gdp={gdp} />;
}

export default function OverviewPage() {
  return (
    <>
      <Tour steps={OVERVIEW_TOUR} />
      <header data-tour="hero" className="border-b border-rule pb-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">Overview</p>
        <h1 className="font-serif text-4xl leading-[1.15] font-semibold tracking-tight sm:text-5xl">India&apos;s Economy, Explained</h1>
        <p className="mt-3 max-w-3xl text-base text-ink-muted">Official data on prices, production and growth. Select an indicator to explore it.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <TourButton className="inline-flex items-center rounded border border-rule px-3 py-1.5 font-medium hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Take a tour</TourButton>
          <Link href="/indicators" className="text-accent underline">All indicators</Link>
          <Link href="/forecasting" className="text-accent underline">Forecasts</Link>
        </div>
      </header>
      <Suspense fallback={<div aria-hidden className="mt-8 h-96 animate-pulse rounded-md border border-rule bg-surface" />}>
        <Body />
      </Suspense>
      <p className="mt-10 text-xs text-ink-muted">
        Official figures come from the publisher named beside each chart. Calculated values are produced by ArthaSense and are not official statistics or financial advice.
      </p>
    </>
  );
}
