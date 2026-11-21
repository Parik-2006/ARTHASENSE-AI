import { TrendChart } from "@/components/indicators/indicator-dashboard";
import { SourceAttribution } from "@/components/source/source-attribution";
import { Panel } from "@/components/ui/primitives";
import { formatPeriod, type IndicatorResult, latestObservation, withMomChange } from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";
import { sourceFor } from "@/lib/source";

/** The previous base year of WPI / IIP (2011-12), shown as its OWN segment. It is never drawn on the same
 *  line as the current base: index levels on different base years are not comparable, and no change is
 *  calculated across the boundary. Official linking factors exist but are deliberately not applied here. */
export function LegacyBasePanel({ config, result }: { config: IndicatorConfig; result: IndicatorResult | null }) {
  if (!result) return null;
  const rows = result.ok ? withMomChange(result.data.observations).filter((r) => r.index !== null) : [];
  const title = "Previous base year (separate segment)";
  if (!result.ok || rows.length === 0) {
    return (
      <Panel title={title}>
        <p className="text-sm text-ink-muted">
          No previous-base {config.shortName} observations are stored in this database, so only the current base is
          shown. Nothing has been estimated for earlier months.
        </p>
      </Panel>
    );
  }
  const { data } = result;
  const first = rows[0];
  const last = latestObservation(rows)!;
  const src = { ...sourceFor(config, data), coverage: `${data.coverage} · previous base year` };
  return (
    <Panel
      title={`${title}: base ${data.baseYear}`}
      footnote={
        <SourceAttribution
          cls="official"
          sources={[src]}
          period={`${formatPeriod(first.period)} – ${formatPeriod(last.period)}`}
          units={`Index, base ${data.baseYear} = 100`}
          note="Previous-base series as published. Shown on its own scale and not joined to the current base."
        />
      }
    >
      <p className="-mt-1 mb-3 text-sm text-ink-muted" data-testid="legacy-note">
        {rows.length} months, {formatPeriod(first.period, true)} to {formatPeriod(last.period, true)}, on base{" "}
        {data.baseYear}. The two bases overlap in time but their index levels are not comparable, so they are kept
        apart: no line, monthly or yearly change crosses between them. The publisher documents linking factors;
        none is applied on this page.
      </p>
      <TrendChart rows={rows} axisLabel={`${config.shortName} base ${data.baseYear} = 100`} name={`${config.shortName} previous base`} />
    </Panel>
  );
}
