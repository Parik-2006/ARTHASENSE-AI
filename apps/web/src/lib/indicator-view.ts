/** Pure logic shared by the Overview and the Indicators pages: one range model, filter-aware summaries and
 *  plain-English explanations generated from the numbers on screen. No I/O; nothing is estimated or filled in.
 *
 *  Explanations state what the data shows over the selected window (direction, size, period, count). They never
 *  claim a cause and never extrapolate. Index points and percentages are always named as such.
 */

import { type GdpRow, quarterLabel } from "@/lib/gdp";
import { formatPeriod } from "@/lib/indicator";
import { applyRange, type Derived, inWindow, presetMonths, quarterWindowFor, type RangeSel } from "@/lib/overview";

export const VIEW_KEYS = ["cpi", "wpi", "iip", "gdp"] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export const VIEW_NAME: Record<ViewKey, { short: string; full: string }> = {
  cpi: { short: "CPI", full: "Consumer Price Index" },
  wpi: { short: "WPI", full: "Wholesale Price Index" },
  iip: { short: "IIP", full: "Index of Industrial Production" },
  gdp: { short: "GDP", full: "Gross Domestic Product" },
};

export const VIEW_COLOR: Record<ViewKey, string> = {
  cpi: "var(--ind-cpi)",
  wpi: "var(--ind-wpi)",
  iip: "var(--ind-iip)",
  gdp: "var(--ind-gdp)",
};

/** The one-line definitions the product brief asked for (kept short on purpose). */
export const DEFINITION: Record<ViewKey, string> = {
  cpi: "CPI measures changes in the prices households pay for everyday goods and services.",
  wpi: "WPI tracks changes in the prices of goods traded in bulk before they reach consumers.",
  iip: "IIP shows how industrial production changes in areas such as factories, mining, and electricity.",
  gdp: "GDP measures the value of goods and services produced in the economy. Its growth rate shows how economic output changes over time.",
};

export const pathFor = (k: ViewKey) => `/indicators/${k}`;

