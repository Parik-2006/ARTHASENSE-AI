/** Pure filtering, sorting, paging and URL handling for the Experiments table. */

import type { Run } from "@/lib/forecasting";

export type SortKey = "created_at" | "mae" | "mase" | "n_origins";

export interface ExperimentFilters {
  indicator: string | null;
  model: string | null;
  status: string | null;
  kind: string | null;
  horizon: number | null;
  minOrigins: number | null;
  /** Free text: matches a run id ("12", "#12") or the model name. */
  q: string;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number; // 1-based
}

export const PAGE_SIZE = 25;
export const DEFAULT_EXPERIMENT_FILTERS: ExperimentFilters = {
  indicator: null, model: null, status: null, kind: null, horizon: null, minOrigins: null, q: "", sort: "created_at", dir: "desc", page: 1,
}; // prettier-ignore

const INDICATORS = ["cpi", "wpi", "iip"];
const STATUSES = ["completed", "skipped", "failed"];
const KINDS = ["backtest", "forecast"];
const SORTS: SortKey[] = ["created_at", "mae", "mase", "n_origins"];

const oneOf = (v: string | null, list: string[]) => (v !== null && list.includes(v) ? v : null);
const posInt = (v: string | null) => {
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Reads the URL. Anything invalid is dropped (never throws, never trusted). */
export function parseExperimentFilters(get: (k: string) => string | null, knownModels: string[] = []): ExperimentFilters {
  const m = get("model");
  const sort = SORTS.includes(get("sort") as SortKey) ? (get("sort") as SortKey) : "created_at";
  return {
    indicator: oneOf(get("indicator"), INDICATORS),
    model: m !== null && knownModels.includes(m) ? m : null,
    status: oneOf(get("status"), STATUSES),
    kind: oneOf(get("kind"), KINDS),
    horizon: posInt(get("horizon")),
    minOrigins: posInt(get("minOrigins")),
    q: (get("q") ?? "").slice(0, 60),
    sort,
    dir: get("dir") === "asc" ? "asc" : "desc",
    page: posInt(get("page")) ?? 1,
  };
}

export function serializeExperimentFilters(f: ExperimentFilters): URLSearchParams {
  const p = new URLSearchParams();
  const d = DEFAULT_EXPERIMENT_FILTERS;
  for (const k of ["indicator", "model", "status", "kind"] as const) if (f[k]) p.set(k, f[k] as string);
  if (f.horizon) p.set("horizon", String(f.horizon));
  if (f.minOrigins) p.set("minOrigins", String(f.minOrigins));
  if (f.q) p.set("q", f.q);
  if (f.sort !== d.sort) p.set("sort", f.sort);
  if (f.dir !== d.dir) p.set("dir", f.dir);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

export function applyExperimentFilters(runs: Run[], f: ExperimentFilters): Run[] {
  const raw = f.q.trim().toLowerCase();
  const q = raw.replace(/^#/, "");
  const idOnly = /^\d+$/.test(q); // "12" or "#12" means run id 12, never a substring of a model name
  const kept = runs.filter(
    (r) =>
      (!f.indicator || r.indicator === f.indicator) &&
      (!f.model || r.model === f.model) &&
      (!f.status || r.status === f.status) &&
      (!f.kind || r.kind === f.kind) &&
      (!f.horizon || r.horizon === f.horizon) &&
      (!f.minOrigins || (r.n_origins ?? 0) >= f.minOrigins) &&
      (!q || (idOnly ? String(r.id) === q : r.model_name.toLowerCase().includes(q) || r.model.toLowerCase().includes(q))),
  );
  const val = (r: Run): number | string | null => (f.sort === "created_at" ? r.created_at : f.sort === "n_origins" ? r.n_origins : (r.metrics[f.sort] ?? null));
  return [...kept].sort((a, b) => {
    const [x, y] = [val(a), val(b)];
    if (x === null && y === null) return 0;
    if (x === null) return 1; // missing values always last
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (f.dir === "asc" ? 1 : -1);
  });
}

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages };
}
