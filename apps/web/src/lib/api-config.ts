/** Server-side API configuration. Pure functions so they can be unit-tested.
 *
 *  The browser never calls the FastAPI service: every request is made by the Next.js server using
 *  ARTHASENSE_API_URL (deliberately NOT a NEXT_PUBLIC_ variable, so nothing is exposed to the browser).
 *  Local default: http://127.0.0.1:8000. Production (Vercel): https://arthasense-ai.onrender.com
 */

export const LOCAL_API_URL = "http://127.0.0.1:8000";
export const PRODUCTION_API_URL = "https://arthasense-ai.onrender.com";
export const PRODUCTION_SITE_URL = "https://arthasense-ai.vercel.app";

/** Trims whitespace and trailing slashes so joined paths never contain "//". */
export function normalizeBaseUrl(raw: string | undefined): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  return v === "" ? LOCAL_API_URL : v;
}

/** Joins a base URL and a path with exactly one slash between them. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

/** A human-readable configuration problem, or null when the configuration looks sane for the environment. */
export function configProblem(apiUrl: string, env: { onVercel: boolean; production: boolean }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    return `ARTHASENSE_API_URL is not a valid URL: "${apiUrl}"`;
  }
  if (env.onVercel && isLoopback(apiUrl)) {
    return (
      "ARTHASENSE_API_URL is not set on Vercel, so the app is trying to reach a local address. " +
      `Set it to ${PRODUCTION_API_URL} in Vercel (Project, Settings, Environment Variables) and redeploy.`
    );
  }
  if (env.production && parsed.protocol !== "https:" && !isLoopback(apiUrl)) {
    return "ARTHASENSE_API_URL should use https:// in production.";
  }
  return null;
}

/** Per-request timeout and retry policy. A free Render instance can take about a minute to wake up. */
export interface FetchPolicy {
  timeoutMs: number;
  attempts: number;
  retryDelayMs: number;
}

export function readFetchPolicy(env: Record<string, string | undefined>): FetchPolicy {
  const num = (v: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    timeoutMs: num(env.ARTHASENSE_API_TIMEOUT_MS, 20000, 1000, 120000),
    attempts: Math.round(num(env.ARTHASENSE_API_ATTEMPTS, 2, 1, 4)),
    retryDelayMs: num(env.ARTHASENSE_API_RETRY_DELAY_MS, 2000, 0, 15000),
  };
}

/** Statuses that mean "the server is not ready yet" (a sleeping or restarting instance), not "your request is wrong". */
export function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}
