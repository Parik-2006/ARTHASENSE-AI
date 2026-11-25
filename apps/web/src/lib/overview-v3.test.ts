import { describe, expect, it } from "vitest";
import { deriveGdp, parseGdpResponse } from "@/lib/gdp";
import type { Observation } from "@/lib/indicator";
import { derive } from "@/lib/overview";
import { buildComparison, buildYearComparison, calendarQuarter, parseCmpMode, parseCompareSel, parseOpen, quarterlyAverage } from "@/lib/overview-v3";

const obs = (start: number, vals: (number | null)[]): Observation[] =>
  vals.map((v, i) => {
    const n = start + i;
    return { period: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`, index: v, rate: null, indexSource: null, rateSource: null } as Observation;
  });
const monthly = (key: "cpi" | "wpi" | "iip", start: number, vals: (number | null)[]) => ({ key, rows: derive(obs(start, vals)) });
const ALL = { key: "All" as const, from: null, to: null };
const gdp = (n: number) =>
  deriveGdp(
    parseGdpResponse({
      indicator: "GDP", base_year: "2022-23", frequency: "quarterly", unit: "u",
      observations: Array.from({ length: n }, (_, i) => {
        const y = 2022 + Math.floor(i / 4);
        // Official growth as MoSPI publishes it: one decimal, from the first quarter with a year-earlier quarter.
        const growth_yoy = i >= 4 ? Math.round(((100 + i * 2) / (100 + (i - 4) * 2) - 1) * 1000) / 10 : null;
        return { fiscal_year: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, quarter: (i % 4) + 1, level: 100 + i * 2, growth_yoy };
      }),
    })!,
  );
const long = (k: "cpi" | "wpi" | "iip") => monthly(k, 2022 * 12 + 3, Array.from({ length: 48 }, (_, i) => 100 + i));

describe("URL parsing", () => {
  it("only accepts known keys and modes", () => {
    expect(parseOpen("gdp")).toBe("gdp");
    expect(parseOpen("nope")).toBeNull();
    expect(parseCompareSel("cpi,xx,gdp", ["cpi", "wpi"])).toEqual(["cpi"]);
    expect(parseCompareSel(null, ["cpi", "wpi"])).toEqual(["cpi", "wpi"]);
    expect(parseCmpMode("zzz")).toBe("mom");
  });
});

describe("quarterlyAverage", () => {
  it("uses only complete fiscal quarters", () => {
    const rows = derive(obs(2025 * 12 + 3, [100, 101, 102, 103, null, 105]));
    expect(quarterlyAverage(rows)).toEqual([{ n: 2025 * 12 + 3, level: 101 }]);
  });
});

describe("buildComparison", () => {
  it("monthly-only comparison stays monthly", () => {
    const r = buildComparison({ picked: ["cpi", "wpi"], monthly: [long("cpi"), long("wpi")], gdp: null, sel: ALL, mode: "mom" });
    expect(r.frequency).toBe("monthly");
    expect(r.series).toHaveLength(2);
    expect(r.coerced).toBeNull();
  });
  it("selecting GDP makes it quarterly and replaces the monthly mode with an explanation", () => {
    const r = buildComparison({ picked: ["cpi", "gdp"], monthly: [long("cpi")], gdp: { rows: gdp(12) }, sel: ALL, mode: "mom" });
    expect(r.frequency).toBe("quarterly");
    expect(r.mode).toBe("yoy");
    expect(r.coerced).toMatch(/quarterly/);
    for (const s of r.series) for (const p of s.points) expect(p.n % 3).toBe(0);
  });
  it("never creates GDP values for months and never interpolates", () => {
    const r = buildComparison({ picked: ["wpi", "gdp"], monthly: [long("wpi")], gdp: { rows: gdp(12) }, sel: ALL, mode: "rebased" });
    const g = r.series.find((s) => s.key === "gdp")!;
    expect(g.points.length).toBeLessThanOrEqual(12);
    expect(r.series.every((s) => s.points[0].v === 0)).toBe(true);
  });
  it("aligned mode keeps each series in its own frequency", () => {
    const r = buildComparison({ picked: ["cpi", "gdp"], monthly: [long("cpi")], gdp: { rows: gdp(8) }, sel: ALL, mode: "aligned" });
    expect(r.aligned.map((a) => a.frequency)).toEqual(["quarterly", "quarterly"]);
  });
  it("explains instead of drawing when no quarter is shared", () => {
    const far = monthly("cpi", 2000 * 12 + 3, Array.from({ length: 24 }, (_, i) => 100 + i));
    const r = buildComparison({ picked: ["cpi", "gdp"], monthly: [far], gdp: { rows: gdp(8) }, sel: ALL, mode: "yoy" });
    expect(r.problem).toMatch(/share no fiscal quarter/);
    expect(r.series).toHaveLength(0);
  });
  it("needs two indicators; a missing GDP is not silently substituted", () => {
    expect(buildComparison({ picked: ["cpi"], monthly: [long("cpi")], gdp: null, sel: ALL, mode: "yoy" }).problem).toMatch(/at least two/);
    expect(buildComparison({ picked: ["cpi", "gdp"], monthly: [long("cpi")], gdp: null, sel: ALL, mode: "yoy" }).problem).toMatch(/at least two/);
  });
  it("respects the range selection on a quarterly comparison", () => {
    const r = buildComparison({ picked: ["cpi", "gdp"], monthly: [long("cpi")], gdp: { rows: gdp(14) }, sel: { key: "1Y", from: null, to: null }, mode: "yoy" });
    expect(r.series[0].points.length).toBeLessThanOrEqual(4);
  });
});

describe("buildYearComparison (Overview: one calendar year, all four indicators)", () => {
  const ym = (y: number, m: number) => y * 12 + m - 1;
  // Monthly index Jan 2025 - Oct 2026, +1 point a month; GDP Q1 FY22-23 .. Q1 FY26-27 (Apr-Jun 2026), +2 a quarter.
  const cpi = monthly("cpi", ym(2025, 1), Array.from({ length: 22 }, (_, i) => 100 + i));
  const wpi = monthly("wpi", ym(2023, 4), Array.from({ length: 43 }, (_, i) => 100 + i));
  const iip = monthly("iip", ym(2023, 4), Array.from({ length: 42 }, (_, i) => 100 + i)); // ends Sep 2026
  const g = { rows: gdp(17) };
  const r = buildYearComparison({ monthly: [cpi, wpi, iip], gdp: g });
  const val = (k: string, n: number) => r.series.find((s) => s.key === k)?.points.find((p) => p.n === n)?.v;

  it("picks the latest year with data (2026) and its complete quarters only", () => {
    expect(r.year).toBe(2026);
    expect(r.quarters).toEqual([ym(2026, 1), ym(2026, 4), ym(2026, 7)]);
    expect(r.quarters.map(calendarQuarter)).toEqual(["Jan–Mar 2026", "Apr–Jun 2026", "Jul–Sep 2026"]);
    expect(r.series.map((s) => s.key)).toEqual(["cpi", "wpi", "iip", "gdp"]);
  });
  it("YoY uses the year-earlier quarter from the full history (lookback not lost by cutting to 2026)", () => {
    // CPI Jan-Mar 2026 average = (112+113+114)/3 = 113; Jan-Mar 2025 = 101 -> +11.88%
    expect(val("cpi", ym(2026, 1))).toBeCloseTo((113 / 101 - 1) * 100, 10);
    // GDP Q4 FY25-26 (index 15 in the fixture: 100 + 15*2 = 130) vs Q4 FY24-25 (index 11: 122): the chart shows the
    // OFFICIAL growth (6.6, one decimal), never the recalculation from levels (6.557...)
    expect(val("gdp", ym(2026, 1))).toBe(6.6);
    expect((130 / 122 - 1) * 100).not.toBe(6.6);
  });
  it("never creates monthly GDP: GDP appears only on quarter starts it has, later quarters are a stated gap", () => {
    const gdpPts = r.series.find((s) => s.key === "gdp")!.points;
    expect(gdpPts.every((p) => p.n % 3 === 0)).toBe(true);
    expect(gdpPts.filter((p) => p.v !== null).map((p) => p.n)).toEqual([ym(2026, 1), ym(2026, 4)]);
    expect(val("gdp", ym(2026, 7))).toBeNull();
    expect(r.notes).toContain("GDP for Jul–Sep 2026 is not published yet, so it is not drawn.");
  });
  it("leaves out an incomplete quarter (Oct-Dec 2026) and says how many months exist", () => {
    expect(r.quarters).not.toContain(ym(2026, 10));
    expect(r.notes).toContain("Oct–Dec 2026 is not shown for CPI and WPI: the quarter is not complete yet (CPI 1 of 3 months, WPI 1 of 3 months).");
  });
  it("a partial quarter for one indicator is not also reported as unpublished", () => {
    const iip2 = monthly("iip", ym(2023, 4), Array.from({ length: 41 }, (_, i) => 100 + i)); // ends Aug 2026
    const r2 = buildYearComparison({ monthly: [cpi, wpi, iip2], gdp: g });
    expect(r2.notes.filter((t) => t.includes("IIP"))).toEqual(["Jul–Sep 2026 is not shown for IIP: the quarter is not complete yet (IIP 2 of 3 months)."]);
    expect(r2.series.find((s) => s.key === "iip")!.points.find((p) => p.n === ym(2026, 7))!.v).toBeNull();
  });
  it("respects an explicit year and reports when nothing can be compared", () => {
    expect(buildYearComparison({ monthly: [cpi, wpi, iip], gdp: g, year: 2025 }).quarters).toEqual([ym(2025, 1), ym(2025, 4), ym(2025, 7), ym(2025, 10)]);
    expect(buildYearComparison({ monthly: [monthly("cpi", ym(2026, 1), [100, 101, 102])], gdp: null }).problem).toMatch(/No indicator/);
  });
});
