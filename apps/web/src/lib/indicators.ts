import type { IndicatorKey } from "@/lib/indicator";

/** Everything that differs between indicators: terminology, labels and methodology text.
 *  The dashboard components are generic; CPI wording is never reused for WPI or IIP. */
export interface IndicatorConfig {
  key: IndicatorKey;
  path: string; // page route
  apiQuery: string; // appended to /api/v1/indicators/<key>
  /** Optional second request for an official linked Back series on the same base year. */
  backQuery?: string;
  /** Optional request for the previous base year, kept as a separate segment (WPI / IIP). */
  legacyQuery?: string;
  shortName: string; // "CPI"
  navLabel: string;
  title: string;
  lede: string;
  chips: string[];
  indexCard: string;
  indexName: string; // used in the table header
  chartTitle: string;
  rateCard: string | null; // null: this indicator has no official year-on-year field
  rateColumn: string | null;
  rateSigned: boolean;
  rateMissingText: string;
  rateCsvColumn: string | null;
  indexCsvColumn: string;
  cardOrder: ("index" | "mom" | "rate" | "period")[];
  sourceShort: string; // "MoSPI"
  publisher: string;
  /** Publisher's own site (verified reachable); null if none is established. */
  publisherUrl: string | null;
  dataset: string;
  empty: string;
  definitions: { term: string; text: string }[];
  limits: string[];
  overviewBlurb: string;
}

export const MOSPI_PORTAL = "https://esankhyiki.mospi.gov.in/";
export const OEA_PORTAL = "https://eaindustry.nic.in/";
export const MOSPI_PUBLISHER = "Ministry of Statistics and Programme Implementation (MoSPI), Government of India";

export const CPI_CONFIG: IndicatorConfig = {
  key: "cpi",
  path: "/indicators/cpi",
  apiQuery: "?limit=240",
  backQuery: "?limit=240&series=back",
  shortName: "CPI",
  navLabel: "CPI Intelligence",
  title: "Consumer Price Index Intelligence",
  lede: "Track India's consumer price trends using official MoSPI data.",
  chips: ["India", "All India", "Combined", "CPI (General)", "Base year: 2024", "Source: MoSPI"],
  indexCard: "Latest CPI Index",
  indexName: "CPI index",
  chartTitle: "India CPI Index Trend",
  rateCard: "Year-over-Year Inflation",
  rateColumn: "YoY inflation (official)",
  rateSigned: false,
  rateMissingText: "Official year-over-year inflation data is not available for this period.",
  rateCsvColumn: "yoy_inflation_pct_official",
  indexCsvColumn: "cpi_index",
  cardOrder: ["index", "mom", "rate", "period"],
  sourceShort: "MoSPI",
  publisherUrl: MOSPI_PORTAL,
  publisher: MOSPI_PUBLISHER,
  dataset: "Consumer Price Index, monthly",
  empty: "No CPI observations have been imported yet.",
  definitions: [
    {
      term: "CPI Index",
      text: "A measure of consumer price levels relative to the base period (2024 = 100). It is a level, not a percentage rate.",
    },
    {
      term: "Month-over-Month Change",
      text: "A calculated percentage change between consecutive monthly index values. It is only shown when both months are stored, and it is not official inflation.",
    },
    {
      term: "Year-over-Year Inflation",
      text: "A comparison with the same month one year earlier. This page shows only figures that MoSPI itself reports; if none are stored we say so and do not substitute any other number.",
    },
  ],
  limits: [],
  overviewBlurb: "Consumer prices, All India / Combined / CPI (General), base 2024.",
};

