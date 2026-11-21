/** Pure analysis helpers for Indicators V2: windows, derived metrics, URL state. No I/O.
 *  Derived metrics are computed on the FULL stored series and only then cut to the visible window,
 *  so a short window never loses a MoM/YoY value whose reference month lies outside it. */

import { formatPeriod, monthNumber, type Observation, type Row } from "@/lib/indicator";

// ---------- derived rows ----------

export interface AnalysisRow extends Row {
  /** Calculated (not official) year-on-year % change vs. the same month one year earlier. */
  yoy: number | null;
}

export function periodOf(n: number): string {
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
}

/** MoM (t-1) and YoY (t-12) by calendar-month arithmetic. One series, one base year per call. */
export function withDerived(observations: Observation[]): AnalysisRow[] {
  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  const byMonth = new Map<number, number>();
  for (const o of sorted) if (o.index !== null && o.index !== 0) byMonth.set(monthNumber(o.period), o.index);
  const pct = (cur: number | null, ref: number | undefined) =>
    cur === null || ref === undefined ? null : (cur / ref - 1) * 100;
  return sorted.map((o) => {
    const n = monthNumber(o.period);
    return { ...o, mom: pct(o.index, byMonth.get(n - 1)), yoy: pct(o.index, byMonth.get(n - 12)) };
  });
}

// ---------- ranges ----------

export type RangeKey = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "All" | "Custom";
export const RANGE_KEYS: RangeKey[] = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "All", "Custom"];
const PRESET_MONTHS: Record<Exclude<RangeKey, "All" | "Custom">, number> = {
  "3M": 3,
  "6M": 6,
  "1Y": 12,
  "2Y": 24,
  "3Y": 36,
  "5Y": 60,
};

export interface Window {
  start: number; // month numbers, inclusive
  end: number;
}

export type CustomRange = { start: string; end: string }; // "YYYY-MM"

export function monthInputToNumber(v: string): number | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

export type CustomCheck = { ok: true; window: Window } | { ok: false; error: string };

/** Validates a custom month range against what is stored. Never invents months beyond the data. */
export function checkCustomRange(custom: CustomRange | null, rows: Observation[]): CustomCheck {
  const s = custom ? monthInputToNumber(custom.start) : null;
  const e = custom ? monthInputToNumber(custom.end) : null;
  if (s === null || e === null) return { ok: false, error: "Choose both a start month and an end month." };
  if (s > e) return { ok: false, error: "The start month must not be after the end month." };
  const have = rows.filter((r) => r.index !== null).map((r) => monthNumber(r.period));
  if (!have.length) return { ok: false, error: "No observations are stored." };
  if (s > Math.max(...have)) {
    return { ok: false, error: `No observations exist after ${formatPeriod(periodOf(Math.max(...have)), true)}.` };
  }
  return { ok: true, window: { start: s, end: Math.min(e, Math.max(...have)) } };
}

/** Relative presets end at the series' OWN latest stored month, never at today's date. */
export function resolveWindow(rows: Observation[], range: RangeKey, custom: CustomRange | null = null): Window | null {
  const ns = rows.filter((r) => r.index !== null).map((r) => monthNumber(r.period));
  if (!ns.length) return null;
  const [lo, hi] = [Math.min(...ns), Math.max(...ns)];
  if (range === "All") return { start: lo, end: hi };
  if (range === "Custom") {
    const c = checkCustomRange(custom, rows);
    return c.ok ? c.window : null;
  }
  return { start: hi - (PRESET_MONTHS[range] - 1), end: hi };
}

export function inWindow<T extends Observation>(rows: T[], w: Window | null): T[] {
  if (!w) return [];
  return rows.filter((r) => {
    const n = monthNumber(r.period);
    return n >= w.start && n <= w.end;
  });
}

/** Months a preset asks for beyond what is stored (to say honestly "5Y requested, 3Y available"). */
export function availableSpanMonths(rows: Observation[]): number {
  const ns = rows.filter((r) => r.index !== null).map((r) => monthNumber(r.period));
  return ns.length ? Math.max(...ns) - Math.min(...ns) + 1 : 0;
}

