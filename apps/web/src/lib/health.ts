import type { StatusTone } from "@/components/ui/primitives";

/** Shape returned by the FastAPI `/health` endpoint (services/api/app/main.py). */
export interface ApiHealth {
  status: "ok" | "degraded";
  service: string;
  version: string;
  database: { status: "ok" | "unavailable" | "not_configured"; detail?: string | null };
}

export type HealthResult =
  | { reachable: true; health: ApiHealth }
  | { reachable: false; error: string };

export function parseApiHealth(json: unknown): ApiHealth | null {
  if (typeof json !== "object" || json === null) return null;
  const j = json as Record<string, unknown>;
  const db = j.database as Record<string, unknown> | undefined;
  if (
    (j.status !== "ok" && j.status !== "degraded") ||
    typeof j.service !== "string" ||
    typeof j.version !== "string" ||
    !db ||
    !["ok", "unavailable", "not_configured"].includes(db.status as string)
  ) {
    return null;
  }
  return j as unknown as ApiHealth;
}

export function apiTone(r: HealthResult): StatusTone {
  if (!r.reachable) return "down";
  return r.health.status === "ok" ? "ok" : "warn";
}

export function dbTone(r: HealthResult): StatusTone {
  if (!r.reachable) return "unknown";
  switch (r.health.database.status) {
    case "ok":
      return "ok";
    case "not_configured":
      return "warn";
    default:
      return "down";
  }
}
