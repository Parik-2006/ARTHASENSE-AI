import { describe, expect, it } from "vitest";
import {
  decimalsOf,
  gdpExplanation,
  gdpQuarterDetail,
  methodAverageOfMonthlyYoy,
  monthlyExplanation,
  monthlyQuarterDetail,
  plainSentence,
  roundingCheck,
  seriesPrecision,
} from "@/lib/calc-explain";
import type { GdpRow } from "@/lib/gdp";
import type { Observation } from "@/lib/indicator";
import { derive } from "@/lib/overview";
import { buildYearComparison } from "@/lib/overview-v3";

// Real stored values (production, read 2026-11-25; docs/OVERVIEW-SCIENTIFIC-AUDIT-AND-UX.md).
const obs = (period: string, index: number | null, rate: number | null = null): Observation => ({ period, index, rate, indexSource: null, rateSource: null });
const mo = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;

// CPI base 2024 Current, All India Combined General: index and official inflation.
const CPI_2025 = [101.67, 101.32, 101.39, 101.58, 101.9, 102.51, 103.35, 103.74, 103.74, 103.74, 104.01, 104.1];
const CPI_2026 = [104.45, 104.57, 104.84, 105.12, 105.91, 107.0, 107.95, 108.74, 109.49, 110.05];
const CPI_RATE_2026: Record<number, number> = { 1: 2.74, 2: 3.21, 3: 3.4, 4: 3.48, 5: 3.93, 6: 4.38, 7: 4.45, 8: 4.83, 9: 5.54, 10: 6.09 };
// WPI base 2022-23 All Commodities (OEA): index only.
const WPI_2025 = [101.1, 100.9, 100.6, 100.5, 100.2, 100.3, 100.2, 100.8, 101.0, 100.9, 101.5, 101.9];
const WPI_2026 = [102.3, 103.1, 104.6, 108.9, 110.1, 110.3, 110.0, 110.8, 112.5, 113.3];

const monthly = (y0: number[], y1: number[], rate: Record<number, number> = {}) => [
  ...y0.map((v, i) => obs(mo(2025, i + 1), v)),
  ...y1.map((v, i) => obs(mo(2026, i + 1), v, rate[i + 1] ?? null)),
];

describe("precision comes from the stored values", () => {
  it("counts published decimals", () => {
    expect([decimalsOf(110.05), decimalsOf(113.3), decimalsOf(8136153), decimalsOf(6.7)]).toEqual([2, 1, 0, 1]);
    expect(seriesPrecision([113.3, 167, 100.9])).toBe(1); // a stored 167 belongs to a one-decimal series
    expect(seriesPrecision([], 2)).toBe(2);
  });
});

describe("rounding bounds", () => {
  it("CPI Oct 2026: 110.05 / 103.74 gives 6.08%, the official 6.09% is consistent with rounding", () => {
    const c = roundingCheck(110.05, 103.74, 2, 6.09, 2);
    expect(c.calc.toFixed(2)).toBe("6.08");
    expect(c.lo).toBeLessThan(6.09);
    expect(c.hi).toBeGreaterThan(6.09);
    expect(c.consistent).toBe(true);
  });
  it("CPI Sep 2026 reproduces exactly: 109.49 / 103.74 → 5.54%", () => {
    expect(roundingCheck(109.49, 103.74, 2, 5.54, 2).calc.toFixed(2)).toBe("5.54");
  });
  it("IIP Sep 2026: 124.3 / 116.5 → 6.7% (official, one decimal)", () => {
    const c = roundingCheck(124.3, 116.5, 1, 6.7, 1);
    expect(c.calc.toFixed(1)).toBe("6.7");
    expect(c.consistent).toBe(true);
  });
  it("GDP Q1 FY2026-27: 8136153 / 7546230 → 7.8175%, official 7.8", () => {
    const c = roundingCheck(8136153, 7546230, 0, 7.8, 1);
    expect(c.calc.toFixed(1)).toBe("7.8");
    expect(c.consistent).toBe(true);
  });
  it("flags an official rate that rounding cannot explain", () => {
    expect(roundingCheck(110.05, 103.74, 2, 6.5, 2).consistent).toBe(false);
  });
});

