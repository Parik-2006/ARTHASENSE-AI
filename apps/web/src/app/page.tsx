import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Tour, TourButton } from "@/components/guide/tour";
import { OverviewFinal } from "@/components/overview/overview-final";
import { getGdp } from "@/lib/api";
import { OVERVIEW_TOUR } from "@/lib/guide";
import { pathFor, VIEW_KEYS, type ViewKey } from "@/lib/indicator-view";
import { loadBundles } from "@/lib/overview-data";

type Search = Promise<Record<string, string | string[] | undefined>>;

async function Body({ searchParams }: { searchParams: Search }) {
  // Old Overview V3 links (?open=cpi&base=…) open the matching Indicators view instead of an expanded chart.
  const sp = await searchParams;
  const open = typeof sp.open === "string" ? sp.open : null;
  if (open && (VIEW_KEYS as readonly string[]).includes(open)) {
    const carry = new URLSearchParams();
    for (const k of ["base", "range", "from", "to"]) if (typeof sp[k] === "string") carry.set(k, sp[k] as string);
    const q = carry.toString();
    redirect(`${pathFor(open as ViewKey)}${q ? `?${q}` : ""}`);
  }
  const [bundles, gdp] = await Promise.all([loadBundles(), getGdp()]);
  return <OverviewFinal bundles={bundles} gdp={gdp} />;
}

export default function OverviewPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <Tour steps={OVERVIEW_TOUR} />
      <header data-tour="hero" className="border-b border-rule pb-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">Overview</p>
        <h1 className="font-serif text-4xl leading-[1.15] font-semibold tracking-tight sm:text-5xl">India&apos;s Economy, Explained</h1>
        <p className="mt-3 max-w-3xl text-base text-ink-muted">A quick snapshot of official prices, production and growth data from the Government of India.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <TourButton className="inline-flex items-center rounded border border-rule px-3 py-1.5 font-medium hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Take a tour</TourButton>
          <Link href="/indicators" className="text-accent underline">All indicators</Link>
        </div>
      </header>
      <Suspense fallback={<div aria-hidden className="mt-8 h-96 animate-pulse rounded-md border border-rule bg-surface" />}>
        <Body searchParams={searchParams} />
      </Suspense>
      <p className="mt-10 text-xs text-ink-muted">
        Official figures come from the publisher named beside each chart. Calculated values are produced by ArthaSense and are not official statistics or financial advice.
      </p>
    </>
  );
}
