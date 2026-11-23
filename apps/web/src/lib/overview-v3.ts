/** Pure logic for Overview V3: URL state, deterministic movement statements and the mixed-frequency comparison.
 *
 *  COMPARISON POLICY (documented, tested):
 *   - CPI, WPI and IIP are monthly; GDP is quarterly (fiscal quarters, Apr-Jun = Q1).
 *   - With only monthly indicators the comparison is MONTHLY and uses the months every selected series shares.
 *   - As soon as GDP is selected the comparison is QUARTERLY. A monthly indicator enters only as the arithmetic
 *     average of its three monthly index values in a fiscal quarter, and only if all three months are stored.
 *     No month is filled in and no GDP value is created, interpolated or spread across months.
 *   - Raw index or GDP levels are never plotted on one axis. Modes are percentage changes or % change from a
 *     common starting period; "separate aligned charts" gives each series its own axis in its own frequency.
 *   - Monthly change does not exist for quarterly GDP, so that mode is replaced (with an explanation) when GDP is selected.
 */

import type { ChartPoint, ChartSeries } from "@/components/overview/time-chart";
import { fiscalQuarterOf, type GdpRow } from "@/lib/gdp";
import { type Derived, inWindow, type RangeSel, windowFor } from "@/lib/overview";

export const OV_KEYS = ["cpi", "wpi", "iip", "gdp"] as const;
export type OvKey = (typeof OV_KEYS)[number];
export const OV_NAMES: Record<OvKey, { short: string; full: string }> = {
  cpi: { short: "CPI", full: "Consumer Price Index" },
  wpi: { short: "WPI", full: "Wholesale Price Index" },
  iip: { short: "IIP", full: "Index of Industrial Production" },
  gdp: { short: "GDP", full: "Gross Domestic Product" },
};
export const OV_STROKE: Record<OvKey, { stroke: string; dash?: string }> = {
  cpi: { stroke: "var(--accent)" },
  wpi: { stroke: "var(--target)", dash: "6 3" },
  iip: { stroke: "var(--down)", dash: "2 3" },
  gdp: { stroke: "var(--up)", dash: "10 3 2 3" },
};

export const parseOpen = (v: string | null | undefined): OvKey | null => (OV_KEYS as readonly string[]).includes(v ?? "") ? (v as OvKey) : null;

/** Selected indicators from "cpi,wpi,iip". Unknown names are dropped; empty/absent means all that are available. */
export function parseCompareSel(v: string | null | undefined, available: OvKey[]): OvKey[] {
  if (v === null || v === undefined) return available;
  const picked = v.split(",").filter((k): k is OvKey => (OV_KEYS as readonly string[]).includes(k) && available.includes(k as OvKey));
  return [...new Set(picked)];
}

export type CmpMode = "mom" | "yoy" | "aligned" | "rebased";
export const parseCmpMode = (v: string | null | undefined): CmpMode => (["mom", "yoy", "aligned", "rebased"].includes(v ?? "") ? (v as CmpMode) : "mom");

// ---------- quarterly aggregation ----------

export interface QPoint {
  n: number; // first month number of the fiscal quarter
  level: number;
}

/** Fiscal-quarter average of a monthly index, only for quarters where all three months have a stored value. */
export function quarterlyAverage(rows: Derived[]): QPoint[] {
  const byQ = new Map<number, number[]>();
  for (const r of rows) {
    if (r.index === null) continue;
    const q = fiscalQuarterOf(r.n).start;
    byQ.set(q, [...(byQ.get(q) ?? []), r.index]);
  }
  return [...byQ.entries()]
    .filter(([, v]) => v.length === 3)
    .map(([n, v]) => ({ n, level: v.reduce((a, b) => a + b, 0) / 3 }))
    .sort((a, b) => a.n - b.n);
}

export const gdpLevels = (rows: GdpRow[]): QPoint[] => rows.filter((r) => r.level !== null).map((r) => ({ n: r.n, level: r.level as number }));

/** Year-on-year % per quarter from levels, only when the same quarter a year earlier is present. */
function qYoy(points: QPoint[]): Map<number, number> {
  const byN = new Map(points.map((p) => [p.n, p.level]));
  const out = new Map<number, number>();
  for (const p of points) {
    const prev = byN.get(p.n - 12);
    if (prev !== undefined && prev !== 0) out.set(p.n, (p.level / prev - 1) * 100);
  }
  return out;
}

// ---------- comparison ----------