export function presetShortfall(rows: Observation[], range: RangeKey): number {
  if (range === "All" || range === "Custom") return 0;
  return Math.max(0, PRESET_MONTHS[range] - availableSpanMonths(rows));
}

/** Common calendar window: the months every series has data for (intersection of their spans). */
export function commonWindow(series: Observation[][]): Window | null {
  let start = -Infinity;
  let end = Infinity;
  for (const rows of series) {
    const ns = rows.filter((r) => r.index !== null).map((r) => monthNumber(r.period));
    if (!ns.length) return null;
    start = Math.max(start, Math.min(...ns));
    end = Math.min(end, Math.max(...ns));
  }
  return start <= end ? { start, end } : null;
}

// ---------- metrics ----------

export type MetricKey = "index" | "mom" | "yoy" | "official";
export const METRIC_KEYS: MetricKey[] = ["index", "mom", "yoy", "official"];

export const METRIC_LABEL: Record<MetricKey, string> = {
  index: "Index level",
  mom: "Month-over-month % (calculated)",
  yoy: "Year-over-year % (calculated)",
  official: "Official published rate %",
};

export function metricValue(r: AnalysisRow, m: MetricKey): number | null {
  return m === "index" ? r.index : m === "mom" ? r.mom : m === "yoy" ? r.yoy : r.rate;
}

/** Trailing 3-month average (this and the 2 prior months) over consecutive calendar months. Null if any month is missing
 *  (smoothing must never bridge a data gap). Calculated, not official. */
export function movingAverage3(rows: AnalysisRow[], m: MetricKey = "index"): (number | null)[] {
  const byMonth = new Map<number, number>();
  for (const r of rows) {
    const v = metricValue(r, m);
    if (v !== null) byMonth.set(monthNumber(r.period), v);
  }
  return rows.map((r) => {
    const n = monthNumber(r.period);
    const vs = [n - 2, n - 1, n].map((k) => byMonth.get(k));
    return vs.every((v) => v !== undefined) ? (vs as number[]).reduce((a, b) => a + b, 0) / 3 : null;
  });
}

// ---------- heatmap / seasonal ----------

export interface HeatCell {
  year: number;
  month: number; // 0-11
  value: number | null;
}

export function heatmapRows(rows: AnalysisRow[], m: MetricKey): { years: number[]; cells: HeatCell[][] } {
  const vals = new Map<number, number | null>();
  for (const r of rows) vals.set(monthNumber(r.period), metricValue(r, m));
  const ns = rows.map((r) => monthNumber(r.period));
  if (!ns.length) return { years: [], cells: [] };
  const [y0, y1] = [Math.floor(Math.min(...ns) / 12), Math.floor(Math.max(...ns) / 12)];
  const years: number[] = [];
  const cells: HeatCell[][] = [];
  for (let y = y0; y <= y1; y++) {
    years.push(y);
    cells.push(Array.from({ length: 12 }, (_, mo) => ({ year: y, month: mo, value: vals.get(y * 12 + mo) ?? null })));
  }
  return { years, cells };
}

// ---------- URL state ----------

export interface FilterState {
  range: RangeKey;
  metric: MetricKey;
  custom: CustomRange | null;
}

export const DEFAULT_FILTERS: FilterState = { range: "All", metric: "index", custom: null };

/** Reads ?range=&metric=&from=&to= . Anything invalid falls back to the default; never throws. */
export function parseFilters(get: (k: string) => string | null, allowedMetrics: MetricKey[] = METRIC_KEYS): FilterState {
  const r = get("range");
  const m = get("metric");
  const range = (RANGE_KEYS as string[]).includes(r ?? "") ? (r as RangeKey) : DEFAULT_FILTERS.range;
  const metric = (allowedMetrics as string[]).includes(m ?? "") ? (m as MetricKey) : DEFAULT_FILTERS.metric;
  const [from, to] = [get("from"), get("to")];
  const custom =
    range === "Custom" && from && to && monthInputToNumber(from) !== null && monthInputToNumber(to) !== null
      ? { start: from, end: to }
      : null;
  return { range: range === "Custom" && !custom ? "All" : range, metric, custom };
}