export const WPI_CONFIG: IndicatorConfig = {
  key: "wpi",
  path: "/indicators/wpi",
  apiQuery: "?limit=240",
  legacyQuery: "?limit=240&base_year=2011-12",
  shortName: "WPI",
  navLabel: "WPI Intelligence",
  title: "Wholesale Price Index Intelligence",
  lede: "WPI tracks how prices change for goods traded in bulk at the wholesale level, before they reach consumers.",
  chips: ["India", "All commodities (headline)", "Base year: 2022-23", "Source: OEA via MoSPI"],
  indexCard: "Latest Headline WPI Index",
  indexName: "WPI index",
  chartTitle: "India WPI Index Trend",
  rateCard: "Official WPI Inflation",
  rateColumn: null,
  rateSigned: true,
  rateMissingText: "The source API provides the WPI index only. Official WPI inflation is not available here.",
  rateCsvColumn: null,
  indexCsvColumn: "wpi_index",
  cardOrder: ["index", "rate", "mom", "period"],
  sourceShort: "OEA via MoSPI",
  publisherUrl: OEA_PORTAL,
  publisher:
    "Office of the Economic Adviser, DPIIT (Ministry of Commerce and Industry), served through the MoSPI eSankhyiki API",
  dataset: "Wholesale Price Index, monthly, all commodities",
  empty: "No WPI observations have been imported yet.",
  definitions: [
    {
      term: "What WPI measures",
      text: "The average change over time in the wholesale prices of goods (all commodities, headline index). It covers goods only, not services, and not retail prices paid by households.",
    },
    {
      term: "WPI Index",
      text: "A price level relative to the base period (2022-23 = 100). It is a level, not a percentage rate.",
    },
    {
      term: "Month-over-Month Change",
      text: "A calculated percentage change between consecutive monthly index values, shown only when both months are stored. It is not official WPI inflation.",
    },
    {
      term: "WPI inflation",
      text: "The year-on-year percentage change of the index. The source API does not supply it, so this page does not show a figure for it rather than estimating one.",
    },
  ],
  limits: [
    "The API does not mark values as provisional or final, so later revisions cannot be told apart from first estimates except through our own retrieval snapshots.",
    "Only the headline (all commodities) index is stored; commodity groups are not ingested yet.",
  ],
  overviewBlurb: "Wholesale prices, India / all commodities, base 2022-23.",
};

export const IIP_CONFIG: IndicatorConfig = {
  key: "iip",
  path: "/indicators/iip",
  apiQuery: "?limit=240",
  legacyQuery: "?limit=240&base_year=2011-12",
  shortName: "IIP",
  navLabel: "IIP Intelligence",
  title: "Industrial Production Intelligence",
  lede: "Track the output of India's mining, manufacturing and electricity sectors using official MoSPI data.",
  chips: ["India", "General (headline)", "Base year: 2022-23", "Source: MoSPI"],
  indexCard: "Latest Headline IIP Index",
  indexName: "IIP index",
  chartTitle: "India IIP Index Trend",
  rateCard: "Official Industrial Growth (YoY)",
  rateColumn: "YoY growth (official)",
  rateSigned: true,
  rateMissingText: "Official year-on-year growth is not available for this period.",
  rateCsvColumn: "yoy_growth_pct_official",
  indexCsvColumn: "iip_index",
  cardOrder: ["index", "rate", "mom", "period"],
  sourceShort: "MoSPI",
  publisherUrl: MOSPI_PORTAL,
  publisher: MOSPI_PUBLISHER,
  dataset: "Index of Industrial Production, monthly",
  empty: "No IIP observations have been imported yet.",
  definitions: [
    {
      term: "What IIP measures",
      text: "The change in the volume of industrial production relative to the base period (2022-23 = 100), across mining, manufacturing and electricity (and, in this base, water supply and waste management).",
    },
    {
      term: "IIP Index",
      text: "An output level for the chosen category. Levels of different categories are not directly comparable with one another.",
    },
    {
      term: "Official growth (YoY)",
      text: "The percentage change from the same month a year earlier, as published by MoSPI. It is stored as a separate series from the index.",
    },
    {
      term: "Month-over-Month Change",
      text: "A calculated change between consecutive monthly index values. The IIP is not seasonally adjusted, so month-to-month swings largely reflect the seasonal pattern; prefer the official YoY growth.",
    },
  ],
  limits: [
    "IIP estimates are revised in later releases. The API gives no release flag, so we keep every retrieval as a separate snapshot and show the latest.",
    "Sector totals are taken from the rows with no sub-category; use-based categories are not ingested.",
  ],
  overviewBlurb: "Industrial output, India / General, base 2022-23.",
};

export const CONFIGS: Record<IndicatorKey, IndicatorConfig> = {
  cpi: CPI_CONFIG,
  wpi: WPI_CONFIG,
  iip: IIP_CONFIG,
};
export const CONFIG_LIST: IndicatorConfig[] = [CPI_CONFIG, WPI_CONFIG, IIP_CONFIG];
