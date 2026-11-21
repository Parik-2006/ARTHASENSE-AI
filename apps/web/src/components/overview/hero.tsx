import Link from "next/link";
import { HelpTip } from "@/components/guide/help-tip";
import { TourButton } from "@/components/guide/tour";

const action =
  "inline-flex items-center rounded border px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function OverviewHero() {
  return (
    <header data-tour="hero" className="border-b border-rule pb-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">Overview</p>
      <h1 className="font-serif text-4xl leading-[1.15] font-semibold tracking-tight sm:text-5xl">India&apos;s Economy, Explained</h1>
      <p className="mt-3 max-w-3xl text-base text-ink-muted">
        Explore official economic data, understand what is changing, and see what evaluated forecasting models suggest could happen next.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/indicators" className={`${action} border-accent bg-accent text-accent-ink`}>
          Explore Indicators
        </Link>
        <Link href="/forecasting" className={`${action} border-rule hover:border-accent`}>
          View Forecasts
        </Link>
        <TourButton className={`${action} border-rule hover:border-accent`}>Take a Tour</TourButton>
      </div>
      <ul className="mt-5 grid gap-2 text-sm text-ink-muted sm:grid-cols-3">
        <li className="rounded-md border border-rule bg-surface px-3 py-2">
          <span className="font-medium text-ink">Coverage.</span> Currently tracking CPI, WPI and IIP. GDP and repo-rate coverage is planned.
        </li>
        <li className="rounded-md border border-rule bg-surface px-3 py-2">
          <span className="font-medium text-ink">Observations vs forecasts.</span> Official data and model-generated forecasts are always labelled separately.
          <HelpTip id="forecast" />
        </li>
        <li className="rounded-md border border-rule bg-surface px-3 py-2">
          <span className="font-medium text-ink">Freshness differs.</span> Each indicator has its own latest month. See Data Coverage below.
        </li>
      </ul>
    </header>
  );
}
