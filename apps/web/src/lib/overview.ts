/** Pure calculations for Overview V2: ranges, derived changes, comparison windows, heatmap grids.
 *  No I/O and no invented numbers: every value is computed from stored observations or is null. */

import { formatPeriod, monthNumber, type Observation } from "@/lib/indicator";

// ---------- ranges ----------

export type RangeKey = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "All" | "Custom";

export const OV_RANGES: { key: RangeKey; label: string; months: number | null }[] = [
  { key: "3M", label: "3M", months: 3 },
  { key: "6M", label: "6M", months: 6 },
  { key: "1Y", label: "1Y", months: 12 },
  { key: "2Y", label: "2Y", months: 24 },
  { key: "3Y", label: "3Y", months: 36 },
  { key: "5Y", label: "5Y", months: 60 },
  { key: "All", label: "All", months: null },
  { key: "Custom", label: "Custom", months: null },
];

export interface RangeSel {
  key: RangeKey;
  /** "YYYY-MM", only for Custom */
  from: string | null;
  to: string | null;
}

export const DEFAULT_RANGE: RangeSel = { key: "All", from: null, to: null };

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" to the same month number as `monthNumber`; null if malformed. */
export function ymNumber(ym: string | null): number | null {
  const m = ym ? YM_RE.exec(ym) : null;
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

export function ymLabel(ym: string): string {
  const n = ymNumber(ym);
  return n === null ? ym : formatPeriod(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`);
}

/** Validates URL-style inputs. Anything invalid falls back to All and reports why (never silently). */
export function parseRange(
  range: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): { sel: RangeSel; error: string | null } {
  if (!range) return { sel: DEFAULT_RANGE, error: null };
  const def = OV_RANGES.find((r) => r.key === range);
  if (!def) return { sel: DEFAULT_RANGE, error: `Unknown range "${range}"; showing all available data.` };
  if (def.key !== "Custom") return { sel: { key: def.key, from: null, to: null }, error: null };
  const lo = ymNumber(from ?? null);
  const hi = ymNumber(to ?? null);
  if (lo === null || hi === null) {
    return { sel: DEFAULT_RANGE, error: "A custom range needs a valid start and end month (YYYY-MM)." };
  }
  if (lo > hi) return { sel: DEFAULT_RANGE, error: "The start month must not be after the end month." };
  return { sel: { key: "Custom", from: from!, to: to! }, error: null };
}

export interface Window {
  lo: number | null;
  hi: number | null;
}

/** Month-number window for a selection. Relative presets are anchored at `anchor` (a series' latest month). */
export function windowFor(sel: RangeSel, anchor: number | null): Window {
  if (sel.key === "Custom") return { lo: ymNumber(sel.from), hi: ymNumber(sel.to) };
  const months = OV_RANGES.find((r) => r.key === sel.key)?.months ?? null;
  if (months === null || anchor === null) return { lo: null, hi: null };
  return { lo: anchor - (months - 1), hi: anchor };
}

export function inWindow(n: number, w: Window): boolean {
  return (w.lo === null || n >= w.lo) && (w.hi === null || n <= w.hi);
}

export function latestMonth(rows: { period: string }[]): number | null {
  let best: number | null = null;
  for (const r of rows) {
    const n = monthNumber(r.period);
    if (best === null || n > best) best = n;
  }
  return best;
}

/** Per-series range: relative presets end at that series' own latest month. */
export function applyRange<T extends { period: string }>(rows: T[], sel: RangeSel): T[] {
  const w = windowFor(sel, latestMonth(rows));
  return rows.filter((r) => inWindow(monthNumber(r.period), w));
}

// ---------- derived metrics ----------

export interface Derived {
  period: string;
  n: number;
  index: number | null;
  /** Calculated month-over-month %, only across consecutive months. */
  mom: number | null;
  /** Calculated year-over-year % from the index, only when the same month a year earlier is stored. */
  yoyCalc: number | null;
  /** Official year-on-year rate exactly as published (null when the source has none). */
  rate: number | null;
}

/** All derivations happen inside ONE series (one base year). Never pass rows of two bases together. */
export function derive(observations: Observation[]): Derived[] {
  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  const byN = new Map<number, Observation>();
  for (const o of sorted) byN.set(monthNumber(o.period), o);
  const pct = (cur: number | null, prev: number | null | undefined) =>
    cur !== null && prev !== null && prev !== undefined && prev !== 0 ? (cur / prev - 1) * 100 : null;
  return sorted.map((o) => {
    const n = monthNumber(o.period);
    return {
      period: o.period,
      n,
      index: o.index,
      mom: pct(o.index, byN.get(n - 1)?.index),
      yoyCalc: pct(o.index, byN.get(n - 12)?.index),
      rate: o.rate,
    };
  });
}

export type MetricKey = "index" | "mom" | "yoyCalc" | "rate";

export function metricValue(d: Derived, metric: MetricKey): number | null {
  return d[metric];
}

/** Calendar months between first and last stored month that have no value. */
export function coverage(observations: Observation[]): {
  first: string | null;
  last: string | null;
  count: number;
  expected: number;
  missing: string[];
} {
  const valid = observations.filter((o) => o.index !== null);
  if (!valid.length) return { first: null, last: null, count: 0, expected: 0, missing: [] };
  const ns = valid.map((o) => monthNumber(o.period));
  const [lo, hi] = [Math.min(...ns), Math.max(...ns)];
  const have = new Set(ns);
  const missing: string[] = [];
  for (let n = lo; n <= hi; n++) {
    if (!have.has(n)) missing.push(formatPeriod(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`));
  }
  const sorted = [...valid].sort((a, b) => a.period.localeCompare(b.period));
  return {
    first: sorted[0].period,
    last: sorted[sorted.length - 1].period,
    count: valid.length,
    expected: hi - lo + 1,
    missing,
  };
}

