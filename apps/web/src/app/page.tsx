import Link from "next/link";
import { Suspense } from "react";
import { Tour } from "@/components/guide/tour";
import { IndicatorCard } from "@/components/overview/cards";
import { CoveragePanel } from "@/components/overview/coverage";
import { OverviewExplorer } from "@/components/overview/explorer";
import { ForecastSection, ReliabilitySection } from "@/components/overview/forecast-section";
import { OverviewHero } from "@/components/overview/hero";
import { InsightsSection } from "@/components/overview/insights";
import { OVERVIEW_TOUR } from "@/lib/guide";
import { loadBundles } from "@/lib/overview-data";

const Skeleton = ({ h }: { h: string }) => <div aria-hidden className={`${h} mt-8 animate-pulse rounded-md border border-rule bg-surface`} />;

const DEEPER = [
  { href: "/indicators", label: "Indicators", text: "Full history and tables for CPI, WPI and IIP." },
  { href: "/forecasting", label: "Forecasts", text: "Stored forecasts, intervals and model comparison." },
  { href: "/intelligence", label: "Intelligence", text: "Plain-language statements built from stored data." },
  { href: "/report-card", label: "Report Card", text: "How past forecasts scored against official figures." },
  { href: "/scenarios", label: "Scenarios", text: "Explore hypothetical paths, clearly marked as such." },
  { href: "/methodology", label: "Methodology", text: "Sources, definitions and limitations." },
];

async function OverviewBody() {
  const bundles = await loadBundles();
  return (
    <>
      <section id="cards" data-tour="cards" aria-label="Latest official figures" className="mt-8">
        <div className="grid gap-4 lg:grid-cols-3">
          {bundles.map((b, i) => (
            <IndicatorCard key={b.key} bundle={b} first={i === 0} />
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Each card shows its own latest month and base year, so index levels are not comparable between cards, and an index level is not a percentage rate.
        </p>
      </section>

      <Suspense fallback={<Skeleton h="h-96" />}>
        <OverviewExplorer bundles={bundles} />
      </Suspense>

      <InsightsSection bundles={bundles} />

      <Suspense fallback={<Skeleton h="h-80" />}>
        <ForecastSection bundles={bundles} />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-64" />}>
        <ReliabilitySection bundles={bundles} />
      </Suspense>

      <CoveragePanel bundles={bundles} />
    </>
  );
}

export default function OverviewPage() {
  return (
    <>
      <Tour steps={OVERVIEW_TOUR} />
      <OverviewHero />
      <Suspense fallback={<Skeleton h="h-72" />}>
        <OverviewBody />
      </Suspense>

      <section aria-labelledby="deeper-h" className="mt-12">
        <h2 id="deeper-h" className="font-serif text-2xl font-semibold tracking-tight">Explore deeper</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEEPER.map((d) => (
            <li key={d.href}>
              <Link href={d.href} className="block h-full rounded-md border border-rule bg-surface p-4 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
                <span className="font-medium text-accent">{d.label} →</span>
                <span className="mt-1 block text-sm text-ink-muted">{d.text}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-ink-muted">
          ArthaSense AI is a research and education tool. Official figures come from the publishers named beside each chart; calculated values and model forecasts are produced by ArthaSense and are not official statistics or financial advice. Developers: see the{" "}
          <Link href="/status" className="text-accent underline">system status</Link> page.
        </p>
      </section>
    </>
  );
}