describe("CPI explanation (official rate, real October 2025 comparison)", () => {
  const e = monthlyExplanation({ key: "cpi", rows: derive(monthly(CPI_2025, CPI_2026, CPI_RATE_2026)), official: true, baseYear: "2024", source: { name: "MoSPI", url: null, retrieved: "2026-11-22" } })!;
  it("shows the official 6.09% and the real stored October 2025 index 103.74 (never 103.73)", () => {
    expect(e.value).toBe("6.09%");
    expect(e.provenance).toBe("official");
    expect(e.observations).toContainEqual({ label: "CPI index, October 2025", value: "103.74" });
    expect(e.observations).toContainEqual({ label: "CPI index, October 2026", value: "110.05" });
    expect(JSON.stringify(e)).not.toContain("103.73");
  });
  it("substitutes the stored values and explains the 0.01-point rounding difference", () => {
    expect(e.substituted).toBe("((110.05 ÷ 103.74) − 1) × 100 = 6.0825%");
    expect(e.rounding).toMatch(/gives 6\.08%.*consistent/);
    expect(e.plain).toBe("Consumer prices in October 2026 were 6.09% higher than in October 2025.");
  });
});

describe("WPI explanation (calculated by ArthaSense)", () => {
  const e = monthlyExplanation({ key: "wpi", rows: derive(monthly(WPI_2025, WPI_2026)), official: false, baseYear: "2022-23", source: { name: "OEA", url: null, retrieved: null } })!;
  it("October 2026: (113.3 ÷ 100.9 − 1) × 100 = 12.29%, labelled calculated, indices at one decimal", () => {
    expect(e.value).toBe("12.29%");
    expect(e.provenance).toBe("calculated");
    expect(e.substituted).toBe("((113.3 ÷ 100.9) − 1) × 100 = 12.2894%");
    expect(e.plain).toContain("12.29% higher than in October 2025");
    expect(e.plain).toContain("not the change in that month alone");
  });
  it("negative change reads 'lower', not 'higher' (WPI Oct 2025 vs Oct 2024 = −1.18%)", () => {
    expect(plainSentence("wpi", -1.18, "October 2025", "October 2024", 2)).toMatch(/^Wholesale prices in October 2025 were 1\.18% lower than in October 2024\./);
    expect(plainSentence("cpi", 0, "May 2026", "May 2025", 2)).toBe("Consumer prices in May 2026 were unchanged from May 2025.");
    // verb agreement: "production was", never "production were"
    expect(plainSentence("iip", 6.7, "September 2026", "September 2025", 1)).toMatch(/^Industrial production in September 2026 was 6\.7% higher than in September 2025\./);
    expect(plainSentence("iip", -2, "April 2020", "April 2019", 1)).toMatch(/was 2\.0% lower than in April 2019/);
  });
  it("no year-earlier month: honest unavailable state", () => {
    expect(monthlyExplanation({ key: "wpi", rows: derive(WPI_2026.map((v, i) => obs(mo(2026, i + 1), v))), official: false, baseYear: "2022-23", source: { name: "OEA", url: null, retrieved: null } })).toBeNull();
  });
});

