import { describe, expect, it } from "vitest";
import { deriveGdp, fiscalQuarterOf, gdpCsv, type GdpData, parseGdpResponse, quarterLabel, quarterStartN } from "@/lib/gdp";

const body = (obs: unknown[], extra: Record<string, unknown> = {}) => ({
  indicator: "GDP", base_year: "2022-23", frequency: "quarterly", unit: "₹ crore", seasonally_adjusted: false, observations: obs, ...extra,
});
const o = (fy: string, q: number, level: number | null, g: number | null = null) => ({ fiscal_year: fy, quarter: q, level, growth_yoy: g });

describe("fiscal quarters", () => {
  it("Q1 is Apr-Jun and Q4 is Jan-Mar of the next calendar year", () => {
    expect(quarterStartN("2025-26", 1)).toBe(2025 * 12 + 3);
    expect(quarterStartN("2025-26", 4)).toBe(2026 * 12);
    expect(quarterLabel(2025 * 12 + 3)).toBe("Q1 FY2025-26 (Apr–Jun 2025)");
    expect(fiscalQuarterOf(2026 * 12 + 1)).toMatchObject({ quarter: 4, fiscalYear: "2025-26", start: 2026 * 12 });
    expect(fiscalQuarterOf(2025 * 12 + 11)).toMatchObject({ quarter: 3, fiscalYear: "2025-26" });
  });
  it("rejects malformed fiscal years", () => {
    expect(quarterStartN("2025-27", 1)).toBeNull();
    expect(quarterStartN("2025", 1)).toBeNull();
  });
});

describe("parseGdpResponse", () => {
  it("accepts the contract and keeps missing values as null", () => {
    const d = parseGdpResponse(body([o("2024-25", 1, 100, 6.5), o("2024-25", 2, null)]))!;
    expect(d.observations[1].level).toBeNull();
    expect(d.seasonallyAdjusted).toBe(false);
  });
  it("rejects wrong frequency, duplicates and bad quarters instead of guessing", () => {
    expect(parseGdpResponse(body([], { frequency: "monthly" }))).toBeNull();
    expect(parseGdpResponse(body([o("2024-25", 1, 1), o("2024-25", 1, 2)]))).toBeNull();
    expect(parseGdpResponse(body([o("2024-25", 5, 1)]))).toBeNull();
    expect(parseGdpResponse(null)).toBeNull();
  });
});

describe("deriveGdp", () => {
  const mk = (sa: boolean): GdpData =>
    parseGdpResponse(body([o("2023-24", 1, 100), o("2023-24", 2, 102), o("2024-25", 1, 110, 7), o("2024-25", 2, null)], { seasonally_adjusted: sa }))!;
  it("computes YoY only against the same quarter a year earlier", () => {
    const r = deriveGdp(mk(false));
    expect(r[2].yoyCalc).toBeCloseTo(10);
    expect(r[3].yoyCalc).toBeNull();
    expect(r[0].yoyCalc).toBeNull();
  });
  it("never computes QoQ for a non-seasonally-adjusted series", () => {
    expect(deriveGdp(mk(false)).every((r) => r.qoq === null)).toBe(true);
    expect(deriveGdp(mk(true))[1].qoq).toBeCloseTo(2);
  });
  it("CSV leaves missing cells empty and names calculated columns", () => {
    const csv = gdpCsv(deriveGdp(mk(false)), { baseYear: "2022-23", unit: "₹ crore", measure: "m" });
    expect(csv).toContain("yoy_change_pct_calculated");
    expect(csv.split("\r\n")[4]).toMatch(/^2024-25,Q2,2024-07,,/);
  });
});
