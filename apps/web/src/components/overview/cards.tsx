import Link from "next/link";
import { HelpTip } from "@/components/guide/help-tip";
import { Sparkline } from "@/components/indicators/indicator-summary";
import { periodSpan, SourceAttribution } from "@/components/source/source-attribution";
import { formatIndex, formatPeriod, latestObservation } from "@/lib/indicator";
import type { IndicatorBundle } from "@/lib/overview-data";
import { derive, fmtPct } from "@/lib/overview";

const RATE_UNAVAILABLE: Record<string, string> = {
  cpi: "Official inflation unavailable",
  wpi: "Official WPI inflation unavailable",
  iip: "Official industrial growth unavailable",
};
const RATE_NAME: Record<string, string> = {
  cpi: "Official year-on-year inflation",
  wpi: "Official year-on-year inflation",
  iip: "Official year-on-year growth",
};

/** Latest-observation card. Uses the same selector (`latestObservation`) as the indicator pages. */
export function IndicatorCard({ bundle: b, first }: { bundle: IndicatorBundle; first: boolean }) {
  const seg = b.segments[0];
  const obs = seg?.observations ?? [];
  const latest = latestObservation(obs);
  const rows = derive(obs);
  const latestRow = latest ? rows.find((r) => r.period === latest.period) : undefined;
  const momRow = [...rows].reverse().find((r) => r.mom !== null);
  const rateRow = [...rows].reverse().find((r) => r.rate !== null);
  const valid = rows.filter((r) => r.index !== null);

  return (
    <article aria-label={`${b.fullName} summary`} data-tour={first ? "card-index" : undefined} className="flex min-w-0 flex-col rounded-md border border-rule bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">
            {b.shortName} <span className="font-normal text-ink-muted">· {b.fullName}</span>
            <HelpTip id={b.key} />
          </h3>
          <p className="mt-1 text-sm text-ink-muted">{b.plain}</p>
        </div>
      </div>

      {b.error ? (
        <p role="alert" className="mt-4 text-sm text-up">Unable to load {b.shortName} data. Please check the API connection.</p>
      ) : !latest || !latestRow ? (
        <p className="mt-4 text-sm text-ink-muted">No {b.shortName} observations have been imported yet.</p>
      ) : (
        <>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-ink-muted">
                Latest index<HelpTip id="index-value" /> · Base {seg.baseYear}
                <HelpTip id="base-year" />
              </p>
              <p className="figure text-4xl font-medium tracking-tight">{formatIndex(latest.index)}</p>
              <p className="text-sm">{formatPeriod(latest.period, true)}</p>
            </div>
            <Sparkline values={valid.map((r) => ({ n: r.n, v: r.index as number }))} />
          </div>

          <dl className="mt-4 space-y-2 border-t border-rule pt-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt className="text-ink-muted">Month-over-month<HelpTip id="mom" /> <span className="text-[11px]">(calculated)</span></dt>
              <dd className="figure">
                {momRow ? (
                  <>
                    {fmtPct(momRow.mom)}
                    {momRow.period !== latest.period && <span className="ml-1 text-xs text-ink-muted">({formatPeriod(momRow.period)})</span>}
                  </>
                ) : (
                  <span className="text-ink-muted">Not available</span>
                )}
              </dd>
            </div>
            {!momRow && <p className="text-xs text-ink-muted">Needs two consecutive stored months.</p>}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt className="text-ink-muted">{RATE_NAME[b.key]}<HelpTip id="yoy" /> <span className="text-[11px]">(official)</span></dt>
              <dd className="figure">
                {rateRow ? (
                  <>
                    {fmtPct(rateRow.rate)}
                    <span className="ml-1 text-xs text-ink-muted">({formatPeriod(rateRow.period)})</span>
                  </>
                ) : (
                  <span className="text-ink-muted">{RATE_UNAVAILABLE[b.key]}</span>
                )}
              </dd>
            </div>
          </dl>
        </>
      )}

      <SourceAttribution
        className="mt-auto pt-4"
        cls="official"
        sources={[b.source]}
        period={periodSpan(valid[0]?.period ?? null, valid[valid.length - 1]?.period ?? null)}
        units="Index points"
        method={rows.some((r) => r.mom !== null) ? "Monthly change is calculated by ArthaSense from the official index." : undefined}
      />
      <Link href={b.path} className="mt-3 inline-block rounded text-sm font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
        {b.shortName} Intelligence →
      </Link>
    </article>
  );
}
