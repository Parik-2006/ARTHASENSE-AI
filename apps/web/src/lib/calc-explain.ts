/** "How was this calculated?" — pure, testable logic behind the Overview's calculation explanations.
 *
 *  Nothing here invents a number. Every figure shown comes from stored official observations; calculated figures
 *  show their formula with the actual numbers substituted, and official rates are checked against the same formula
 *  with honest rounding bounds (docs/OVERVIEW-SCIENTIFIC-AUDIT-AND-UX.md). */

import { fiscalQuarterOf, type GdpRow, quarterLabel } from "@/lib/gdp";
import { formatPeriod } from "@/lib/indicator";
import type { Derived } from "@/lib/overview";

// ---------- precision ----------

/** Decimal places of a stored value as the API serves it (113.3 → 1, 110.05 → 2, 8136153 → 0). */
export function decimalsOf(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const s = String(v);
  if (/e/i.test(s)) return 0;
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

/** A series' published precision: the most decimal places among its stored values (a stored 167 is 167.0 in a
 *  one-decimal series). `fallback` when nothing is stored. The audit scan (2026-11-25) found: CPI indices 2 (base 2024)
 *  or 1 (base 2012), CPI rates 2; WPI and IIP indices 1; IIP and GDP rates 1; GDP levels 0. */
export function seriesPrecision(values: (number | null | undefined)[], fallback = 2): number {
  const vs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return vs.length ? Math.max(...vs.map(decimalsOf)) : fallback;
}

/** Format with exactly `dp` decimals (the source's precision; never more digits than were published). */
export const fixed = (v: number, dp: number) => v.toFixed(dp);

// ---------- year-on-year and rounding ----------

export const yoyPct = (cur: number, prev: number) => (cur / prev - 1) * 100;

export interface RoundingCheck {
  /** The formula applied to the stored (rounded) values. */
  calc: number;
  /** Range of the true change given that both stored values are rounded to `valueDp` decimals. */
  lo: number;
  hi: number;
  /** The official rate lies within [lo, hi] widened by its own rounding (half a unit in its last place). */
  consistent: boolean | null;
}

/** Rounding bounds from the STORED precision: cur and prev are each within half a unit of their last decimal. */
export function roundingCheck(cur: number, prev: number, valueDp: number, official: number | null = null, officialDp = 2): RoundingCheck {
  const h = 0.5 * 10 ** -valueDp;
  const lo = yoyPct(cur - h, prev + h);
  const hi = yoyPct(cur + h, prev - h);
  const oh = 0.5 * 10 ** -officialDp;
  return { calc: yoyPct(cur, prev), lo, hi, consistent: official === null ? null : official >= lo - oh - 1e-9 && official <= hi + oh + 1e-9 };
}

// ---------- plain language ----------

export type ExplainKey = "cpi" | "wpi" | "iip" | "gdp";

/** Verb agreement: "prices were", "production was", "output was". */
const VERB: Record<ExplainKey, string> = { cpi: "were", wpi: "were", iip: "was", gdp: "was" };

const SUBJECT: Record<ExplainKey, string> = {
  cpi: "Consumer prices",
  wpi: "Wholesale prices",
  iip: "Industrial production",
  gdp: "India's inflation-adjusted economic output (real GDP)",
};

/** One plain sentence with correct sign handling ("higher", "lower", "unchanged"), from real values and periods. */
export function plainSentence(k: ExplainKey, value: number | null, period: string | null, comparison: string | null, dp: number): string {
  if (value === null || period === null || comparison === null) return `${SUBJECT[k]}: no year-on-year figure is available for the latest period.`;
  const r = Number(fixed(value, dp));
  const core =
    r === 0
      ? `${SUBJECT[k]} in ${period} ${VERB[k]} unchanged from ${comparison}.`
      : `${SUBJECT[k]} in ${period} ${VERB[k]} ${fixed(Math.abs(value), dp)}% ${r > 0 ? "higher" : "lower"} than in ${comparison}.`;
  const extra: Record<ExplainKey, string> = {
    cpi: "",
    wpi: " This is the change over twelve months, not the change in that month alone.",
    iip: " Production varies with the season, so it is compared with the same month a year earlier.",
    gdp: "",
  };
  return `${core}${extra[k]}`;
}

// ---------- explanations ----------

export interface Explanation {
  key: ExplainKey;
  title: string;
  /** What the figure measures, in one plain sentence. */
  definition: string;
  provenance: "official" | "calculated";
  value: string;
  period: string;
  comparisonPeriod: string | null;
  /** The exact stored observations used. */
  observations: { label: string; value: string }[];
  formula: string;
  /** The formula with the stored values substituted, and its result. */
  substituted: string | null;
  rounding: string | null;
  units: string;
  baseYear: string;
  plain: string;
  sourceName: string;
  sourceUrl: string | null;
  retrieved: string | null;
}

const NAME: Record<ExplainKey, string> = { cpi: "CPI", wpi: "WPI", iip: "IIP", gdp: "GDP" };
const RATE_WORD: Record<ExplainKey, string> = { cpi: "inflation", wpi: "inflation", iip: "growth", gdp: "growth" };
const DEFINITION: Record<ExplainKey, string> = {
  cpi: "How much the prices households pay for a fixed basket of goods and services changed compared with the same month a year earlier.",
  wpi: "How much the prices of goods traded in bulk (before they reach shoppers) changed compared with the same month a year earlier.",
  iip: "How much the volume of output of mines, factories and power plants changed compared with the same month a year earlier.",
  gdp: "How much the value of everything India produced, after removing price changes, grew compared with the same quarter a year earlier.",
};

export interface SourceLike {
  name: string;
  url: string | null;
  retrieved: string | null;
}

/** Explanation of the latest year-on-year figure of a monthly index (CPI, WPI, IIP).
 *
 *  `official`: the series publishes the rate (CPI, IIP): the stored official rate is shown, and the formula is applied
 *  to the stored indices only as a cross-check with rounding bounds. Otherwise (WPI) the rate IS the formula result,
 *  calculated by ArthaSense. Same series only: the year-earlier month must be in the same series and base year. */
export function monthlyExplanation(a: { key: Exclude<ExplainKey, "gdp">; rows: Derived[]; official: boolean; baseYear: string; source: SourceLike }): Explanation | null {
  const { key: k, rows } = a;
  const byN = new Map(rows.filter((r) => r.index !== null).map((r) => [r.n, r]));
  const idxDp = seriesPrecision(rows.map((r) => r.index));
  const rateDp = seriesPrecision(rows.map((r) => r.rate), 2);
  // Latest month with the figure the card shows: the official rate, or (calculated) an index a year earlier.
  const latest = [...rows].reverse().find((r) => (a.official ? r.rate !== null : r.index !== null && byN.get(r.n - 12)?.index != null));
  if (!latest) return null;
  const prev = byN.get(latest.n - 12) ?? null;
  const period = formatPeriod(latest.period, true);
  const comparison = prev ? formatPeriod(prev.period, true) : null;
  const obs: Explanation["observations"] = [];
  if (latest.index !== null) obs.push({ label: `${NAME[k]} index, ${period}`, value: fixed(latest.index, idxDp) });
  if (prev?.index != null) obs.push({ label: `${NAME[k]} index, ${comparison}`, value: fixed(prev.index, idxDp) });
  if (a.official && latest.rate !== null) obs.push({ label: `Official ${RATE_WORD[k]}, ${period}`, value: `${fixed(latest.rate, rateDp)}%` });
  const formula = `((${NAME[k]} ${period} ÷ ${NAME[k]} ${comparison ?? "same month a year earlier"}) − 1) × 100`;
  let substituted: string | null = null;
  let rounding: string | null = null;
  let value: number;
  let dp: number;
  if (latest.index !== null && prev?.index != null) {
    const chk = roundingCheck(latest.index, prev.index, idxDp, a.official ? latest.rate : null, rateDp);
    substituted = `((${fixed(latest.index, idxDp)} ÷ ${fixed(prev.index, idxDp)}) − 1) × 100 = ${chk.calc.toFixed(4)}%`;
    if (a.official && latest.rate !== null) {
      value = latest.rate;
      dp = rateDp;
      const shown = fixed(chk.calc, rateDp);
      rounding =
        shown === fixed(latest.rate, rateDp)
          ? `The published rate (${fixed(latest.rate, rateDp)}%) matches the formula applied to the published indices.`
          : chk.consistent
            ? `Applied to the published indices, which are rounded to ${idxDp} decimal place${idxDp === 1 ? "" : "s"}, the formula gives ${shown}%. Rounding alone allows anything from ${chk.lo.toFixed(2)}% to ${chk.hi.toFixed(2)}%, so the official ${fixed(latest.rate, rateDp)}% (calculated by the publisher from unrounded indices) is consistent. The official figure is the one shown.`
            : `Applied to the published indices the formula gives ${shown}%, which differs from the official ${fixed(latest.rate, rateDp)}% by more than rounding explains (${chk.lo.toFixed(2)}% to ${chk.hi.toFixed(2)}%). The official figure is shown unchanged; the difference is reported, not corrected.`;
    } else {
      value = chk.calc;
      dp = 2;
      rounding = `Rounded to 2 decimal places. The indices are published to ${idxDp} decimal place${idxDp === 1 ? "" : "s"}, so the result is accurate to about ±${Math.max(Math.abs(chk.calc - chk.lo), Math.abs(chk.hi - chk.calc)).toFixed(2)} percentage points.`;
    }
  } else if (a.official && latest.rate !== null) {
    value = latest.rate;
    dp = rateDp;
    rounding = `The same month a year earlier is not stored in this series, so the official rate cannot be cross-checked here. It is shown as published.`;
  } else return null;
  return {
    key: k,
    title: `${NAME[k]} ${RATE_WORD[k]}, ${period}`,
    definition: DEFINITION[k],
    provenance: a.official ? "official" : "calculated",
    value: `${fixed(value, dp)}%`,
    period,
    comparisonPeriod: comparison,
    observations: obs,
    formula,
    substituted,
    rounding,
    units: "% change from the same month a year earlier",
    baseYear: a.baseYear,
    plain: plainSentence(k, value, period, comparison, dp),
    sourceName: a.source.name,
    sourceUrl: a.source.url,
    retrieved: a.source.retrieved,
  };
}

/** Explanation of the latest official real GDP growth: the official rate, cross-checked from the stored real levels
 *  of the same quarter a year earlier (fiscal quarters; never quarter-on-quarter). */
export function gdpExplanation(rows: GdpRow[], baseYear: string, source: SourceLike): Explanation | null {
  const latest = [...rows].reverse().find((r) => r.growthOfficial !== null);
  if (!latest) return null;
  const prev = rows.find((r) => r.n === latest.n - 12) ?? null;
  const period = quarterLabel(latest.n);
  const comparison = prev ? quarterLabel(prev.n) : null;
  const rateDp = seriesPrecision(rows.map((r) => r.growthOfficial), 1);
  const crore = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")} crore`;
  const obs: Explanation["observations"] = [];
  if (latest.level !== null) obs.push({ label: `Real GDP, ${period}`, value: crore(latest.level) });
  if (prev?.level != null) obs.push({ label: `Real GDP, ${comparison}`, value: crore(prev.level) });
  obs.push({ label: `Official real GDP growth, ${period}`, value: `${fixed(latest.growthOfficial as number, rateDp)}%` });
  let substituted: string | null = null;
  let rounding: string | null = null;
  if (latest.level !== null && prev?.level != null) {
    const chk = roundingCheck(latest.level, prev.level, 0, latest.growthOfficial, rateDp);
    substituted = `((${Math.round(latest.level).toLocaleString("en-IN")} ÷ ${Math.round(prev.level).toLocaleString("en-IN")}) − 1) × 100 = ${chk.calc.toFixed(4)}%`;
    rounding = chk.consistent
      ? `Rounded to ${rateDp} decimal place, the formula gives ${fixed(chk.calc, rateDp)}%, consistent with the official ${fixed(latest.growthOfficial as number, rateDp)}%.`
      : `The formula gives ${chk.calc.toFixed(2)}%, which differs from the official ${fixed(latest.growthOfficial as number, rateDp)}% by more than rounding explains (the published levels may come from a different revision). The official figure is shown unchanged.`;
  } else rounding = "The same quarter a year earlier is not stored, so the official growth cannot be cross-checked here.";
  return {
    key: "gdp",
    title: `Real GDP growth, ${period}`,
    definition: DEFINITION.gdp,
    provenance: "official",
    value: `${fixed(latest.growthOfficial as number, rateDp)}%`,
    period,
    comparisonPeriod: comparison,
    observations: obs,
    formula: `((Real GDP ${period.split(" (")[0]} ÷ Real GDP ${comparison?.split(" (")[0] ?? "same quarter a year earlier"}) − 1) × 100`,
    substituted,
    rounding,
    units: `% change from the same quarter a year earlier, constant ${baseYear} prices`,
    baseYear,
    plain: plainSentence("gdp", latest.growthOfficial, period, comparison, rateDp),
    sourceName: source.name,
    sourceUrl: source.url,
    retrieved: source.retrieved,
  };
}

// ---------- comparison chart: how each quarter was calculated ----------

export interface QuarterDetail {
  key: ExplainKey;
  /** First month number of the calendar quarter. */
  n: number;
  provenance: "official" | "calculated";
  /** Months used this quarter and a year earlier (monthly indicators only). */
  months: { label: string; value: number }[];
  prevMonths: { label: string; value: number }[];
  avg: number | null;
  prevAvg: number | null;
  result: number | null;
  /** Why there is no value, if there is none. */
  missing: string | null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (n: number) => `${MON[n % 12]} ${Math.floor(n / 12)}`;

/** Method used by "Compare economic trends" for monthly indices (Method B): the average index of the quarter's three
 *  months divided by the average of the same three months a year earlier, minus one. Requires all six months in the
 *  same (current) series. Nothing is filled in. */
export function monthlyQuarterDetail(key: Exclude<ExplainKey, "gdp">, rows: Derived[], qStart: number): QuarterDetail {
  const at = new Map(rows.filter((r) => r.index !== null).map((r) => [r.n, r.index as number]));
  const pick = (start: number) => [0, 1, 2].map((i) => start + i).filter((n) => at.has(n)).map((n) => ({ label: monthLabel(n), value: at.get(n) as number }));
  const months = pick(qStart);
  const prevMonths = pick(qStart - 12);
  const avg = months.length === 3 ? months.reduce((s, m) => s + m.value, 0) / 3 : null;
  const prevAvg = prevMonths.length === 3 ? prevMonths.reduce((s, m) => s + m.value, 0) / 3 : null;
  const result = avg !== null && prevAvg !== null && prevAvg !== 0 ? yoyPct(avg, prevAvg) : null;
  const missing =
    result !== null
      ? null
      : months.length < 3
        ? `only ${months.length} of the quarter's 3 months ${months.length === 1 ? "is" : "are"} published so far`
        : `only ${prevMonths.length} of the 3 months a year earlier ${prevMonths.length === 1 ? "is" : "are"} stored in this series`;
  return { key, n: qStart, provenance: "calculated", months, prevMonths, avg, prevAvg, result, missing };
}

/** Method A, kept only so tests can show how it differs: the average of the three monthly year-on-year rates. */
export function methodAverageOfMonthlyYoy(rows: Derived[], qStart: number): number | null {
  const at = new Map(rows.filter((r) => r.index !== null).map((r) => [r.n, r.index as number]));
  const rates = [0, 1, 2].map((i) => qStart + i).map((n) => (at.has(n) && at.has(n - 12) ? yoyPct(at.get(n) as number, at.get(n - 12) as number) : null));
  return rates.every((r) => r !== null) ? (rates as number[]).reduce((s, r) => s + r, 0) / 3 : null;
}

/** GDP in the comparison: the official real growth of the quarter (published, not recalculated). */
export function gdpQuarterDetail(rows: GdpRow[], qStart: number): QuarterDetail {
  const r = rows.find((x) => x.n === qStart);
  const result = r?.growthOfficial ?? null;
  return {
    key: "gdp", n: qStart, provenance: "official", months: [], prevMonths: [], avg: null, prevAvg: null, result,
    missing: result === null ? `official GDP for ${quarterLabel(qStart)} is not published yet` : null,
  }; // prettier-ignore
}

/** "Jan–Mar 2026 = Q4 FY2025-26": the calendar quarter of the comparison chart and the fiscal quarter GDP uses. */
export const calendarToFiscal = (n: number) => {
  const f = fiscalQuarterOf(n);
  return `Q${f.quarter} FY${f.fiscalYear}`;
};
