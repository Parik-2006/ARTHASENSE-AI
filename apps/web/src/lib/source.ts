/** Source / provenance model shared by every chart, card and insight. Missing metadata is stated, never filled in. */

import { distinctSnapshots, type IndicatorData, type IndicatorKey, lastRetrievedAt } from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";

export type DataClass = "official" | "calculated" | "forecast";

export const CLASS_LABEL: Record<DataClass, string> = {
  official: "Official data",
  calculated: "Calculated by ArthaSense",
  forecast: "Model-generated forecast",
};

export interface SourceInfo {
  short: string;
  publisher: string;
  dataset: string;
  url: string | null;
  /** The publisher's own website (not the API we read from). */
  publisherUrl: string | null;
  /** ArthaSense series codes behind this source (index and, where it exists, official rate). */
  seriesIds: string[];
  channel: string;
  coverage: string | null;
  baseYear: string | null;
  retrievedAt: string | null;
  /** Official release date; null when the source API supplies none (it is NOT replaced by the retrieval time). */
  publishedAt: string | null;
  snapshots: number;
  revision: string;
  limitations: string[];
}

/** Series codes as stored by ArthaSense; mirrors services/api/app/indicators.py. */
export function seriesIds(kind: IndicatorKey, baseYear: string, sector = "general"): string[] {
  if (kind === "cpi") {
    const stem = "mospi.cpi.2024.current.all_india.combined.general";
    return [`${stem}.index`, `${stem}.inflation_yoy`];
  }
  if (kind === "wpi") return [`mospi.wpi.${baseYear}.india.all_commodities.index`];
  const stem = `mospi.iip.${baseYear}.india.${sector}`;
  return [`${stem}.index`, `${stem}.growth_yoy`];
}

export const NOT_PROVIDED = "Not provided by the source API";

/** Built only from what the API returned plus the static indicator description. */
export function sourceFor(config: IndicatorConfig, data: IndicatorData | null): SourceInfo {
  const rows = data?.observations ?? [];
  const snaps = distinctSnapshots(rows);
  const published = snaps.map((s) => s.publishedAt).filter((x): x is string => !!x).sort();
  return {
    short: config.sourceShort,
    publisher: config.publisher,
    dataset: config.dataset,
    url: data?.sourceUrl ?? null,
    publisherUrl: config.publisherUrl,
    seriesIds: data ? seriesIds(config.key, data.baseYear) : [],
    channel: "MoSPI eSankhyiki API, stored in ArthaSense PostgreSQL and served by the ArthaSense API",
    coverage: data?.coverage ?? null,
    baseYear: data?.baseYear ?? null,
    retrievedAt: data ? lastRetrievedAt(rows) : null,
    publishedAt: published.length ? published[published.length - 1] : null,
    snapshots: snaps.length,
    revision: config.limits.find((l) => /revis/i.test(l)) ?? "Revision status is not provided by the source.",
    limitations: [...config.limits, ...(data?.limitations ?? [])].filter((x, i, a) => a.indexOf(x) === i),
  };
}

export const FORMULA = {
  mom: "MoM % = (index_t ÷ index_t−1 − 1) × 100, only when both consecutive months are stored.",
  yoy: "YoY % = (index_t ÷ index_t−12 − 1) × 100, only when both months are stored in the same series and base year.",
  ma3: "3-month average = mean of this month and the two before it; blank if any of the three is missing.",
} as const;