export function serializeFilters(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.range !== DEFAULT_FILTERS.range) p.set("range", f.range);
  if (f.metric !== DEFAULT_FILTERS.metric) p.set("metric", f.metric);
  if (f.range === "Custom" && f.custom) {
    p.set("from", f.custom.start);
    p.set("to", f.custom.end);
  }
  return p;
}

// ---------- CSV (V2) ----------

function csvCell(v: string | number | null): string {
  if (v === null) return ""; // missing stays empty, never 0
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Filtered export with provenance columns. Calculated columns are named as such. */
export function toCsvV2(
  rows: AnalysisRow[],
  meta: { source: string; indexColumn: string; officialColumn: string | null; baseYear: string; seriesId: string },
): string {
  const header = [
    "period", meta.indexColumn, "mom_change_pct_calculated", "yoy_change_pct_calculated",
    ...(meta.officialColumn ? [meta.officialColumn] : []),
    "base_year", "source", "series_id", "release_key", "retrieved_at",
  ]; // prettier-ignore
  const f4 = (v: number | null) => (v === null ? null : v.toFixed(4));
  const lines = rows.map((r) =>
    [
      r.period, r.index, f4(r.mom), f4(r.yoy),
      ...(meta.officialColumn ? [r.rate] : []),
      meta.baseYear, meta.source, meta.seriesId,
      r.indexSource?.releaseKey ?? null, r.indexSource?.retrievedAt ?? null,
    ]
      .map(csvCell)
      .join(","),
  ); // prettier-ignore
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

// ---------- shared (comparison) windows ----------

/** Applies a preset/custom range inside a common window, ending at the common end month. */
export function clipToWindow(common: Window | null, range: RangeKey, custom: CustomRange | null): Window | null {
  if (!common) return null;
  if (range === "All") return common;
  if (range === "Custom") {
    const s = custom ? monthInputToNumber(custom.start) : null;
    const e = custom ? monthInputToNumber(custom.end) : null;
    if (s === null || e === null || s > e) return null;
    const w = { start: Math.max(s, common.start), end: Math.min(e, common.end) };
    return w.start <= w.end ? w : null;
  }
  return { start: Math.max(common.start, common.end - (PRESET_MONTHS[range] - 1)), end: common.end };
}

/** Latest row where the chosen metric exists (so "latest valid change" can name its own month). */
export function latestWithMetric(rows: AnalysisRow[], m: MetricKey): AnalysisRow | null {
  let best: AnalysisRow | null = null;
  for (const r of rows) if (metricValue(r, m) !== null && (!best || r.period > best.period)) best = r;
  return best;
}

// ---------- seasonal overlay ----------

export interface SeasonLine {
  year: number;
  values: (number | null)[]; // Jan..Dec; null = no stored value (a gap, never zero)
}

/** One line per calendar year over Jan-Dec for one metric. Rows must come from ONE series and base year. */
export function seasonalLines(rows: AnalysisRow[], m: MetricKey): SeasonLine[] {
  const byYear = new Map<number, (number | null)[]>();
  for (const r of rows) {
    const n = monthNumber(r.period);
    const y = Math.floor(n / 12);
    const arr = byYear.get(y) ?? Array<number | null>(12).fill(null);
    arr[n % 12] = metricValue(r, m);
    byYear.set(y, arr);
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, values]) => ({ year, values }));
}

/** Starting dates for a freshly chosen Custom range: the latest 12 stored months (or all, if fewer). */
export function seedCustom(rows: Observation[]): CustomRange | null {
  const ns = rows.filter((r) => r.index !== null).map((r) => monthNumber(r.period));
  if (!ns.length) return null;
  const [lo, hi] = [Math.min(...ns), Math.max(...ns)];
  const ym = (n: number) => periodOf(n).slice(0, 7);
  return { start: ym(Math.max(lo, hi - 11)), end: ym(hi) };
}
