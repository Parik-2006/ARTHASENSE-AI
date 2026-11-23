/** Server-side loader shared by the Forecasts overview and the indicator explorers, so both read the
 *  same stored runs, forecasts and comparisons. Stored results only: nothing is trained or generated. */

import type { StoredForecast } from "@/components/forecasting/forecast-explorer";
import { getComparison, getForecastModels, getForecastSeries, getIndicator, getLatestForecast, getRuns } from "@/lib/api";
import { type Comparison, HORIZONS, type IndicatorId, type ModelInfo, type Run, type SeriesInfo } from "@/lib/forecasting";
import type { IndicatorData } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";

export interface IndicatorForecastData {
  id: IndicatorId;
  hist: IndicatorData | null;
  histError: string | null;
  info: SeriesInfo | null;
  models: ModelInfo[];
  runs: Run[];
  stored: StoredForecast[]; // one entry per stored (model, horizon) genuine-future forecast
  comparisons: Record<number, Comparison | null>; // by horizon
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

export async function loadIndicatorForecast(id: IndicatorId): Promise<IndicatorForecastData> {
  const config = CONFIGS[id];
  const [hist, series, models, runs] = await Promise.all([
    getIndicator(id, config.apiQuery),
    getForecastSeries(),
    getForecastModels(),
    getRuns(`?indicator=${id}&limit=200`),
  ]);
  const base: IndicatorForecastData = {
    id,
    hist: hist.ok ? hist.data : null,
    histError: hist.ok ? null : hist.error,
    info: series.ok ? (series.data.find((s) => s.indicator === id) ?? null) : null,
    models: models.ok ? models.data : [],
    runs: runs.ok ? runs.data.items : [],
    stored: [],
    comparisons: {},
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
  const maxH = Math.max(0, ...base.stored.map((s) => s.run.horizon));
  const horizons = [...new Set([...HORIZONS.filter((h) => h <= maxH), ...base.stored.map((s) => s.run.horizon)])];
  const cmps = await Promise.all(horizons.map((h) => getComparison(id, h)));
  horizons.forEach((h, i) => {
    const c = cmps[i];
    base.comparisons[h] = c.ok ? c.data : null;
  });
  return base;
}