describe("GDP explanation (official, same fiscal quarter a year earlier)", () => {
  const row = (n: number, level: number, g: number | null): GdpRow => ({ n, fiscalYear: "", quarter: 1, level, growthOfficial: g, yoyCalc: null, qoq: null, releaseKey: null, retrievedAt: null });
  const rows = [row(2025 * 12 + 3, 7546230, 6.9), row(2026 * 12, 8880334, 8.6), row(2026 * 12 + 3, 8136153, 7.8)];
  const e = gdpExplanation(rows, "2022-23", { name: "MoSPI (NSO)", url: null, retrieved: null })!;
  it("uses Q1 FY2026-27 vs Q1 FY2025-26, never the previous quarter", () => {
    expect(e.value).toBe("7.8%");
    expect(e.period).toContain("Q1 FY2026-27");
    expect(e.comparisonPeriod).toContain("Q1 FY2025-26");
    expect(e.substituted).toMatch(/81,36,153 ÷ 75,46,230/);
    expect(e.rounding).toMatch(/consistent with the official 7\.8%/);
    expect(e.plain).toBe("India's inflation-adjusted economic output (real GDP) in Q1 FY2026-27 (Apr–Jun 2026) was 7.8% higher than in Q1 FY2025-26 (Apr–Jun 2025).");
  });
});

describe("comparison chart: Method B (YoY of quarterly-average indices) is the production method", () => {
  const cpi = derive(monthly(CPI_2025, CPI_2026, CPI_RATE_2026));
  const wpi = derive(monthly(WPI_2025, WPI_2026));
  it("Jul–Sep 2026 WPI: avg 111.1 vs 100.6667 → 10.36%; Method A would give 10.362 (they differ)", () => {
    const d = monthlyQuarterDetail("wpi", wpi, 2026 * 12 + 6);
    expect(d.months.map((m) => m.value)).toEqual([110.0, 110.8, 112.5]);
    expect(d.prevMonths.map((m) => m.value)).toEqual([100.2, 100.8, 101.0]);
    expect(d.result!.toFixed(4)).toBe("10.3642");
    expect(methodAverageOfMonthlyYoy(wpi, 2026 * 12 + 6)!.toFixed(4)).toBe("10.3624");
  });
  it("the chart's plotted point equals Method B exactly", () => {
    const r = buildYearComparison({ monthly: [{ key: "cpi", rows: cpi }, { key: "wpi", rows: wpi }], gdp: null, year: 2026 });
    const w = r.series.find((s) => s.key === "wpi")!;
    for (const q of [0, 3, 6]) expect(w.points.find((p) => p.n === 2026 * 12 + q)!.v).toBeCloseTo(monthlyQuarterDetail("wpi", wpi, 2026 * 12 + q).result as number, 10);
    const c = r.series.find((s) => s.key === "cpi")!;
    expect(c.points.find((p) => p.n === 2026 * 12 + 6)!.v!.toFixed(4)).toBe("4.9384");
  });
  it("an incomplete quarter is never drawn (Oct–Dec 2026 has only October)", () => {
    const d = monthlyQuarterDetail("wpi", wpi, 2026 * 12 + 9);
    expect(d.result).toBeNull();
    expect(d.missing).toBe("only 1 of the quarter's 3 months is published so far");
  });
  it("GDP enters with its OFFICIAL growth, not a recalculation", () => {
    const row = (n: number, level: number, g: number | null): GdpRow => ({ n, fiscalYear: "", quarter: 1, level, growthOfficial: g, yoyCalc: null, qoq: null, releaseKey: null, retrievedAt: null });
    const gdp = [row(2025 * 12, 8180413, 6.6), row(2025 * 12 + 3, 7546230, 6.9), row(2026 * 12, 8880334, 8.6), row(2026 * 12 + 3, 8136153, 7.8)];
    const r = buildYearComparison({ monthly: [{ key: "cpi", rows: cpi }], gdp: { rows: gdp }, year: 2026 });
    const g = r.series.find((s) => s.key === "gdp")!;
    expect(g.points.find((p) => p.n === 2026 * 12)!.v).toBe(8.6); // levels would give 8.5561
    expect(g.points.find((p) => p.n === 2026 * 12 + 3)!.v).toBe(7.8); // levels would give 7.8175
    expect(gdpQuarterDetail(gdp, 2026 * 12 + 6).missing).toMatch(/not published yet/);
  });
});
