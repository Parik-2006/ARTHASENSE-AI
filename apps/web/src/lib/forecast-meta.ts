/** Forecasts V4: display metadata per forecast indicator, so the monthly indices (CPI, WPI, IIP) and quarterly real
 *  GDP share one code path. Pure: formatting and labels only, never a number. */

import { type ForecastId, FORECAST_NAMES, FREQUENCY, type Frequency, HORIZONS_BY_FREQ, periodLabel } from "@/lib/forecasting";
import { quarterStartN, type GdpData } from "@/lib/gdp";
import type { Observation, Provenance } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";
import { DEFINITION } from "@/lib/indicator-view";
import type { SourceInfo } from "@/lib/source";

export interface ForecastMeta {
  id: ForecastId;
  shortName: string;
  name: string;
  /** What is forecast, e.g. "CPI index" or "Real GDP". */
  seriesName: string;
  frequency: Frequency;
  horizons: readonly number[];
  /** Default horizon for the outlook: 6 months / 4 quarters. */
  preferH: number;
  definition: string;
  /** Formats one value for cards and tables. */
  value: (v: number | null | undefined) => string;
  /** Short value for axis ticks. */
  axis: (v: number) => string;
  /** Unit line: "Index, base 2022-23 = 100" / "₹ lakh crore at constant 2022-23 prices". */
  unit: (baseYear: string) => string;
  period: (iso: string, long?: boolean) => string;
}

const index = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));
// Real GDP is stored in ₹ crore; shown in ₹ lakh crore (1 lakh crore = 100,000 crore), the unit MoSPI uses in releases.
export const LAKH = 100_000;
const lakh = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `₹${(v / LAKH).toFixed(2)} lakh cr`);

export function forecastMeta(id: ForecastId): ForecastMeta {
  const frequency = FREQUENCY[id];
  const common = { id, frequency, horizons: HORIZONS_BY_FREQ[frequency], name: FORECAST_NAMES[id], definition: DEFINITION[id], period: (iso: string, long = false) => periodLabel(iso, frequency, long) };
  if (id === "gdp")
    return {
      ...common,
      shortName: "GDP",
      seriesName: "Real GDP",
      preferH: 4,
      value: lakh,
      axis: (v) => (v / LAKH).toFixed(0),
      unit: (b) => `₹ lakh crore at constant ${b} prices`,
    };
  const c = CONFIGS[id];
  return { ...common, shortName: c.shortName, seriesName: c.indexName, preferH: 6, value: index, axis: (v) => v.toFixed(v % 1 === 0 ? 0 : 1), unit: (b) => `Index, base ${b} = 100` };
}

/** Quarterly real GDP levels as forecast-history observations (period = first month of the quarter). The level is
 *  the official value; `rate` is MoSPI's official year-on-year growth, exactly as published. */
export function gdpObservations(d: GdpData): Observation[] {
  const out: Observation[] = [];
  for (const o of d.observations) {
    const n = quarterStartN(o.fiscalYear, o.quarter);
    if (n === null) continue;
    const period = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
    const prov: Provenance | null = o.releaseKey && o.retrievedAt ? { releaseKey: o.releaseKey, retrievedAt: o.retrievedAt, publishedAt: null } : null;
    out.push({ period, index: o.level, rate: o.growthYoy, indexSource: prov, rateSource: prov });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export function gdpSource(d: GdpData | null): SourceInfo {
  return {
    short: "MoSPI (NSO)",
    publisher: "National Statistics Office, Ministry of Statistics and Programme Implementation",
    dataset: "Quarterly estimates of GDP (National Accounts), base 2022-23",
    url: d?.sourceUrl ?? null,
    publisherUrl: "https://www.mospi.gov.in",
    seriesIds: ["mospi.nas.2022-23.india.gdp.real.level", "mospi.nas.2022-23.india.gdp.real.growth_yoy"],
    channel: "MoSPI eSankhyiki API, stored in ArthaSense PostgreSQL and served by the ArthaSense API",
    coverage: "India · GDP at constant 2022-23 prices (real), quarterly, not seasonally adjusted",
    baseYear: d?.baseYear ?? "2022-23",
    retrievedAt: d?.observations.map((o) => o.retrievedAt).filter((x): x is string => !!x).sort().pop() ?? null,
    publishedAt: null,
    snapshots: new Set(d?.observations.map((o) => o.releaseKey).filter(Boolean)).size,
    revision: "Quarterly GDP estimates are revised in later releases; the latest stored release is used.",
    limitations: ["Not seasonally adjusted: compare a quarter with the same quarter a year earlier.", ...(d?.limitations ?? [])],
  };
}

/** Year-on-year growth implied by a forecast LEVEL for quarter t: forecast(t) ÷ official(t − 4 quarters) − 1, in %.
 *  Null when the official level of the same quarter a year earlier is not stored. Calculated by ArthaSense. */
export function impliedYoy(targetIso: string, forecastLevel: number, history: { period: string; index: number | null }[]): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(targetIso);
  if (!m) return null;
  const prev = `${Number(m[1]) - 1}-${m[2]}-01`;
  const base = history.find((h) => h.period === prev)?.index;
  return base === null || base === undefined || base === 0 ? null : (forecastLevel / base - 1) * 100;
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ""; // missing stays empty, never 0
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for a QUARTERLY forecast (GDP): levels in the stored unit (₹ crore), fiscal-quarter labels, the year-on-year
 *  growth implied by each forecast level (calculated by ArthaSense), the exact model configuration and provenance. */
export function forecastsToCsvV4(
  rows: { origin_date: string | null; target_date: string; forecast: number; lower_80: number | null; upper_80: number | null; lower_95: number | null; upper_95: number | null; interval_method: string | null }[],
  m: {
    indicator: string;
    baseYear: string | null;
    seriesId: string | null;
    publisher: string | null;
    modelId: string;
    modelName: string;
    run: { id: number; horizon: number; training_start: string | null; training_cutoff: string; dataset_fingerprint: string | null; created_at: string; model_label?: string | null };
    latest: { period: string; value: number } | null;
    reliability: string;
    unit: string;
    history: { period: string; index: number | null }[];
  },
): string {
  const head = [
    "indicator", "classification", "frequency", "target_quarter", "target_period_start", "forecast_level_rs_crore", "implied_yoy_growth_pct_calculated",
    "lower_80", "upper_80", "lower_95", "upper_95", "interval_method", "forecast_origin", "latest_official_quarter", "latest_official_level_rs_crore",
    "horizon_quarters", "model_id", "model_name", "model_configuration", "run_id", "training_start", "training_cutoff", "dataset_fingerprint", "stored_at",
    "base_year", "training_series_id", "training_data_publisher", "unit", "reliability_assessment",
  ]; // prettier-ignore
  const lines = rows.map((r) => {
    const y = impliedYoy(r.target_date, r.forecast, m.history);
    return [
      m.indicator, "model_forecast_not_official", "quarterly", periodLabel(r.target_date, "quarterly"), r.target_date, r.forecast, y === null ? null : y.toFixed(4),
      r.lower_80, r.upper_80, r.lower_95, r.upper_95, r.interval_method, r.origin_date, m.latest ? periodLabel(m.latest.period, "quarterly") : null, m.latest?.value ?? null,
      m.run.horizon, m.modelId, m.modelName, m.run.model_label ?? null, m.run.id, m.run.training_start, m.run.training_cutoff, m.run.dataset_fingerprint, m.run.created_at,
      m.baseYear, m.seriesId, m.publisher, m.unit, m.reliability,
    ]
      .map(cell)
      .join(",");
  }); // prettier-ignore
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
