import Link from "next/link";
import { getIndicatorHistory } from "@/lib/api";
import {
  formatIndex,
  formatPeriod,
  formatTimestamp,
  type IndicatorResult,
  lastRetrievedAt,
  latestObservation,
  monthNumber,
} from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";

/** Tiny trend line of the stored index. Gaps in the months break the line. */
export function Sparkline({ values }: { values: { n: number; v: number }[] }) {
  if (values.length < 2) return null;
  const [n0, n1] = [values[0].n, values[values.length - 1].n];
  const [lo, hi] = [Math.min(...values.map((p) => p.v)), Math.max(...values.map((p) => p.v))];
  const [w, h] = [120, 32];
  const x = (n: number) => 2 + ((n - n0) / (n1 - n0)) * (w - 4);
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (h - 4);
  const segs: string[][] = [];
  values.forEach((p, i) => {
    const pt = `${x(p.n)},${y(p.v)}`;
    if (i > 0 && p.n - values[i - 1].n === 1) segs[segs.length - 1].push(pt);
    else segs.push([pt]);
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className="shrink-0">
      {segs.map((s, i) => (
        <polyline key={i} points={s.join(" ")} fill="none" className="stroke-accent" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

/** Presentational part (testable without network). */
export function IndicatorSummaryView({ config, result }: { config: IndicatorConfig; result: IndicatorResult }) {
  const rows = result.ok ? result.data.observations : [];
  const latest = latestObservation(rows);
  const retrieved = lastRetrievedAt(rows);
  const base = result.ok ? result.data.baseYear : null;
  return (
    <section
      aria-label={`${config.title} summary`}
      className="flex flex-col rounded-md border border-rule bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted">
            {config.indexCard}
            {base ? ` · Base ${base}` : ""}
          </p>
          {!result.ok ? (
            <p className="mt-2 text-sm text-up">
              Unable to load {config.shortName} data. Please check the API connection.
            </p>
          ) : !latest ? (
            <p className="mt-2 text-sm text-ink-muted">{config.empty}</p>
          ) : (
            <>
              <p className="figure mt-1 text-4xl font-medium tracking-tight">{formatIndex(latest.index)}</p>
              <p className="mt-1 text-sm">{formatPeriod(latest.period, true)}</p>
            </>
          )}
        </div>
        {latest && (
          <Sparkline
            values={rows
              .filter((r) => r.index !== null)
              .map((r) => ({ n: monthNumber(r.period), v: r.index as number }))}
          />
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3 text-xs text-ink-muted">
        <span>
          Source: {config.sourceShort}
          {retrieved && <> · retrieved {formatTimestamp(retrieved)}</>}
        </span>
        <Link
          href={config.path}
          className="rounded text-sm font-medium text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {config.navLabel} →
        </Link>
      </div>
    </section>
  );
}

export async function IndicatorSummary({ config }: { config: IndicatorConfig }) {
  return <IndicatorSummaryView config={config} result={await getIndicatorHistory(config)} />;
}
