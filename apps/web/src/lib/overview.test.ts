import { describe, expect, it } from "vitest";
import { OVERVIEW_TOUR, tourReducer } from "@/lib/guide";
import type { Observation } from "@/lib/indicator";
import {
  applyRange,
  commonWindow,
  coverage,
  derive,
  heatGrid,
  parseRange,
  rebasePercent,
  symmetricLimit,
} from "@/lib/overview";
import { buildInsights } from "@/lib/overview-insights";
import type { IndicatorBundle } from "@/lib/overview-data";

const obs = (period: string, index: number | null, rate: number | null = null): Observation => ({
  period,
  index,
  rate,
  indexSource: null,
  rateSource: null,
});
const monthly = (start: number, values: (number | null)[]): Observation[] =>
  values.map((v, i) => {
    const n = start + i;
    return obs(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`, v);
  });

describe("derive", () => {
  it("computes MoM and calculated YoY only across stored months", () => {
    const rows = derive(monthly(2024 * 12, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 120]));
    expect(rows[0].mom).toBeNull();
    expect(rows[1].mom).toBeCloseTo(1, 6);
    expect(rows[12].yoyCalc).toBeCloseTo(20, 6);
    expect(rows[11].yoyCalc).toBeNull();
  });
  it("leaves a gap null instead of bridging it", () => {
    const rows = derive(monthly(2025 * 12, [100, null, 102, 103]));
    expect(rows[1].mom).toBeNull();
    expect(rows[2].mom).toBeNull(); // previous month has no value
    expect(rows[3].mom).toBeCloseTo((103 / 102 - 1) * 100, 6);
  });
  it("skips a missing month (no MoM across a hole) and sorts input", () => {
    const o = [obs("2025-03-01", 103), obs("2025-01-01", 100)];
    const rows = derive(o);
    expect(rows.map((r) => r.period)).toEqual(["2025-01-01", "2025-03-01"]);
    expect(rows[1].mom).toBeNull();
  });
  it("never treats a zero previous index as valid", () => {
    expect(derive(monthly(2025 * 12, [0, 5]))[1].mom).toBeNull();
  });
  it("passes official rates through untouched", () => {
    expect(derive([obs("2025-01-01", 100, 3.5)])[0].rate).toBe(3.5);
  });
});

describe("ranges", () => {
  const rows = monthly(2022 * 12, Array.from({ length: 48 }, (_, i) => 100 + i)); // 2022-01 .. 2025-12
  it("anchors presets at the series' latest month", () => {
    const r = applyRange(rows, { key: "1Y", from: null, to: null });
    expect(r).toHaveLength(12);
    expect(r[r.length - 1].period).toBe("2025-12-01");
  });
  it("does not silently widen: 5Y on 48 months returns what exists", () => {
    expect(applyRange(rows, { key: "5Y", from: null, to: null })).toHaveLength(48);
  });
  it("supports custom windows and empty results", () => {
    expect(applyRange(rows, { key: "Custom", from: "2023-01", to: "2023-06" })).toHaveLength(6);
    expect(applyRange(rows, { key: "Custom", from: "2030-01", to: "2030-06" })).toHaveLength(0);
  });
  it("validates URL input", () => {
    expect(parseRange("3Y", null, null).sel.key).toBe("3Y");
    expect(parseRange("bogus", null, null).error).toMatch(/Unknown range/);
    expect(parseRange("Custom", "2025-06", "2025-01").error).toMatch(/must not be after/);
    expect(parseRange("Custom", "2025-13", "2025-14").error).toBeTruthy();
    expect(parseRange("Custom", "2024-01", "2024-12").sel).toEqual({ key: "Custom", from: "2024-01", to: "2024-12" });
    expect(parseRange(null, null, null).sel.key).toBe("All");
  });
});

describe("comparison window", () => {
  const a = monthly(2025 * 12, Array(12).fill(100)); // 2025-01..12
  const b = monthly(2025 * 12 + 3, Array(12).fill(100)); // 2025-04..2026-03
  it("uses only months every series covers", () => {
    const w = commonWindow([a, b], { key: "All", from: null, to: null })!;
    expect([w.lo, w.hi]).toEqual([2025 * 12 + 3, 2025 * 12 + 11]);
  });
  it("is null when series do not overlap or one is empty", () => {
    expect(commonWindow([a, monthly(2030 * 12, [1, 2])], DEFAULT)).toBeNull();
    expect(commonWindow([a, []], DEFAULT)).toBeNull();
  });
  it("anchors relative presets at the earliest latest month", () => {
    const w = commonWindow([a, b], { key: "3M", from: null, to: null })!;
    expect(w.hi).toBe(2025 * 12 + 11);
    expect(w.hi - w.lo).toBe(2);
  });
});
const DEFAULT = { key: "All", from: null, to: null } as const;

describe("rebase, heatmap, coverage", () => {
  it("rebases to the first valid month and keeps gaps null", () => {
    const rows = derive(monthly(2025 * 12, [200, null, 220]));
    const { start, values } = rebasePercent(rows);
    expect(start).toBe("2025-01-01");
    expect(values.get(2025 * 12 + 1)).toBeNull();
    expect(values.get(2025 * 12 + 2)).toBeCloseTo(10, 6);
  });
  it("builds a years-by-months grid with nulls for missing months", () => {
    const g = heatGrid([{ n: 2024 * 12 + 11, v: 1.5 }, { n: 2025 * 12, v: -2 }]);
    expect(g.map((r) => r.year)).toEqual([2024, 2025]);
    expect(g[0].cells[11]).toBe(1.5);
    expect(g[0].cells[0]).toBeNull();
    expect(g[1].cells[0]).toBe(-2);
    expect(symmetricLimit([1.5, -2, null])).toBe(2);
    expect(symmetricLimit([null])).toBe(1);
  });
  it("reports missing months in the stored span", () => {
    const c = coverage(monthly(2025 * 12, [1, 2, null, 4]));
    expect(c.count).toBe(3);
    expect(c.expected).toBe(4);
    expect(c.missing).toEqual(["Mar 2025"]);
    expect(coverage([]).count).toBe(0);
  });
});

function bundle(key: "cpi" | "wpi" | "iip", observations: Observation[]): IndicatorBundle {
  return {
    key, shortName: key.toUpperCase(), fullName: key, plain: "", path: `/indicators/${key}`, error: null,
    segments: [{ id: "current", label: "Base 2024", baseYear: "2024", coverage: "India", observations }],
    source: { short: "s", publisher: "p", dataset: "d", url: null, channel: "c", coverage: null, baseYear: "2024", retrievedAt: null, publishedAt: null, snapshots: 0, revision: "r", limitations: [] },
    rateKind: key === "wpi" ? null : key === "cpi" ? "inflation" : "growth",
    rateLabel: null, rateMissingText: "No official figure.", units: "Index points",
  };
}

describe("insights", () => {
  it("are computed from observations and labelled calculated/official", () => {
    const ins = buildInsights(bundle("cpi", monthly(2025 * 12, [100, 101, 102, 103, 104, 105])));
    const mom = ins.find((i) => i.id === "cpi-mom")!;
    expect(mom.cls).toBe("calculated");
    expect(mom.evidence).toContain("104.00 → 105.00");
    expect(ins.find((i) => i.id === "cpi-rate-na")!.cls).toBe("official");
    expect(ins.find((i) => i.id === "cpi-avg3")).toBeTruthy();
    expect(ins.every((i) => i.method.length > 0)).toBe(true);
  });
  it("says so when the previous month is missing and invents nothing for WPI rates", () => {
    const ins = buildInsights(bundle("wpi", [obs("2025-01-01", 100), obs("2025-03-01", 101)]));
    expect(ins.find((i) => i.id === "wpi-mom-na")).toBeTruthy();
    expect(ins.some((i) => i.id.startsWith("wpi-rate"))).toBe(false);
    expect(ins.find((i) => i.id === "wpi-avg3")).toBeUndefined();
  });
  it("returns nothing for an empty series", () => {
    expect(buildInsights(bundle("iip", []))).toEqual([]);
  });
  it("flags limited history", () => {
    const ins = buildInsights(bundle("iip", monthly(2025 * 12, [100, 101])));
    expect(ins.find((i) => i.id === "iip-coverage")!.headline).toMatch(/limited/);
  });
});

describe("tour reducer", () => {
  const total = OVERVIEW_TOUR.length;
  it("starts, steps, goes back, and closes", () => {
    let s = tourReducer({ open: false, step: 0 }, { type: "start" }, total);
    expect(s).toEqual({ open: true, step: 0 });
    s = tourReducer(s, { type: "next" }, total);
    expect(s.step).toBe(1);
    s = tourReducer(s, { type: "back" }, total);
    s = tourReducer(s, { type: "back" }, total);
    expect(s.step).toBe(0);
    expect(tourReducer(s, { type: "close" }, total).open).toBe(false);
  });
  it("finishes after the last step and ignores navigation when closed", () => {
    expect(tourReducer({ open: true, step: total - 1 }, { type: "next" }, total).open).toBe(false);
    expect(tourReducer({ open: false, step: 0 }, { type: "next" }, total)).toEqual({ open: false, step: 0 });
  });
  it("has unique targets and covers the ten required topics", () => {
    expect(new Set(OVERVIEW_TOUR.map((t) => t.target)).size).toBe(total);
    expect(total).toBe(10);
  });
});
