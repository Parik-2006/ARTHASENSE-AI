import { type GdpResult, type GvaResult, parseGdpResponse, parseGvaResponse } from "@/lib/gdp";
import {
  type Comparison,
  type ForecastId,
  type ForecastRow,
  type LatestForecast,
  type ModelInfo,
  type ModelStatusPage,
  type Result,
  type Run,
  type RunDetail,
  type SeriesInfo,
  parseComparison,
  parseForecastPage,
  parseLatest,
  parseModels,
  parseModelStatus,
  parseRunDetail,
  parseRunPage,
  parseSeries,
} from "@/lib/forecasting";
import { type IipSectorsResult, parseIipSectors } from "@/lib/iip-sectors";
import { type IndicatorKey, type IndicatorResult, parseIndicatorResponse } from "@/lib/indicator";
import { type HealthResult, parseApiHealth } from "@/lib/health";

import {
  configProblem,
  isTransientStatus,
  joinUrl,
  normalizeBaseUrl,
  readFetchPolicy,
} from "@/lib/api-config";

/** Server-side only. The browser never talks to FastAPI directly (see lib/api-config.ts). */
export const API_URL = normalizeBaseUrl(process.env.ARTHASENSE_API_URL);

/** Non-null when the API URL looks wrong for this environment (for example unset on Vercel). */
export function apiConfigProblem(): string | null {
  return configProblem(API_URL, { onVercel: Boolean(process.env.VERCEL), production: process.env.NODE_ENV === "production" });
}