export const periodLabel = (p: string) => formatPeriod(p, true);
const pct = (v: number, signed = true) => `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const pts = (v: number) => v.toFixed(1);

// ---------- windows ----------

export interface MonthlyWindow {
  rows: Derived[];
  /** Months the preset asks for (null for All / Custom). */
  requestedMonths: number | null;
  /** Months with a stored index value inside the window. */
  stored: number;
  first: Derived | null;
  last: Derived | null;
}

/** Rows of ONE series inside the selection. Relative presets end at the series' own latest stored month. */
export function monthlyWindow(rows: Derived[], sel: RangeSel): MonthlyWindow {
  const valid = rows.filter((r) => r.index !== null || r.rate !== null);
  const shown = applyRange(valid, sel);
  const idx = shown.filter((r) => r.index !== null);
  return { rows: shown, requestedMonths: presetMonths(sel.key), stored: idx.length, first: idx[0] ?? null, last: idx[idx.length - 1] ?? null };
}

export interface QuarterWindow {
  rows: GdpRow[];
  /** Quarters the preset asks for (null for All / Custom). */
  requestedQuarters: number | null;
  /** The preset is shorter than one quarter (2M): nothing is shown and the page says why. */
  tooShort: boolean;
}

export function quarterWindow(rows: GdpRow[], sel: RangeSel): QuarterWindow {
  const valid = rows.filter((r) => r.level !== null || r.growthOfficial !== null);
  const anchor = valid.length ? valid[valid.length - 1].n : null;
  const w = quarterWindowFor(sel, anchor);
  const months = presetMonths(sel.key);
  if (w === null) return { rows: [], requestedQuarters: 0, tooShort: true };
  return { rows: valid.filter((r) => inWindow(r.n, w)), requestedQuarters: months === null ? null : Math.floor(months / 3), tooShort: false };
}

/** "Only 22 of the 60 months requested are stored." or null when the window is full. */
export function shortfallNote(requested: number | null, have: number, unit: "month" | "quarter"): string | null {
  if (requested === null || have >= requested) return null;
  return `This range asks for ${requested} ${unit}s, but only ${have} ${have === 1 ? unit + " is" : unit + "s are"} stored. Nothing else is filled in.`;
}

// ---------- explanations ----------

const STABLE_PCT = 0.5; // a move smaller than this over the window is described as "about the same"

const LEVEL_MEANING: Record<Exclude<ViewKey, "gdp">, { up: string; down: string; flat: string }> = {
  cpi: {
    up: "This means the measured price level for households rose over this period. It does not mean every product became more expensive.",
    down: "This means the measured price level for households fell over this period. It does not mean every product became cheaper.",
    flat: "This means the measured household price level was roughly unchanged over this period.",
  },
  wpi: {
    up: "This means wholesale prices rose on average over this period; individual goods can move differently.",
    down: "This means wholesale prices fell on average over this period; individual goods can move differently.",
    flat: "This means wholesale prices were roughly unchanged on average over this period.",
  },
  iip: {
    up: "This means measured industrial output was higher at the end of the period than at the start. Output is seasonal, so compare the same months across years.",
    down: "This means measured industrial output was lower at the end of the period than at the start. Output is seasonal, so compare the same months across years.",
    flat: "This means measured industrial output ended the period close to where it started. Output is seasonal, so compare the same months across years.",
  },
};

/** Two or three sentences about the index over the window, from its first and last stored values. */
export function explainLevel(key: Exclude<ViewKey, "gdp">, w: MonthlyWindow): string {
  const name = VIEW_NAME[key].short;
  if (!w.first || !w.last || w.stored < 2) {
    return w.stored === 1
      ? `Only one ${name} observation (${periodLabel(w.first!.period)}) falls in this range, so no change can be described. Choose a longer range.`
      : `No ${name} observations fall in this range.`;
  }
  const a = w.first.index as number;
  const b = w.last.index as number;
  const change = (b / a - 1) * 100;
  const dir = Math.abs(change) < STABLE_PCT ? "flat" : change > 0 ? "up" : "down";
  const verb = dir === "flat" ? "stayed about the same" : dir === "up" ? "rose" : "fell";
  const span = `From ${periodLabel(w.first.period)} to ${periodLabel(w.last.period)}`;
  return `${span}, the ${name} index ${verb} (${pts(a)} to ${pts(b)} points, ${pct(change)}; calculated by ArthaSense). ${LEVEL_MEANING[key][dir]}`;
}

/** One or two sentences about a rate series (official or calculated) over the window. */
export function explainRate(label: string, points: { period: string; v: number | null }[], official: boolean): string {
  const have = points.filter((p): p is { period: string; v: number } => p.v !== null);
  const tag = official ? "official" : "calculated by ArthaSense";
  if (have.length === 0) return `No ${label} figure is available in this range.`;
  const last = have[have.length - 1];
  if (have.length === 1) return `In ${periodLabel(last.period)}, ${label} was ${pct(last.v)} (${tag}).`;
  const vals = have.map((p) => p.v);
  const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
  return `In this range ${label} moved between ${pct(lo)} and ${pct(hi)} (${tag}). The latest figure in the range is ${pct(last.v)} for ${periodLabel(last.period)}.`;
}

/** Sentences about official real GDP growth by quarter. Negative growth is called a fall, never hidden. */
export function explainGdp(w: QuarterWindow): string {
  if (w.tooShort) return "GDP is published once a quarter (every three months), so a two-month range cannot contain a full quarter. Choose 3M or longer.";
  const g = w.rows.filter((r) => r.growthOfficial !== null);
  if (g.length === 0) return "No official GDP growth figure is stored for this range.";
  const last = g[g.length - 1];
  const v = last.growthOfficial as number;
  const first = `In ${quarterLabel(last.n)}, real GDP was ${Math.abs(v).toFixed(1)}% ${v >= 0 ? "higher" : "lower"} than in the same quarter a year earlier (official).`;
  if (g.length === 1) return first;
  const vals = g.map((r) => r.growthOfficial as number);
  return `${first} Across the ${g.length} quarters shown, growth ranged from ${pct(Math.min(...vals))} to ${pct(Math.max(...vals))}. Growth above zero means the economy produced more than a year before, not that everyone's income rose.`;
}

// ---------- CSV ----------

const cell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 CSV; empty cells mean "not stored / not provided" (never zero). */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
