/** Server-side loader for Overview V2. Everything comes from the existing indicator endpoints
 *  (FastAPI reading PostgreSQL). Older base-year / back series are requested too; when they hold no rows
 *  they simply do not appear, and if they ever do, they are kept as separate segments (never merged). */

import { getIndicator } from "@/lib/api";
import type { IndicatorKey, Observation } from "@/lib/indicator";
import { CONFIG_LIST, type IndicatorConfig } from "@/lib/indicators";
import { type SourceInfo, sourceFor } from "@/lib/source";

/** Source-level provenance is summarised in SourceInfo; each row keeps only its index snapshot (release key and retrieval time) for CSV export. */
const slim = (o: Observation): Observation => ({ ...o, rateSource: null }); // keep indexSource: needed for per-row CSV provenance

export interface Segment {
  id: string;
  /** e.g. "Base 2022-23" */
  label: string;
  baseYear: string;
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

/** Extra queries for earlier series the API can serve. */
const PRIOR: Record<IndicatorKey, { query: string; id: string; label: string }> = {
  cpi: { query: "?limit=240&series=back", id: "back", label: "Official back series (same 2024 base)" },
  wpi: { query: "?limit=240&base_year=2011-12", id: "2011-12", label: "Base 2011-12" },
  iip: { query: "?limit=240&base_year=2011-12", id: "2011-12", label: "Base 2011-12" },
};

async function loadOne(config: IndicatorConfig): Promise<IndicatorBundle> {
  const [primary, prior] = await Promise.all([
    getIndicator(config.key, config.apiQuery),
    getIndicator(config.key, PRIOR[config.key].query),
  ]);
  const meta = FULL[config.key];
  const segments: Segment[] = [];
  if (primary.ok) {
    segments.push({
      id: "current",
      label: `Base ${primary.data.baseYear}`,
      baseYear: primary.data.baseYear,
      coverage: primary.data.coverage,
      observations: primary.data.observations.map(slim),
    });
  }
  if (primary.ok && prior.ok && prior.data.observations.some((o) => o.index !== null)) {
    segments.push({
      id: PRIOR[config.key].id,
      label: PRIOR[config.key].label,
      baseYear: prior.data.baseYear,
      coverage: prior.data.coverage,
      observations: prior.data.observations.map(slim),
    });
  }
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
