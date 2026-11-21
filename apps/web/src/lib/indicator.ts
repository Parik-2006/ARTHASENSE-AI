/** Shared data model, parsing and calculations for the monthly index indicators (CPI, WPI, IIP).
 *  Pure functions: no I/O. Shapes mirror services/api/app/indicators.py. */

export type IndicatorKey = "cpi" | "wpi" | "iip";

export interface Provenance {
  releaseKey: string;
  retrievedAt: string; // ISO timestamp of OUR retrieval, not an official publication time
  publishedAt: string | null;
}

export interface Observation {
  period: string; // "YYYY-MM-01"
  index: number | null;
  /** Official year-on-year %, exactly as reported: inflation (CPI) or growth (IIP). Never computed here. */
  rate: number | null;
  indexSource: Provenance | null;
  rateSource: Provenance | null;
}

export interface IndicatorData {
  kind: IndicatorKey;
  baseYear: string;
  /** One line describing exactly what the series covers, e.g. "India · All commodities (headline)". */
  coverage: string;
  geography: string;
  sourceName: string;
  /** Source URL exactly as the API reports it; null when absent. */
  sourceUrl?: string | null;
  publisherNote: string | null;
  limitations: string[];
  observations: Observation[]; // chronological
  note: string | null;
}

export type IndicatorResult = { ok: true; data: IndicatorData } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const PERIOD_RE = /^(\d{4})-(\d{2})-01$/;

function parseNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined; // undefined = malformed
}

function parseProvenance(v: unknown): Provenance | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isRecord(v) || typeof v.release_key !== "string" || typeof v.retrieved_at !== "string") return undefined;
  return {
    releaseKey: v.release_key,
    retrievedAt: v.retrieved_at,
    publishedAt: typeof v.published_at === "string" ? v.published_at : null,
  };
}

/** Which JSON field carries the official year-on-year value for each indicator (WPI has none). */
const RATE_FIELD: Record<IndicatorKey, "inflation" | "growth" | null> = {
  cpi: "inflation",
  wpi: null,
  iip: "growth",
};

/** Returns null for anything that is not the documented shape: we never guess. */
export function parseIndicatorResponse(json: unknown, kind: IndicatorKey): IndicatorData | null {
  if (!isRecord(json) || !Array.isArray(json.observations)) return null;
  if (typeof json.base_year !== "string" || typeof json.geography !== "string") return null;
  if (!isRecord(json.source) || typeof json.source.name !== "string") return null;

  let coverage: string;
  if (kind === "cpi") {
    if (typeof json.sector !== "string" || typeof json.division !== "string") return null;
    coverage = `${json.geography} · ${json.sector} · ${json.division}`;
  } else if (kind === "wpi") {
    if (typeof json.coverage !== "string") return null;
    coverage = `${json.geography} · ${json.coverage}`;
  } else {
    if (!isRecord(json.sector) || typeof json.sector.label !== "string") return null;
    coverage = `${json.geography} · ${json.sector.label}`;
  }

  const rateField = RATE_FIELD[kind];
  const observations: Observation[] = [];
  for (const o of json.observations) {
    if (!isRecord(o) || typeof o.period !== "string" || !PERIOD_RE.test(o.period)) return null;
    const index = parseNumber(o.index);
    const rate = rateField ? parseNumber(o[rateField]) : null;
    const indexSource = parseProvenance(o.index_source);
    const rateSource = rateField ? parseProvenance(o[`${rateField}_source`]) : null;
    if (index === undefined || rate === undefined) return null;
    if (indexSource === undefined || rateSource === undefined) return null;
    observations.push({ period: o.period, index, rate, indexSource, rateSource });
  }
  observations.sort((a, b) => a.period.localeCompare(b.period));
  return {
    kind,
    baseYear: json.base_year,
    coverage,
    geography: json.geography,
    sourceName: json.source.name,
    sourceUrl: typeof json.source.url === "string" ? json.source.url : null,
    publisherNote: typeof json.publisher_note === "string" ? json.publisher_note : null,
    limitations: Array.isArray(json.limitations) ? json.limitations.filter((x) => typeof x === "string") : [],
    observations,
    note: typeof json.note === "string" ? json.note : null,
  };
}

// ---------- periods ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]; // prettier-ignore

