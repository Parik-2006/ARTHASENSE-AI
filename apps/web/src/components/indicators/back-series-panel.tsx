import { TrendChart } from "@/components/indicators/indicator-dashboard";
import { SourceAttribution } from "@/components/source/source-attribution";
import { Panel } from "@/components/ui/primitives";
import { formatPeriod, type IndicatorResult, latestObservation, withMomChange } from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";
import { sourceFor } from "@/lib/source";

/** MoSPI's official CPI Back series, shown as its OWN segment. It is never joined to the Current
 *  series: no line, MoM or YoY crosses the boundary, so a base or method change cannot create a fake jump. */
export function BackSeriesPanel({ config, result }: { config: IndicatorConfig; result: IndicatorResult | null }) {
  if (!result) return null;
  const rows = result.ok ? withMomChange(result.data.observations).filter((r) => r.index !== null) : [];
  if (!result.ok || rows.length === 0) {
    return (
      <Panel title="Official back series (separate segment)">
        <p className="text-sm text-ink-muted">
          MoSPI&apos;s official back series is not stored in this database, so only the Current series is shown. Nothing
          has been estimated for earlier months.
        </p>
      </Panel>
    );
  }
  const { data } = result;
  const first = rows[0];
  const last = latestObservation(rows)!;
  const src = {
    ...sourceFor(config, data),
    seriesIds: ["mospi.cpi.2024.back.all_india.combined.general.index", "mospi.cpi.2024.back.all_india.combined.general.inflation_yoy"],
    coverage: `${data.coverage} · official back series`,
  };
  return (
    <Panel
      title="Official back series (separate segment)"
      footnote={
        <SourceAttribution
          cls="official"
          sources={[src]}
          period={`${formatPeriod(first.period)} – ${formatPeriod(last.period)}`}
          units={`Index, base ${data.baseYear} = 100`}
          note="Back series as published by MoSPI. It is shown separately from the Current series and is not joined to it."
        />
      }
    >
      <p className="-mt-1 mb-3 text-sm text-ink-muted">
        {rows.length} months, {formatPeriod(first.period, true)} to {formatPeriod(last.period, true)}. Kept apart from the
        Current series above: the join is not assumed to be statistically seamless, so no change is calculated across it.
      </p>
      <TrendChart rows={rows} axisLabel={`CPI back series (${data.baseYear} = 100)`} name="CPI back series" />
    </Panel>
  );
}