export interface MonthlyInput {
  key: Exclude<OvKey, "gdp">;
  rows: Derived[]; // current-base series only
}
export interface GdpInput {
  rows: GdpRow[];
}
export interface AlignedChart {
  key: OvKey;
  label: string;
  frequency: "monthly" | "quarterly";
  stepMonths: number;
  yLabel: string;
  points: ChartPoint[];
}
export interface ComparisonResult {
  frequency: "monthly" | "quarterly";
  requestedMode: CmpMode;
  mode: CmpMode;
  /** Why the mode was changed, with a way forward; null when it was not. */
  coerced: string | null;
  series: ChartSeries[];
  aligned: AlignedChart[];
  window: { lo: number; hi: number } | null;
  /** Why no comparison can be drawn, and what to do instead. Empty when a chart is available. */
  problem: string | null;
  /** First period of each series in a rebased comparison (month numbers). */
  starts: { key: OvKey; n: number | null }[];
}

const sortedIdx = (rows: Derived[]) => rows.filter((r) => r.index !== null);

export function buildComparison(args: {
  picked: OvKey[];
  monthly: MonthlyInput[];
  gdp: GdpInput | null;
  sel: RangeSel;
  mode: CmpMode;
}): ComparisonResult {
  const { picked, monthly, gdp, sel } = args;
  const hasGdp = picked.includes("gdp") && gdp !== null;
  const mon = monthly.filter((m) => picked.includes(m.key));
  const total = mon.length + (hasGdp ? 1 : 0);
  const frequency = hasGdp ? "quarterly" : "monthly";
  let mode = args.mode;
  let coerced: string | null = null;
  if (frequency === "quarterly" && mode === "mom") {
    mode = "yoy";
    coerced =
      "GDP is published quarterly, so a monthly change does not exist for it. Showing annual change by quarter instead. Deselect GDP to see monthly changes.";
  }
  const base: ComparisonResult = { frequency, requestedMode: args.mode, mode, coerced, series: [], aligned: [], window: null, problem: null, starts: [] };
  if (total < 2) return { ...base, problem: "Select at least two indicators to compare." };

  if (frequency === "monthly") return monthlyComparison(base, mon, sel, mode);

  // ---- quarterly: every series becomes a list of quarterly levels ----
  const levels: { key: OvKey; pts: QPoint[] }[] = [
    ...mon.map((m) => ({ key: m.key as OvKey, pts: quarterlyAverage(m.rows) })),
    { key: "gdp" as OvKey, pts: gdpLevels(gdp!.rows) },
  ];
  const empty = levels.find((l) => l.pts.length === 0);
  if (empty) {
    return { ...base, problem: `${OV_NAMES[empty.key].short} has no complete fiscal quarter with stored values, so a quarterly comparison is not possible. Deselect it, or compare the monthly indicators on their own.` };
  }
  const lo0 = Math.max(...levels.map((l) => l.pts[0].n));
  const hi0 = Math.min(...levels.map((l) => l.pts[l.pts.length - 1].n));
  if (lo0 > hi0) {
    return { ...base, problem: "The selected indicators share no fiscal quarter, so no valid comparison can be drawn. Choose other indicators, or deselect GDP to compare monthly series." };
  }
  const w = windowFor(sel, hi0);
  const lo = Math.max(lo0, w.lo ?? lo0);
  const hi = Math.min(hi0, w.hi ?? hi0);
  if (lo > hi) return { ...base, problem: "No fiscal quarter is shared inside the selected time range. Widen the range." };
  const inQ = (n: number) => n >= lo && n <= hi;
  const window = { lo, hi };

  const aligned: AlignedChart[] = levels.map((l) => ({
    key: l.key,
    label: OV_NAMES[l.key].short,
    frequency: "quarterly",
    stepMonths: 3,
    yLabel: l.key === "gdp" ? "GDP, constant prices" : `${OV_NAMES[l.key].short} quarterly average (index points)`,
    points: l.pts.filter((p) => inQ(p.n)).map((p) => ({ n: p.n, v: p.level })),
  }));
  if (mode === "aligned") return { ...base, mode, window, aligned };

  let series: ChartSeries[];
  let starts: ComparisonResult["starts"] = [];
  if (mode === "yoy") {
    series = levels.map((l) => {
      const y = qYoy(l.pts); // computed on the full series, then cut: the year-ago lookback is never lost
      return { key: l.key, label: OV_NAMES[l.key].short, ...OV_STROKE[l.key], points: l.pts.filter((p) => inQ(p.n)).map((p) => ({ n: p.n, v: y.get(p.n) ?? null })) };
    });
  } else {
    // rebased: % change from the first quarter in the window where EVERY series has a value
    const common = [...new Set(levels.flatMap((l) => l.pts.map((p) => p.n)))]
      .filter((n) => inQ(n) && levels.every((l) => l.pts.some((p) => p.n === n)))
      .sort((a, b) => a - b);
    const start = common[0] ?? null;
    series = levels.map((l) => {
      const s0 = start === null ? undefined : l.pts.find((p) => p.n === start)?.level;
      return { key: l.key, label: OV_NAMES[l.key].short, ...OV_STROKE[l.key], points: l.pts.filter((p) => inQ(p.n) && start !== null && p.n >= start).map((p) => ({ n: p.n, v: s0 ? (p.level / s0 - 1) * 100 : null })) };
    });
    starts = levels.map((l) => ({ key: l.key, n: start }));
  }
  return { ...base, mode, window, series, aligned, starts };
}