/** Months since year 0; consecutive months differ by exactly 1. */
export function monthNumber(period: string): number {
  const m = PERIOD_RE.exec(period);
  if (!m) throw new Error(`Bad period: ${period}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

export function formatPeriod(period: string, long = false): string {
  const n = monthNumber(period);
  const names = long ? MONTHS_LONG : MONTHS;
  return `${names[n % 12]} ${Math.floor(n / 12)}`;
}

export function formatIndex(v: number | null): string {
  return v === null ? "Not available" : v.toFixed(2);
}

export function formatPercent(v: number | null, signed = false): string {
  if (v === null) return "Not available";
  const s = v.toFixed(2);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

/** Timestamps are shown in IST with an explicit zone so server and browser render identically. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return `${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d)} IST`;
}

// ---------- calculations ----------

export interface Row extends Observation {
  /** Calculated (not official) month-over-month % change; null unless the previous month is present. */
  mom: number | null;
}

/** MoM only across consecutive months with a valid, non-zero previous index. */
export function withMomChange(observations: Observation[]): Row[] {
  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.map((o, i) => {
    const prev = sorted[i - 1];
    let mom: number | null = null;
    if (
      prev &&
      monthNumber(o.period) - monthNumber(prev.period) === 1 &&
      o.index !== null &&
      prev.index !== null &&
      prev.index !== 0
    ) {
      mom = (o.index / prev.index - 1) * 100;
    }
    return { ...o, mom };
  });
}

export function latestObservation<T extends Observation>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.index !== null && (!best || r.period > best.period)) best = r;
  return best;
}

/** Latest month for which the source supplied an official year-on-year value. */
export function latestRate(rows: Observation[]): Observation | null {
  let best: Observation | null = null;
  for (const r of rows) if (r.rate !== null && (!best || r.period > best.period)) best = r;
  return best;
}

export type RangeKey = "3M" | "6M" | "1Y" | "All";
export const RANGES: { key: RangeKey; label: string; months: number | null }[] = [
  { key: "3M", label: "3M", months: 3 },
  { key: "6M", label: "6M", months: 6 },
  { key: "1Y", label: "1Y", months: 12 },
  { key: "All", label: "All available", months: null },
];

/** Calendar window ending at the latest stored month (e.g. 3M = latest month and the 2 before it). */
export function filterRange<T extends Observation>(rows: T[], range: RangeKey): T[] {
  const months = RANGES.find((r) => r.key === range)?.months ?? null;
  const latest = latestObservation(rows);
  if (months === null || !latest) return rows;
  const first = monthNumber(latest.period) - (months - 1);
  return rows.filter((r) => monthNumber(r.period) >= first);
}

/** Calendar months with no stored observation between the first and last row. */
export function missingMonths(rows: Observation[]): string[] {
  if (rows.length < 2) return [];
  const have = new Set(rows.map((r) => monthNumber(r.period)));
  const lo = Math.min(...have);
  const hi = Math.max(...have);
  const out: string[] = [];
  for (let n = lo + 1; n < hi; n++) {
    if (!have.has(n)) out.push(formatPeriod(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`));
  }
  return out;
}

export function distinctSnapshots(rows: Observation[]): Provenance[] {
  const byKey = new Map<string, Provenance>();
  for (const r of rows) for (const p of [r.indexSource, r.rateSource]) if (p) byKey.set(p.releaseKey, p);
  return [...byKey.values()].sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt));
}

export function lastRetrievedAt(rows: Observation[]): string | null {
  const snaps = distinctSnapshots(rows);
  return snaps.length ? snaps[snaps.length - 1].retrievedAt : null;
}

export type SortKey = "period" | "index" | "mom";

/** Stable sort for the table; missing values always go last, whatever the direction. */
export function sortRows(rows: Row[], key: SortKey, dir: "asc" | "desc"): Row[] {
  const val = (r: Row) => (key === "period" ? r.period : key === "index" ? r.index : r.mom);
  return [...rows].sort((a, b) => {
    const [x, y] = [val(a), val(b)];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1);
  });
}

// ---------- CSV ----------

function csvCell(v: string | number | null): string {
  if (v === null) return ""; // missing stays empty, never 0
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `rateColumn` names the official column, e.g. "yoy_inflation_pct_official". Null: no such column. */
export function toCsv(rows: Row[], meta: { source: string; indexColumn: string; rateColumn: string | null }): string {
  const header = [
    "period", meta.indexColumn, "mom_change_pct_calculated",
    ...(meta.rateColumn ? [meta.rateColumn] : []),
    "source", "release_key", "retrieved_at",
  ]; // prettier-ignore
  const lines = rows.map((r) =>
    [
      r.period,
      r.index,
      r.mom === null ? null : r.mom.toFixed(4),
      ...(meta.rateColumn ? [r.rate] : []),
      meta.source,
      r.indexSource?.releaseKey ?? null,
      r.indexSource?.retrievedAt ?? null,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
