import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configProblem,
  isLoopback,
  isTransientStatus,
  joinUrl,
  LOCAL_API_URL,
  normalizeBaseUrl,
  PRODUCTION_API_URL,
  readFetchPolicy,
} from "@/lib/api-config";

describe("URL handling", () => {
  it("defaults to the local API and strips whitespace and trailing slashes", () => {
    expect(normalizeBaseUrl(undefined)).toBe(LOCAL_API_URL);
    expect(normalizeBaseUrl("")).toBe(LOCAL_API_URL);
    expect(normalizeBaseUrl("   ")).toBe(LOCAL_API_URL);
    expect(normalizeBaseUrl(" https://arthasense-ai.onrender.com/ ")).toBe(PRODUCTION_API_URL);
    expect(normalizeBaseUrl("https://arthasense-ai.onrender.com///")).toBe(PRODUCTION_API_URL);
  });
  it("joins without duplicate or missing slashes and keeps the /api/v1 prefix", () => {
    const want = "https://arthasense-ai.onrender.com/api/v1/indicators/cpi?limit=1";
    expect(joinUrl("https://arthasense-ai.onrender.com", "/api/v1/indicators/cpi?limit=1")).toBe(want);
    expect(joinUrl("https://arthasense-ai.onrender.com/", "/api/v1/indicators/cpi?limit=1")).toBe(want);
    expect(joinUrl("https://arthasense-ai.onrender.com/", "api/v1/indicators/cpi?limit=1")).toBe(want);
    expect(joinUrl("http://127.0.0.1:8000", "/health")).toBe("http://127.0.0.1:8000/health");
  });
  it("recognises loopback addresses only", () => {
    for (const u of ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "http://0.0.0.0:8000"]) expect(isLoopback(u)).toBe(true);
    expect(isLoopback(PRODUCTION_API_URL)).toBe(false);
    expect(isLoopback("not a url")).toBe(false);
  });
});

describe("configuration diagnosis", () => {
  it("flags an unset URL on Vercel with the exact fix (the real production symptom)", () => {
    const p = configProblem(LOCAL_API_URL, { onVercel: true, production: true });
    expect(p).toContain("ARTHASENSE_API_URL is not set on Vercel");
    expect(p).toContain(PRODUCTION_API_URL);
  });
  it("accepts the production URL and the local default locally", () => {
    expect(configProblem(PRODUCTION_API_URL, { onVercel: true, production: true })).toBeNull();
    expect(configProblem(LOCAL_API_URL, { onVercel: false, production: false })).toBeNull();
    expect(configProblem(LOCAL_API_URL, { onVercel: false, production: true })).toBeNull(); // `next start` on your own PC
  });
  it("rejects invalid URLs and plain http for a remote production host", () => {
    expect(configProblem("not a url", { onVercel: false, production: false })).toContain("not a valid URL");
    expect(configProblem("http://api.example.com", { onVercel: true, production: true })).toContain("https");
  });
});

describe("fetch policy", () => {
  it("has safe defaults and ignores out-of-range or non-numeric values", () => {
    expect(readFetchPolicy({})).toEqual({ timeoutMs: 20000, attempts: 2, retryDelayMs: 2000 });
    expect(readFetchPolicy({ ARTHASENSE_API_TIMEOUT_MS: "45000", ARTHASENSE_API_ATTEMPTS: "3", ARTHASENSE_API_RETRY_DELAY_MS: "0" })).toEqual({ timeoutMs: 45000, attempts: 3, retryDelayMs: 0 });
    expect(readFetchPolicy({ ARTHASENSE_API_TIMEOUT_MS: "999999999", ARTHASENSE_API_ATTEMPTS: "50", ARTHASENSE_API_RETRY_DELAY_MS: "abc" })).toEqual({ timeoutMs: 20000, attempts: 2, retryDelayMs: 2000 });
  });
  it("treats only gateway-style statuses as transient", () => {
    expect([502, 503, 504].every(isTransientStatus)).toBe(true);
    expect([200, 400, 404, 422, 500].some(isTransientStatus)).toBe(false);
  });
});