interface ApiResponse {
  status: number;
  body: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with a timeout and bounded retries for a server that is still waking up (network error, 502/503/504).
 *  Permanent conditions (404, 4xx, "not migrated", "not configured") are never retried. */
async function apiGet(path: string, opts: { timeoutMs?: number; attempts?: number } = {}): Promise<ApiResponse> {
  const policy = readFetchPolicy(process.env);
  const attempts = opts.attempts ?? policy.attempts;
  const timeoutMs = opts.timeoutMs ?? policy.timeoutMs;
  let last: ApiResponse | Error = new Error("no attempt was made");
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(policy.retryDelayMs);
    try {
      const res = await fetch(joinUrl(API_URL, path), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      const detail = typeof (body as { detail?: unknown } | null)?.detail === "string" ? ((body as { detail: string }).detail) : "";
      const permanent = /not migrated|not configured/i.test(detail);
      if (isTransientStatus(res.status) && !permanent && i < attempts - 1) {
        last = { status: res.status, body };
        continue;
      }
      return { status: res.status, body };
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (last instanceof Error) throw last;
  return last;
}

function httpError(res: ApiResponse): string {
  const detail = (res.body as { detail?: unknown } | null)?.detail;
  return `API answered HTTP ${res.status}${typeof detail === "string" ? `: ${detail}` : ""}`;
}

/** A failed request on a misconfigured deployment is reported as the configuration problem, which is the real cause. */
const errText = (err: unknown) => apiConfigProblem() ?? (err instanceof Error ? err.message : String(err));

export async function getApiHealth(timeoutMs = 8000): Promise<HealthResult> {
  try {
    const res = await apiGet("/health", { timeoutMs, attempts: 1 });
    const health = parseApiHealth(res.body);
    if (!health) return { reachable: false, error: `Unexpected response (HTTP ${res.status})` };
    return { reachable: true, health };
  } catch (err) {
    return { reachable: false, error: errText(err) };
  }
}

/** Stored observations from FastAPI (which reads PostgreSQL; MoSPI is never called from here). */
export async function getIndicator(
  kind: IndicatorKey,
  query = "?limit=240",
  path = "",
  timeoutMs?: number,
): Promise<IndicatorResult> {
  try {
    const res = await apiGet(`/api/v1/indicators/${kind}${path}${query}`, { timeoutMs });
    if (res.status < 200 || res.status >= 300) return { ok: false, error: httpError(res) };
    const data = parseIndicatorResponse(res.body, kind);
    if (!data) return { ok: false, error: "Unexpected response shape from the API" };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** GDP (quarterly, constant prices). The API answers 404 while GDP is not stored in its database (for example an
 *  older backend or a database without the NAS import): that is reported as "not stored" and shown honestly. Nothing here ever supplies a value of its own. */
export async function getGdp(): Promise<GdpResult> {
  try {
    const res = await apiGet("/api/v1/indicators/gdp?limit=80");
    if (res.status === 404) {
      return { ok: false, state: "not_stored", reason: "The ArthaSense API has no GDP data yet: official GDP has not been ingested into the database." };
    }
    if (res.status < 200 || res.status >= 300) return { ok: false, state: "error", reason: httpError(res) };
    const data = parseGdpResponse(res.body);
    if (!data) return { ok: false, state: "error", reason: "Unexpected response shape from the API" };
    if (!data.observations.some((o) => o.level !== null || o.growthYoy !== null)) {
      return { ok: false, state: "not_stored", reason: "The GDP endpoint answered but holds no observations." };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, state: "error", reason: errText(err) };
  }
}

/** Official real GVA growth by MoSPI industry (quarterly). 404 = not stored; nothing is estimated. */
export async function getGva(): Promise<GvaResult> {
  try {
    const res = await apiGet("/api/v1/indicators/gdp/gva?limit=80");
    if (res.status === 404) return { ok: false, state: "not_stored", reason: "Sector-wise GVA is not stored in the ArthaSense database yet." };
    if (res.status < 200 || res.status >= 300) return { ok: false, state: "error", reason: httpError(res) };
    const data = parseGvaResponse(res.body);
    if (!data) return { ok: false, state: "error", reason: "Unexpected response shape from the API" };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, state: "error", reason: errText(err) };
  }
}

/** Sector totals of the IIP, one list per sector (a failure degrades gracefully on the page). */
export async function getIipSectors(baseYear = "2022-23", timeoutMs?: number): Promise<IipSectorsResult> {
  try {
    const res = await apiGet(`/api/v1/indicators/iip/sectors?limit=240&base_year=${encodeURIComponent(baseYear)}`, { timeoutMs });
    if (res.status < 200 || res.status >= 300) return { ok: false, error: httpError(res) };
    const data = parseIipSectors(res.body);
    return data ? { ok: true, data } : { ok: false, error: "Unexpected response shape from the API" };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

// ---------- forecasting (stored results only; the API never trains a model) ----------

async function getJson<T>(path: string, parse: (j: unknown) => T | null, timeoutMs?: number): Promise<Result<T>> {
  try {
    const res = await apiGet(`/api/v1/forecasting${path}`, { timeoutMs });
    if (res.status === 404) return { ok: false, error: "Not found" };
    if (res.status < 200 || res.status >= 300) return { ok: false, error: httpError(res) };
    const data = parse(res.body);
    return data ? { ok: true, data } : { ok: false, error: "Unexpected response shape from the API" };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

export const getForecastModels = (): Promise<Result<ModelInfo[]>> => getJson("/models", parseModels);
export const getForecastSeries = (): Promise<Result<SeriesInfo[]>> => getJson("/series", parseSeries);
export const getRuns = (query = "?limit=200"): Promise<Result<{ total: number; items: Run[] }>> =>
  getJson(`/runs${query}`, parseRunPage);
export const getRunDetail = (id: number): Promise<Result<RunDetail>> => getJson(`/runs/${id}`, parseRunDetail);
export const getRunForecasts = (id: number): Promise<Result<{ total: number; items: ForecastRow[]; kind: string }>> =>
  getJson(`/forecasts?run_id=${id}&limit=200`, parseForecastPage);
export const getLatestForecast = (indicator: ForecastId, model: string, horizon: number): Promise<Result<LatestForecast>> =>
  getJson(`/forecasts/latest?indicator=${indicator}&model=${model}&horizon=${horizon}`, parseLatest);
export const getComparison = (indicator: ForecastId, horizon: number): Promise<Result<Comparison>> =>
  getJson(`/comparison?indicator=${indicator}&horizon=${horizon}`, parseComparison);
/** V4: status of each of the eight algorithms for one indicator (an older API answers 404/422 -> not ok). */
export const getModelStatus = (indicator: ForecastId): Promise<Result<ModelStatusPage>> =>
  getJson(`/model-status?indicator=${indicator}`, parseModelStatus);