function monthlyComparison(base: ComparisonResult, mon: MonthlyInput[], sel: RangeSel, mode: CmpMode): ComparisonResult {
  const spans = mon.map((m) => sortedIdx(m.rows)).map((r) => (r.length ? [r[0].n, r[r.length - 1].n] : null));
  if (spans.some((s) => s === null)) {
    return { ...base, problem: "One of the selected indicators has no stored index values, so it cannot be compared." };
  }
  const lo0 = Math.max(...spans.map((s) => s![0]));
  const hi0 = Math.min(...spans.map((s) => s![1]));
  const w = windowFor(sel, hi0);
  const lo = Math.max(lo0, w.lo ?? lo0);
  const hi = Math.min(hi0, w.hi ?? hi0);
  if (lo0 > hi0 || lo > hi) {
    return { ...base, problem: "The selected indicators have no calendar months in common within this window, so no valid comparison can be drawn. Widen the range or choose other indicators." };
  }
  const window = { lo, hi };
  const inW = (r: Derived) => inWindow(r.n, { lo, hi });
  const aligned: AlignedChart[] = mon.map((m) => ({
    key: m.key,
    label: OV_NAMES[m.key].short,
    frequency: "monthly",
    stepMonths: 1,
    yLabel: `${OV_NAMES[m.key].short} index points (own scale)`,
    points: m.rows.filter(inW).map((r) => ({ n: r.n, v: r.index })),
  }));
  if (mode === "aligned") return { ...base, window, aligned };
  const starts: ComparisonResult["starts"] = [];
  const series: ChartSeries[] = mon.map((m) => {
    const rows = m.rows.filter(inW);
    if (mode === "rebased") {
      const first = rows.find((r) => r.index !== null && r.index !== 0);
      starts.push({ key: m.key, n: first?.n ?? null });
      return { key: m.key, label: OV_NAMES[m.key].short, ...OV_STROKE[m.key], points: rows.map((r) => ({ n: r.n, v: first && r.index !== null ? (r.index / (first.index as number) - 1) * 100 : null })) };
    }
    const metric = mode === "yoy" ? "yoyCalc" : "mom";
    return { key: m.key, label: OV_NAMES[m.key].short, ...OV_STROKE[m.key], points: rows.map((r) => ({ n: r.n, v: r[metric] })) };
  });
  return { ...base, window, series, aligned, starts };
}

// ---------- one calendar year, all four indicators (Overview "Compare economic trends") ----------

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jan–Mar 2026" for the quarter starting at month number `n`. Calendar quarters coincide with fiscal quarters. */
export const calendarQuarter = (n: number) => `${MON3[n % 12]}–${MON3[(n % 12) + 2]} ${Math.floor(n / 12)}`;

export interface YearComparison {
  /** The calendar year shown, or null when no indicator has a year-on-year value in any complete quarter. */
  year: number | null;
  /** Start month numbers of the quarters drawn (each has at least one value). */
  quarters: number[];
  series: ChartSeries[];
  /** Plain statements about quarters or values left out. Nothing is ever filled in. */
  notes: string[];
  problem: string | null;
}

/** Year-on-year change by quarter for CPI, WPI, IIP and GDP over ONE calendar year (the latest with data, or `year`).
 *
 *  Same policy as the quarterly mode of `buildComparison`: a monthly index enters as the average of the three months
 *  of a quarter only when all three are stored; GDP keeps its own quarterly levels; YoY is the quarter against the same
 *  quarter a year earlier of the SAME current-base series, computed on the full history and only then cut to the year,
 *  so the year-ago lookback is never lost. Unlike the shared-window mode, an indicator with more recent quarters keeps
 *  them; a quarter another indicator lacks is a gap with a note, never an estimate. */
