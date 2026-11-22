import { describe, expect, it } from "vitest";
import { deriveGdp, parseGdpResponse } from "@/lib/gdp";
import type { Observation } from "@/lib/indicator";
import { derive } from "@/lib/overview";
import { buildComparison, parseCmpMode, parseCompareSel, parseOpen, quarterlyAverage } from "@/lib/overview-v3";

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
        return { fiscal_year: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, quarter: (i % 4) + 1, level: 100 + i * 2, growth_yoy: null };
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
