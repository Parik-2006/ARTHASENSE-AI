import Link from "next/link";
import { StatusPill, type StatusTone } from "@/components/ui/primitives";
import {
  formatIndex,
  formatPeriod,
  formatTimestamp,
  type IndicatorResult,
  lastRetrievedAt,
  latestObservation,
} from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";

export interface OverviewEntry {
  config: IndicatorConfig;
  result: IndicatorResult;
}

function status(result: IndicatorResult): { tone: StatusTone; text: string } {
  if (!result.ok) return { tone: "down", text: "API unavailable" };
  if (!latestObservation(result.data.observations)) return { tone: "warn", text: "No data imported" };
  return { tone: "ok", text: "Available" };
}

/** Latest stored value of each indicator. Index levels use different bases: they are not comparable. */
export function IndicatorsOverview({ entries }: { entries: OverviewEntry[] }) {
  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-rule bg-surface">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Latest stored value of each indicator</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs">
              <th scope="col" className="px-4 py-2 font-semibold">Indicator</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Latest index</th>
              <th scope="col" className="px-4 py-2 font-semibold">Latest period</th>
              <th scope="col" className="px-4 py-2 font-semibold">Base year</th>
              <th scope="col" className="px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ config, result }) => {
              const latest = result.ok ? latestObservation(result.data.observations) : null;
              const st = status(result);
              const retrieved = result.ok ? lastRetrievedAt(result.data.observations) : null;
              return (
                <tr key={config.key} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link
                      href={config.path}
                      className="font-serif text-lg font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {config.shortName}
                    </Link>
                    <span className="block text-xs text-ink-muted">{config.overviewBlurb}</span>
                  </th>
                  <td className="figure px-4 py-3 text-right">
                    {latest ? formatIndex(latest.index) : <span className="text-ink-muted">Unavailable</span>}
                  </td>
                  <td className="px-4 py-3">
                    {latest ? formatPeriod(latest.period, true) : <span className="text-ink-muted">Unavailable</span>}
                    {retrieved && <span className="block text-xs text-ink-muted">retrieved {formatTimestamp(retrieved)}</span>}
                  </td>
                  <td className="figure px-4 py-3">{result.ok ? result.data.baseYear : "—"}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={st.tone}>{st.text}</StatusPill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Each index has its own base year and scale, so levels must not be compared between indicators.
        Open an indicator for its history, methodology and downloadable data.
      </p>
    </div>
  );
}
