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
