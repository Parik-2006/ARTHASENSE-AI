import {
  type Comparison,
  type ForecastRow,
  type IndicatorId,
  type LatestForecast,
  type ModelInfo,
  type Result,
  type Run,
  type RunDetail,
  type SeriesInfo,
  parseComparison,
  parseForecastPage,
  parseLatest,
  parseModels,
  parseRunDetail,
  parseRunPage,
  parseSeries,
} from "@/lib/forecasting";
import { type IipSectorsResult, parseIipSectors } from "@/lib/iip-sectors";
import { type IndicatorKey, type IndicatorResult, parseIndicatorResponse } from "@/lib/indicator";
import { type HealthResult, parseApiHealth } from "@/lib/health";

/** Server-side only. The browser never talks to FastAPI directly. */
export const API_URL = process.env.ARTHASENSE_API_URL ?? "http://127.0.0.1:8000";

export async function getApiHealth(timeoutMs = 2500): Promise<HealthResult> {
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    const health = parseApiHealth(await res.json());
    if (!health) return { reachable: false, error: `Unexpected response (HTTP ${res.status})` };
    return { reachable: true, health };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: message };
  }
}

/** Stored observations from FastAPI (which reads PostgreSQL; MoSPI is never called from here). */
export async function getIndicator(
  kind: IndicatorKey,
  query = "?limit=240",
  path = "",
  timeoutMs = 5000,
): Promise<IndicatorResult> {
  try {
    const res = await fetch(`${API_URL}/api/v1/indicators/${kind}${path}${query}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, error: `API answered HTTP ${res.status}` };
    const data = parseIndicatorResponse(await res.json(), kind);
    if (!data) return { ok: false, error: "Unexpected response shape from the API" };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sector totals of the IIP, one list per sector (null on any failure; the page degrades gracefully). */
export async function getIipSectors(timeoutMs = 5000): Promise<IipSectorsResult> {
  try {
    const res = await fetch(`${API_URL}/api/v1/indicators/iip/sectors?limit=120`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, error: `API answered HTTP ${res.status}` };
    const data = parseIipSectors(await res.json());
    return data ? { ok: true, data } : { ok: false, error: "Unexpected response shape from the API" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- forecasting (stored results only; the API never trains a model) ----------

async function getJson<T>(path: string, parse: (j: unknown) => T | null, timeoutMs = 6000): Promise<Result<T>> {
  try {
    const res = await fetch(`${API_URL}/api/v1/forecasting${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: "Not found" };
      let detail = "";
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (typeof body.detail === "string") detail = `: ${body.detail}`;
      } catch {
        /* no JSON body */
      }
      return { ok: false, error: `API answered HTTP ${res.status}${detail}` };
    }
    const data = parse(await res.json());
    return data ? { ok: true, data } : { ok: false, error: "Unexpected response shape from the API" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const getForecastModels = (): Promise<Result<ModelInfo[]>> => getJson("/models", parseModels);
export const getForecastSeries = (): Promise<Result<SeriesInfo[]>> => getJson("/series", parseSeries);
export const getRuns = (query = "?limit=200"): Promise<Result<{ total: number; items: Run[] }>> =>
  getJson(`/runs${query}`, parseRunPage);
export const getRunDetail = (id: number): Promise<Result<RunDetail>> => getJson(`/runs/${id}`, parseRunDetail);
export const getRunForecasts = (id: number): Promise<Result<{ total: number; items: ForecastRow[]; kind: string }>> =>
  getJson(`/forecasts?run_id=${id}&limit=200`, parseForecastPage);
export const getLatestForecast = (indicator: IndicatorId, model: string, horizon: number): Promise<Result<LatestForecast>> =>
  getJson(`/forecasts/latest?indicator=${indicator}&model=${model}&horizon=${horizon}`, parseLatest);
export const getComparison = (indicator: IndicatorId, horizon: number): Promise<Result<Comparison>> =>
  getJson(`/comparison?indicator=${indicator}&horizon=${horizon}`, parseComparison);