// ---------- cross-indicator comparison ----------

/** Calendar window shared by all given series, intersected with the selection.
 *  Relative presets end at the EARLIEST of the series' latest months, so every series is observed
 *  over the same months. Returns null when no common month exists. */
export function commonWindow(seriesRows: { period: string }[][], sel: RangeSel): { lo: number; hi: number } | null {
  const spans = seriesRows.filter((r) => r.length).map((r) => [Math.min(...r.map((x) => monthNumber(x.period))), latestMonth(r)!]);
  if (spans.length !== seriesRows.length || !spans.length) return null;
  const lo0 = Math.max(...spans.map((s) => s[0]));
  const hi0 = Math.min(...spans.map((s) => s[1]));
  const w = windowFor(sel, hi0);
  const lo = Math.max(lo0, w.lo ?? lo0);
  const hi = Math.min(hi0, w.hi ?? hi0);
  return lo <= hi ? { lo, hi } : null;
}

/** Percent change from the first month in `rows` that has an index (the common starting observation).
 *  Months with no index stay null. Returns the start period too, for labelling. */
export function rebasePercent(rows: Derived[]): { start: string | null; values: Map<number, number | null> } {
  const first = rows.find((r) => r.index !== null && r.index !== 0);
  const values = new Map<number, number | null>();
  if (!first) return { start: null, values };
  for (const r of rows) values.set(r.n, r.index === null ? null : (r.index / (first.index as number) - 1) * 100);
  return { start: first.period, values };
}

// ---------- heatmap ----------

export interface HeatRow {
  year: number;
  cells: (number | null)[]; // 12 entries, Jan..Dec
}

export function heatGrid(points: { n: number; v: number | null }[]): HeatRow[] {
  if (!points.length) return [];
  const years = points.map((p) => Math.floor(p.n / 12));
  const [y0, y1] = [Math.min(...years), Math.max(...years)];
  const rows: HeatRow[] = [];
  for (let y = y0; y <= y1; y++) rows.push({ year: y, cells: Array<number | null>(12).fill(null) });
  for (const p of points) rows[Math.floor(p.n / 12) - y0].cells[p.n % 12] = p.v;
  return rows;
}

/** Symmetric scale limit so zero is always the neutral colour. */
export function symmetricLimit(values: (number | null)[]): number {
  const m = Math.max(0, ...values.filter((v): v is number => v !== null).map(Math.abs));
  return m === 0 ? 1 : m;
}

export function fmtPct(v: number | null, digits = 2): string {
  if (v === null) return "Not available";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
