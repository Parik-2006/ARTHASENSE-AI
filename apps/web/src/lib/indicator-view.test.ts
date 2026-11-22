import { describe, expect, it } from "vitest";
import { deriveGdp, parseGdpResponse } from "@/lib/gdp";
import type { Observation } from "@/lib/indicator";
import { explainGdp, explainLevel, explainRate, monthlyWindow, quarterWindow, shortfallNote, toCsv } from "@/lib/indicator-view";
import { derive, parseRange, quarterWindowFor, type RangeSel } from "@/lib/overview";

const per = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
const obs = (start: number, count: number, f: (i: number) => number = (i) => 100 + i): Observation[] =>
  Array.from({ length: count }, (_, i) => ({ period: per(start + i), index: f(i), rate: null, indexSource: null, rateSource: null }));
const sel = (key: string, from: string | null = null, to: string | null = null): RangeSel => parseRange(key, from, to).sel;
const START = 2013 * 12; // Jan 2013

describe("monthly windows (2M ... 5Y)", () => {
  const rows = derive(obs(START, 156)); // Jan 2013 - Dec 2025
  it.each([["2M", 2], ["3M", 3], ["6M", 6], ["1Y", 12], ["2Y", 24], ["3Y", 36], ["5Y", 60], ["All", 156]])("%s = %i months ending at the series' last month", (k, n) => {
    const w = monthlyWindow(rows, sel(k));
    expect(w.stored).toBe(n);
    expect(w.last?.period).toBe("2025-12-01");
    expect(w.rows[0].period).toBe(per(START + 156 - n));
  });
  it("custom keeps exactly the chosen months, inclusive", () => {
    const w = monthlyWindow(rows, sel("Custom", "2019-04", "2020-03"));
    expect(w.stored).toBe(12);
    expect([w.first?.period, w.last?.period]).toEqual(["2019-04-01", "2020-03-01"]);
  });
  it("never pads a short series: 5Y on 22 stored months shows 22 and says so", () => {
    const w = monthlyWindow(derive(obs(2025 * 12, 22)), sel("5Y"));
    expect(w.stored).toBe(22);
    expect(shortfallNote(w.requestedMonths, w.stored, "month")).toMatch(/asks for 60 months, but only 22 months are stored/);
  });
  it("a gap stays a gap (no month is invented)", () => {
    const o = obs(START, 12).filter((_, i) => i !== 5);
    const w = monthlyWindow(derive(o), sel("1Y"));
    expect(w.stored).toBe(11);
    expect(w.rows.find((r) => r.period === per(START + 5))).toBeUndefined();
  });
});

describe("quarterly windows (GDP)", () => {
  const gdp = deriveGdp(
    parseGdpResponse({
      indicator: "GDP", base_year: "2022-23", frequency: "quarterly", unit: "₹ crore",
      observations: Array.from({ length: 17 }, (_, i) => {
        const y = 2022 + Math.floor(i / 4);
        return { fiscal_year: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, quarter: (i % 4) + 1, level: 1000 + i, growth_yoy: i >= 4 ? 7 + (i % 3) / 10 : null };
      }),
    })!,
  );
  it.each([["3M", 1], ["6M", 2], ["1Y", 4], ["2Y", 8], ["3Y", 12]])("%s = %i quarters (never months)", (k, q) => {
    const w = quarterWindow(gdp, sel(k));
    expect(w.rows).toHaveLength(q);
    expect(w.requestedQuarters).toBe(q);
    expect(w.rows.every((r, i) => i === 0 || r.n - w.rows[i - 1].n === 3)).toBe(true);
  });
  it("5Y asks for 20 quarters; 17 are stored, 13 with official growth", () => {
    const w = quarterWindow(gdp, sel("5Y"));
    expect(w.rows).toHaveLength(17);
    expect(shortfallNote(w.requestedQuarters, w.rows.filter((r) => r.growthOfficial !== null).length, "quarter")).toMatch(/20 quarters, but only 13/);
  });
  it("2M is shorter than a quarter: nothing is shown and the reason is given", () => {
    const w = quarterWindow(gdp, sel("2M"));
    expect(w.tooShort).toBe(true);
    expect(w.rows).toHaveLength(0);
    expect(explainGdp(w)).toMatch(/two-month range cannot contain a full quarter/);
    expect(quarterWindowFor(sel("2M"), 100)).toBeNull();
  });
  it("custom months include a quarter when its first month is inside them", () => {
    const w = quarterWindow(gdp, sel("Custom", "2024-04", "2025-03"));
    expect(w.rows.map((r) => `${r.fiscalYear} Q${r.quarter}`)).toEqual(["2024-25 Q1", "2024-25 Q2", "2024-25 Q3", "2024-25 Q4"]);
  });
});

describe("filter-aware explanations", () => {
  it("describes a rise with its months, points and percent, and does not claim every price rose", () => {
    const t = explainLevel("cpi", monthlyWindow(derive(obs(START, 12)), sel("1Y")));
    expect(t).toMatch(/^From January 2013 to December 2013, the CPI index rose \(100\.0 to 111\.0 points, \+11\.0%; calculated by ArthaSense\)/);
    expect(t).toMatch(/does not mean every product became more expensive/);
  });
  it("follows the filter: a different window gives a different sentence", () => {
    const rows = derive(obs(START, 24, (i) => (i < 12 ? 100 + i : 111 - (i - 12))));
    expect(explainLevel("wpi", monthlyWindow(rows, sel("1Y")))).toMatch(/fell/);
    expect(explainLevel("wpi", monthlyWindow(rows, sel("Custom", "2013-01", "2013-12")))).toMatch(/rose/);
  });
  it("small moves are 'about the same'; one observation says a longer range is needed", () => {
    expect(explainLevel("iip", monthlyWindow(derive(obs(START, 6, () => 100)), sel("6M")))).toMatch(/stayed about the same/);
    expect(explainLevel("cpi", monthlyWindow(derive(obs(START, 1)), sel("All")))).toMatch(/Only one CPI observation/);
  });
  it("rates name their range, latest figure and whether they are official", () => {
    const pts = [{ period: "2025-01-01", v: 4.3 }, { period: "2025-02-01", v: -0.5 }, { period: "2025-03-01", v: null }];
    expect(explainRate("consumer inflation", pts, true)).toBe("In this range consumer inflation moved between -0.5% and +4.3% (official). The latest figure in the range is -0.5% for February 2025.");
    expect(explainRate("wholesale inflation", [], false)).toMatch(/No wholesale inflation figure/);
  });
  it("GDP growth below zero is described as lower, never hidden", () => {
    const g = deriveGdp(parseGdpResponse({ indicator: "GDP", base_year: "2022-23", frequency: "quarterly", unit: "x", observations: [{ fiscal_year: "2024-25", quarter: 1, level: 1, growth_yoy: -2.5 }] })!);
    expect(explainGdp(quarterWindow(g, sel("All")))).toMatch(/2\.5% lower than in the same quarter a year earlier \(official\)/);
  });
});

describe("CSV", () => {
  it("quotes, keeps empty cells for missing values and never writes 0 for them", () => {
    expect(toCsv(["a", "b"], [["x,y", null], ['q"', 0]])).toBe('a,b\r\n"x,y",\r\n"q""",0\r\n');
  });
});