describe("API client against a mocked backend (cold start, retries, errors)", () => {
  beforeEach(() => {
    process.env.ARTHASENSE_API_RETRY_DELAY_MS = "0";
    process.env.ARTHASENSE_API_ATTEMPTS = "3";
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ARTHASENSE_API_ATTEMPTS;
    delete process.env.ARTHASENSE_API_URL;
    vi.resetModules();
  });
  const body = { indicator: "CPI", base_year: "2024", geography: "All India", sector: "Combined", division: "CPI (General)", source: { name: "MoSPI" }, observations: [] };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

  it("uses ARTHASENSE_API_URL (no trailing slash issue) and the /api/v1 prefix", async () => {
    process.env.ARTHASENSE_API_URL = "https://arthasense-ai.onrender.com/";
    const f = vi.fn<(url: string) => Promise<Response>>(async () => json(body));
    vi.stubGlobal("fetch", f);
    const { getIndicator, API_URL } = await import("@/lib/api");
    expect(API_URL).toBe("https://arthasense-ai.onrender.com");
    expect((await getIndicator("cpi")).ok).toBe(true);
    expect(f.mock.calls[0][0]).toBe("https://arthasense-ai.onrender.com/api/v1/indicators/cpi?limit=240");
  });

  it("survives a cold start: 503 then success on retry, and never fabricates data", async () => {
    process.env.ARTHASENSE_API_URL = "https://arthasense-ai.onrender.com";
    let n = 0;
    const f = vi.fn(async () => (++n < 3 ? json({ detail: "waking up" }, 503) : json(body)));
    vi.stubGlobal("fetch", f);
    const { getIndicator } = await import("@/lib/api");
    const r = await getIndicator("cpi");
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("gives up after the bounded number of attempts with the real error", async () => {
    process.env.ARTHASENSE_API_URL = "https://arthasense-ai.onrender.com";
    const f = vi.fn(async () => json({ detail: "database unavailable" }, 503));
    vi.stubGlobal("fetch", f);
    const { getIndicator } = await import("@/lib/api");
    expect(await getIndicator("cpi")).toEqual({ ok: false, error: "API answered HTTP 503: database unavailable" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent conditions (404, 422, not migrated, not configured)", async () => {
    process.env.ARTHASENSE_API_URL = "https://arthasense-ai.onrender.com";
    const { getRunDetail, getIndicator, getForecastSeries } = await import("@/lib/api");
    for (const [status, detail] of [[404, "run not found"], [422, "bad"], [503, "forecasting tables not migrated: run python -m db.migrate"], [503, "database is not configured"]] as const) {
      const f = vi.fn(async () => json({ detail }, status));
      vi.stubGlobal("fetch", f);
      await getRunDetail(1);
      await getIndicator("wpi");
      await getForecastSeries();
      expect(f, `${status} ${detail}`).toHaveBeenCalledTimes(3); // exactly one call per request: three requests, no retries
    }
  });

  it("retries a network failure, then reports it", async () => {
    process.env.ARTHASENSE_API_URL = "https://arthasense-ai.onrender.com";
    const f = vi.fn(async () => Promise.reject(new Error("ECONNRESET")));
    vi.stubGlobal("fetch", f);
    const { getIndicator } = await import("@/lib/api");
    expect(await getIndicator("iip")).toEqual({ ok: false, error: "ECONNRESET" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("explains a missing ARTHASENSE_API_URL on Vercel instead of a bare network error", async () => {
    delete process.env.ARTHASENSE_API_URL;
    process.env.VERCEL = "1";
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("fetch failed"))));
    const { getIndicator, apiConfigProblem } = await import("@/lib/api");
    const r = await getIndicator("cpi");
    delete process.env.VERCEL;
    expect(r.ok === false && r.error).toContain("ARTHASENSE_API_URL is not set on Vercel");
    expect(apiConfigProblem).toBeTypeOf("function");
  });

  it("health check is a single quick attempt and reports unreachable honestly", async () => {
    process.env.ARTHASENSE_API_URL = "https://arthasense-ai.onrender.com";
    const f = vi.fn(async () => Promise.reject(new Error("timed out")));
    vi.stubGlobal("fetch", f);
    const { getApiHealth } = await import("@/lib/api");
    expect(await getApiHealth()).toEqual({ reachable: false, error: "timed out" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
