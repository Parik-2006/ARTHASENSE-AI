/** The official series ArthaSense stores for each indicator, one entry per base year / series.
 *  This is the single registry used by Overview V2 and the Indicators pages, so both read the same series.
 *  Different bases are NEVER merged: each option is shown and downloaded on its own. */

import type { IndicatorKey } from "@/lib/indicator";

export type SeriesRole = "current" | "back" | "legacy" | "archive";

export interface SeriesOption {
  /** URL value of `?base=`; "current" is always the primary (newest) series. */
  id: string;
  indicator: IndicatorKey;
  label: string; // short: "Base 2011-12"
  baseYear: string;
  /** Appended to /api/v1/indicators/<indicator>. */
  query: string;
  role: SeriesRole;
  /** What it is and what it is not, in plain English. */
  note: string;
  /** Expected API `series` value for CPI (used for series identifiers). */
  cpiSeries?: "current" | "back" | "legacy2012";
}

const LIMIT = "?limit=240";

export const SERIES_OPTIONS: Record<IndicatorKey, SeriesOption[]> = {
  cpi: [
    { id: "current", indicator: "cpi", label: "Base 2024 · Current", baseYear: "2024", query: LIMIT, role: "current", cpiSeries: "current",
      note: "The newest official series (2024 = 100). It starts in January 2025, so it is short." },
    { id: "2012", indicator: "cpi", label: "Base 2012 · Legacy", baseYear: "2012", query: `${LIMIT}&series=legacy2012`, role: "legacy", cpiSeries: "legacy2012",
      note: "The previous official series (2012 = 100): one continuous, comparable history from January 2013 to December 2025. MoSPI has stopped publishing it. It is a different base from 2024, so its index levels are not comparable with the Current series." },
    { id: "back", indicator: "cpi", label: "Base 2024 · Official back series", baseYear: "2024", query: `${LIMIT}&series=back`, role: "back", cpiSeries: "back",
      note: "MoSPI's own back-cast of the all-India general index onto the 2024 base (January 2013 to December 2024). It is shown separately from the Current series and never joined to it." },
  ],
  wpi: [
    { id: "current", indicator: "wpi", label: "Base 2022-23", baseYear: "2022-23", query: LIMIT, role: "current",
      note: "The newest official series (2022-23 = 100), from April 2023." },
    { id: "2011-12", indicator: "wpi", label: "Base 2011-12 · Legacy", baseYear: "2011-12", query: `${LIMIT}&base_year=2011-12`, role: "legacy",
      note: "The previous series (2011-12 = 100), April 2012 to April 2026 and no longer updated. Its levels are not comparable with the 2022-23 base." },
    { id: "2004-05", indicator: "wpi", label: "Base 2004-05 · Archive", baseYear: "2004-05", query: `${LIMIT}&base_year=2004-05`, role: "archive",
      note: "A closed archive series (2004-05 = 100), January 2005 to March 2017." },
    { id: "1993-94", indicator: "wpi", label: "Base 1993-94 · Archive", baseYear: "1993-94", query: `${LIMIT}&base_year=1993-94`, role: "archive",
      note: "A closed archive series (1993-94 = 100), April 1994 to August 2010." },
  ],
  iip: [
    { id: "current", indicator: "iip", label: "Base 2022-23", baseYear: "2022-23", query: LIMIT, role: "current",
      note: "The newest official series (2022-23 = 100), from April 2023, with sector totals and official growth." },
    { id: "2011-12", indicator: "iip", label: "Base 2011-12 · Legacy", baseYear: "2011-12", query: `${LIMIT}&base_year=2011-12`, role: "legacy",
      note: "The previous series (2011-12 = 100), 2013 to March 2026 with sector totals and official growth. No longer updated; its levels are not comparable with the 2022-23 base." },
    { id: "2004-05", indicator: "iip", label: "Base 2004-05 · Archive", baseYear: "2004-05", query: `${LIMIT}&base_year=2004-05`, role: "archive",
      note: "A closed archive series (General index only), April 2005 to March 2017. Official growth is not stored for archive bases." },
    { id: "1993-94", indicator: "iip", label: "Base 1993-94 · Archive", baseYear: "1993-94", query: `${LIMIT}&base_year=1993-94`, role: "archive",
      note: "A closed archive series (General index only), April 1994 to June 2011. Official growth is not stored for archive bases." },
  ],
};

export function optionsFor(key: IndicatorKey): SeriesOption[] {
  return SERIES_OPTIONS[key];
}

/** Resolves ?base= to a registered option; anything unknown falls back to the primary series. */
export function resolveOption(key: IndicatorKey, id: string | null | undefined): { option: SeriesOption; fellBack: boolean } {
  const list = SERIES_OPTIONS[key];
  const found = list.find((o) => o.id === id);
  return { option: found ?? list[0], fellBack: !!id && !found };
}

export const BASE_YEAR_NOTE =
  "Index levels from different base years are not comparable and are never joined by ArthaSense. Some publishers document linking factors for certain base changes; none is applied here, so every base is shown as its own series.";

/** Replaces "{base}" in explanatory text with the real base year of the series on screen. */
export function fillBase(text: string, baseYear: string): string {
  return text.replaceAll("{base}", baseYear);
}
