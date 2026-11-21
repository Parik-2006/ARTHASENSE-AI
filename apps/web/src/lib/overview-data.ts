/** Server-side loader for Overview V2. Everything comes from the existing indicator endpoints
 *  (FastAPI reading PostgreSQL). Every stored base year / series is requested through the shared series
 *  registry; each becomes its own segment (never merged). */

import type { IndicatorKey, Observation } from "@/lib/indicator";
import { CONFIG_LIST, type IndicatorConfig } from "@/lib/indicators";
import { loadAllSeries } from "@/lib/series-data";
import { type SourceInfo, sourceFor } from "@/lib/source";

/** Source-level provenance is summarised in SourceInfo; each row keeps only its index snapshot (release key and retrieval time) for CSV export. */
const slim = (o: Observation): Observation => ({ ...o, rateSource: null }); // keep indexSource: needed for per-row CSV provenance

export interface Segment {
  id: string;
  /** e.g. "Base 2022-23" */
  label: string;
  baseYear: string;
  /** Which stored series this is as the API names it (CPI: current | back | legacy2012). */
  series?: string | null;
  coverage: string;
  observations: Observation[];
}

export interface IndicatorBundle {
  key: IndicatorKey;
  shortName: string;
  fullName: string;
  plain: string;
  path: string;
  error: string | null;
  /** Newest / current base first. segments[0] is the primary series used for cards and comparisons. */
  segments: Segment[];
  source: SourceInfo;
  rateKind: "inflation" | "growth" | null;
  rateLabel: string | null;
  rateMissingText: string;
  units: string;
}

const FULL: Record<IndicatorKey, { name: string; plain: string; rate: "inflation" | "growth" | null }> = {
  cpi: { name: "Consumer Price Index", plain: "Tracks the prices households pay for a basket of goods and services.", rate: "inflation" },
  wpi: { name: "Wholesale Price Index", plain: "Tracks prices of goods traded in bulk, before they reach shoppers.", rate: null },
  iip: { name: "Index of Industrial Production", plain: "Tracks the volume of output from mining, manufacturing and electricity.", rate: "growth" },
};

async function loadOne(config: IndicatorConfig): Promise<IndicatorBundle> {
  // The SAME loader and series registry as the Indicators pages: both read every stored official series.
  const all = await loadAllSeries(config.key);
  const primary = all[0].result;
  const meta = FULL[config.key];
  const segments: Segment[] = primary.ok
    ? all.flatMap((b) =>
        b.result.ok
          ? [{ id: b.option.id, label: b.option.label, baseYear: b.result.data.baseYear, series: b.result.data.series ?? null, coverage: b.result.data.coverage, observations: b.result.data.observations.map(slim) }]
          : [],
      )
    : [];
  return {
    key: config.key,
    shortName: config.shortName,
    fullName: meta.name,
    plain: meta.plain,
    path: config.path,
    error: primary.ok ? null : primary.error,
    segments,
    source: sourceFor(config, primary.ok ? primary.data : null),
    rateKind: meta.rate,
    rateLabel: config.rateCard,
    rateMissingText: config.rateMissingText,
    units: "Index points",
  };
}

export const loadBundles = (): Promise<IndicatorBundle[]> => Promise.all(CONFIG_LIST.map(loadOne));
