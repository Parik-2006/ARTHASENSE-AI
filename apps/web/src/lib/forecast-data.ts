/** Server-side loader shared by the Forecasts overview and the indicator explorers, so both read the
 *  same stored runs, forecasts and comparisons. Stored results only: nothing is trained or generated. */

import type { StoredForecast } from "@/components/forecasting/forecast-explorer";
import { getComparison, getForecastModels, getForecastSeries, getGdp, getIndicator, getLatestForecast, getModelStatus, getRuns } from "@/lib/api";
import { gdpObservations, gdpSource } from "@/lib/forecast-meta";
import { type Comparison, type ForecastId, FREQUENCY, HORIZONS_BY_FREQ, type ModelInfo, type ModelStatus, type Run, type SeriesInfo } from "@/lib/forecasting";
import type { Observation } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";
import { type SourceInfo, sourceFor } from "@/lib/source";

/** The official history a forecast page draws: monthly index observations, or quarterly real GDP levels. */
export interface ForecastHistory {
  baseYear: string;
  observations: Observation[];
  source: SourceInfo;
}

export interface IndicatorForecastData {
  id: ForecastId;
  hist: ForecastHistory | null;
  histError: string | null;
  info: SeriesInfo | null;
  models: ModelInfo[];
  runs: Run[];
  stored: StoredForecast[]; // one entry per stored (model, horizon) genuine-future forecast
  comparisons: Record<number, Comparison | null>; // by horizon
  /** V4: status of each of the eight algorithms (empty when the API predates V4). */
  status: ModelStatus[];
  error: string | null; // set when a required request failed
}

/** Every (model, horizon) that has a completed future-forecast run, newest run first. */
export function storedPairs(runs: Run[]): { model: string; horizon: number }[] {
  const seen = new Set<string>();
  const out: { model: string; horizon: number }[] = [];
  for (const r of runs) {
    if (r.kind !== "forecast" || r.status !== "completed") continue;
    const k = `${r.model}|${r.horizon}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ model: r.model, horizon: r.horizon });
    }
  }
  return out;
}

async function loadHistory(id: ForecastId): Promise<{ hist: ForecastHistory | null; error: string | null }> {
  if (id === "gdp") {
    const g = await getGdp();
    if (!g.ok) return { hist: null, error: g.reason };
    return { hist: { baseYear: g.data.baseYear, observations: gdpObservations(g.data), source: gdpSource(g.data) }, error: null };
  }
  const config = CONFIGS[id];
  const h = await getIndicator(id, config.apiQuery);
  if (!h.ok) return { hist: null, error: h.error };
  return { hist: { baseYear: h.data.baseYear, observations: h.data.observations, source: sourceFor(config, h.data) }, error: null };
}

export async function loadIndicatorForecast(id: ForecastId): Promise<IndicatorForecastData> {
  const [hist, series, models, runs, status] = await Promise.all([loadHistory(id), getForecastSeries(), getForecastModels(), getRuns(`?indicator=${id}&limit=200`), getModelStatus(id)]);
  const base: IndicatorForecastData = {
    id,
    hist: hist.hist,
    histError: hist.error,
    info: series.ok ? (series.data.find((s) => s.indicator === id) ?? null) : null,
    models: models.ok ? models.data : [],
    runs: runs.ok ? runs.data.items : [],
    stored: [],
    comparisons: {},
    status: status.ok ? status.data.models : [],
    error: null,
  };
  const failed = [series, models, runs].find((r) => !r.ok);
  if (failed && !failed.ok) return { ...base, error: failed.error };
  if (!runs.ok) return base;
  const pairs = storedPairs(runs.data.items);
  const latest = await Promise.all(pairs.map((p) => getLatestForecast(id, p.model, p.horizon)));
  pairs.forEach((p, i) => {
    const r = latest[i];
    if (r.ok && r.data.run && r.data.items.length) base.stored.push({ model: p.model, run: r.data.run, items: r.data.items });
  });
  // Evidence is needed for every horizon a view can offer (k <= stored horizon), e.g. 1, 3 and 6 from a 6-step run.
  const std = HORIZONS_BY_FREQ[FREQUENCY[id]];
  const maxH = Math.max(0, ...base.stored.map((s) => s.run.horizon));
  const horizons = [...new Set([...std.filter((h) => h <= maxH), ...base.stored.map((s) => s.run.horizon)])];
  const cmps = await Promise.all(horizons.map((h) => getComparison(id, h)));
  horizons.forEach((h, i) => {
    const c = cmps[i];
    base.comparisons[h] = c.ok ? c.data : null;
  });
  return base;
}