export function buildYearComparison(args: { monthly: MonthlyInput[]; gdp: GdpInput | null; year?: number }): YearComparison {
  const levels: { key: OvKey; pts: QPoint[] }[] = [
    ...args.monthly.map((m) => ({ key: m.key as OvKey, pts: quarterlyAverage(m.rows) })),
    ...(args.gdp ? [{ key: "gdp" as OvKey, pts: gdpLevels(args.gdp.rows) }] : []),
  ].sort((a, b) => OV_KEYS.indexOf(a.key) - OV_KEYS.indexOf(b.key));
  const yoy = new Map(levels.map((l) => [l.key, qYoy(l.pts)]));
  const allN = [...yoy.values()].flatMap((m) => [...m.keys()]);
  const year = args.year ?? (allN.length ? Math.floor(Math.max(...allN) / 12) : null);
  const empty: YearComparison = { year, quarters: [], series: [], notes: [], problem: null };
  if (year === null) return { ...empty, problem: "No indicator has a complete quarter with a year-earlier value yet, so nothing can be compared." };

  const slots = [0, 3, 6, 9].map((m) => year * 12 + m);
  const quarters = slots.filter((n) => [...yoy.values()].some((m) => m.has(n)));
  if (!quarters.length) return { ...empty, problem: `No complete quarter of ${year} with a year-earlier value is stored yet.` };

  const notes: string[] = [];
  const name = (k: OvKey) => OV_NAMES[k].short;
  const list = (ks: string[]) => (ks.length < 2 ? ks.join("") : `${ks.slice(0, -1).join(", ")} and ${ks[ks.length - 1]}`);
  // Quarters of the year that are only partly stored: left out, with how many months each indicator has.
  for (const n of slots.filter((s) => !quarters.includes(s) || args.monthly.some((m) => partial(m.rows, s)))) {
    const parts = args.monthly.map((m) => ({ key: m.key, have: monthsIn(m.rows, n) })).filter((p) => p.have > 0 && p.have < 3);
    if (parts.length) notes.push(`${calendarQuarter(n)} is not shown for ${list(parts.map((p) => name(p.key)))}: the quarter is not complete yet (${parts.map((p) => `${name(p.key)} ${p.have} of 3 months`).join(", ")}).`);
  }
  // A drawn quarter one indicator lacks: say why, never estimate.
  for (const l of levels) {
    const lastN = l.pts.length ? l.pts[l.pts.length - 1].n : -Infinity;
    const rows = args.monthly.find((m) => m.key === l.key)?.rows;
    const missing = quarters.filter((n) => !yoy.get(l.key)!.has(n) && !(rows && partial(rows, n))); // partial quarters are noted above
    if (!missing.length) continue;
    const later = missing.filter((n) => n > lastN);
    const other = missing.filter((n) => n <= lastN);
    if (later.length) notes.push(`${name(l.key)} for ${list(later.map(calendarQuarter))} is not published yet, so it is not drawn.`);
    if (other.length) notes.push(`${name(l.key)} has no year-on-year value for ${list(other.map(calendarQuarter))} (a month or the year-earlier quarter is not stored).`);
  }
  const series: ChartSeries[] = levels
    .map((l) => ({
      key: l.key,
      label: name(l.key),
      ...OV_STROKE[l.key],
      points: quarters.map((n) => ({ n, v: yoy.get(l.key)!.get(n) ?? null })),
    }))
    .filter((s) => s.points.some((p) => p.v !== null)); // an indicator with no value this year is explained in `notes`
  return { year, quarters, series, notes, problem: null };
}

const monthsIn = (rows: Derived[], qStart: number) => rows.filter((r) => r.index !== null && r.n >= qStart && r.n < qStart + 3).length;
const partial = (rows: Derived[], qStart: number) => {
  const k = monthsIn(rows, qStart);
  return k > 0 && k < 3;
};

// ---------- deterministic statement of the latest movement ----------

/** One plain sentence about the latest movement. States facts only: never a cause, never a forecast. */
export function latestMovement(name: string, kind: "index" | "gdp", row: { label: string; value: number | null; prevLabel: string | null }, metric: string): string | null {
  if (row.value === null) return null;
  const dir = row.value > 0 ? "rose" : row.value < 0 ? "fell" : "was unchanged";
  const amt = row.value === 0 ? "" : ` ${Math.abs(row.value).toFixed(2)}%`;
  const vs = row.prevLabel ? ` compared with ${row.prevLabel}` : "";
  return kind === "gdp" ? `In ${row.label}, real GDP ${dir}${amt}${vs} (${metric}).` : `In ${row.label}, the ${name} index ${dir}${amt}${vs} (${metric}).`;
}
