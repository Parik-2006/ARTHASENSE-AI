/** Source / provenance model shared by every chart, card and insight. Missing metadata is stated, never filled in. */

import { distinctSnapshots, type IndicatorData, lastRetrievedAt } from "@/lib/indicator";
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
