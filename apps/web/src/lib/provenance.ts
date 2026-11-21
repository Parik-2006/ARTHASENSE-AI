/** Source descriptors shared by every indicator view. Only facts the repository can prove are listed;
 *  anything else is `null` and rendered as "not provided", never guessed. */
import type { IndicatorKey } from "@/lib/indicator";

export type Classification = "official" | "calculated" | "model";

export interface SourceItem {
  label: string; // what this source contributes, e.g. "CPI index"
  classification: Classification;
  publisher: string;
  dataset: string;
  /** Machine access channel we retrieved from. The publisher's own dataset page is not recorded. */
  accessChannel: string;
  seriesId: string | null;
  coverage: string | null;
  baseYear: string | null;
  units: string | null;
  period: string | null; // reporting period / range text
  publishedAt: string | null; // not provided by the MoSPI API
  retrievedAt: string | null;
  formula: string | null;
  limitations: string[];
}

export const MOSPI_API = "https://api.mospi.gov.in";

export const CLASS_LABEL: Record<Classification, string> = {
  official: "Official",
  calculated: "Calculated by ArthaSense",
  model: "Model-generated",
};

export const FORMULA = {
  mom: "MoM % = (index_t ÷ index_t−1 − 1) × 100, only when both consecutive months are stored.",
  yoy: "YoY % = (index_t ÷ index_t−12 − 1) × 100, only when both months are stored and share a base year.",
  ma3: "3-month average = mean of this month and the two before it; blank if any of the three is missing.",
} as const;

/** Mirror of the series codes in services/api/app/indicators.py (display only). */
export function seriesId(kind: IndicatorKey, baseYear: string, part: "index" | "rate", sector = "general"): string {
  if (kind === "cpi") {
    return `mospi.cpi.2024.current.all_india.combined.general.${part === "index" ? "index" : "inflation_yoy"}`;
  }
  if (kind === "wpi") return `mospi.wpi.${baseYear}.india.all_commodities.index`;
  return `mospi.iip.${baseYear}.india.${sector}.${part === "index" ? "index" : "growth_yoy"}`;
}

export function officialItem(args: {
  label: string;
  publisher: string;
  dataset: string;
  seriesId: string;
  coverage: string;
  baseYear: string;
  period: string | null;
  retrievedAt: string | null;
  units?: string;
  limitations?: string[];
}): SourceItem {
  return {
    classification: "official",
    accessChannel: `MoSPI eSankhyiki API (${MOSPI_API}), read-only`,
    publishedAt: null,
    formula: null,
    units: args.units ?? `Index, base ${args.baseYear} = 100`,
    limitations: args.limitations ?? [],
    ...args,
  };
}

export function calculatedItem(base: SourceItem, label: string, formula: string, units: string): SourceItem {
  return { ...base, label, classification: "calculated", formula, units, publishedAt: null };
}
