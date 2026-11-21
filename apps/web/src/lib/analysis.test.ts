import { describe, expect, it } from "vitest";
import {
  checkCustomRange, commonWindow, heatmapRows, inWindow, metricValue, movingAverage3, parseFilters,
  presetShortfall, resolveWindow, serializeFilters, withDerived,
} from "@/lib/analysis";
import type { Observation } from "@/lib/indicator";

const obs = (period: string, index: number | null, rate: number | null = null): Observation => ({
  period, index, rate, indexSource: null, rateSource: null,
});
/** 24 monthly points 2024-01..2025-12, index = 100 + i. */
const series = Array.from({ length: 24 }, (_, i) =>
  obs(`${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, 100 + i),
);

describe("withDerived", () => {
  it("computes MoM and YoY from the stored series by calendar month", () => {
    const rows = withDerived(series);
    expect(rows[0].mom).toBeNull();
    expect(rows[0].yoy).toBeNull();
    expect(rows[1].mom).toBeCloseTo((101 / 100 - 1) * 100, 10);
    expect(rows[12].yoy).toBeCloseTo((112 / 100 - 1) * 100, 10);
  });
  it("does not bridge gaps and is order independent", () => {
    const gap = [series[0], series[2], series[12]];
    const rows = withDerived([...gap].reverse());
    expect(rows.map((r) => r.period)).toEqual(gap.map((r) => r.period));
    expect(rows[1].mom).toBeNull(); // Feb missing
    expect(rows[2].yoy).toBeCloseTo(12, 10); // Jan 2025 vs Jan 2024
  });
  it("ignores null and zero reference values", () => {
    expect(withDerived([obs("2025-01-01", 0), obs("2025-02-01", 5)])[1].mom).toBeNull();
    expect(withDerived([obs("2025-01-01", null), obs("2025-02-01", 5)])[1].mom).toBeNull();
  });
  it("keeps official rate separate from calculated YoY", () => {
    const r = withDerived([obs("2025-01-01", 100, 6.7)])[0];
    expect(metricValue(r, "official")).toBe(6.7);
    expect(metricValue(r, "yoy")).toBeNull();
  });
});

describe("windows and lookback", () => {
  it("anchors presets at the series' own latest month", () => {
    const w = resolveWindow(series, "3M")!;
    expect(inWindow(series, w).map((r) => r.period)).toEqual(["2025-10-01", "2025-11-01", "2025-12-01"]);
  });
  it("a 3M window still has YoY because derivation runs before windowing", () => {
    const rows = inWindow(withDerived(series), resolveWindow(series, "3M"));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.yoy !== null && r.mom !== null)).toBe(true);
  });
  it("All spans everything; short history is reported honestly", () => {
    expect(inWindow(series, resolveWindow(series, "All")).length).toBe(24);
    expect(presetShortfall(series, "5Y")).toBe(36);
    expect(presetShortfall(series, "1Y")).toBe(0);
    expect(resolveWindow([], "1Y")).toBeNull();
  });
  it("validates custom ranges", () => {
    expect(checkCustomRange({ start: "2025-05", end: "2025-02" }, series).ok).toBe(false);
    expect(checkCustomRange(null, series).ok).toBe(false);
    expect(checkCustomRange({ start: "2026-03", end: "2026-09" }, series).ok).toBe(false); // after data
    const ok = checkCustomRange({ start: "2025-03", end: "2027-01" }, series);
    expect(ok.ok && inWindow(series, ok.window).at(-1)?.period).toBe("2025-12-01"); // clipped, not invented
  });
  it("common window is the intersection of spans", () => {
    expect(commonWindow([series, series.slice(6)])).toEqual({ start: 2024 * 12 + 6, end: 2025 * 12 + 11 });
    expect(commonWindow([series.slice(0, 3), series.slice(10)])).toBeNull();
  });
});

describe("movingAverage3", () => {
  it("averages three consecutive months and refuses to bridge gaps", () => {
    const rows = withDerived([series[0], series[1], series[2], series[4]]);
    const ma = movingAverage3(rows);
    expect(ma[0]).toBeNull();
    expect(ma[2]).toBeCloseTo(101, 10);
    expect(ma[3]).toBeNull();
  });
});

describe("heatmapRows", () => {
  it("builds year x month cells with null for missing months", () => {
    const h = heatmapRows(withDerived([series[1], series[13]]), "index");
    expect(h.years).toEqual([2024, 2025]);
    expect(h.cells[0][1].value).toBe(101);
    expect(h.cells[0][0].value).toBeNull();
  });
});

describe("URL state", () => {
  const get = (q: string) => { const p = new URLSearchParams(q); return (k: string) => p.get(k); };
  it("round-trips valid filters", () => {
    const f = parseFilters(get("range=3Y&metric=yoy"));
    expect(f).toEqual({ range: "3Y", metric: "yoy", custom: null });
    expect(serializeFilters(f).toString()).toBe("range=3Y&metric=yoy");
    const c = parseFilters(get("range=Custom&from=2024-02&to=2025-01"));
    expect(c.custom).toEqual({ start: "2024-02", end: "2025-01" });
    expect(serializeFilters(c).toString()).toBe("range=Custom&from=2024-02&to=2025-01");
  });
  it("falls back on invalid or disallowed values", () => {
    expect(parseFilters(get("range=9Y&metric=bogus"))).toEqual({ range: "All", metric: "index", custom: null });
    expect(parseFilters(get("range=Custom&from=x&to=y")).range).toBe("All");
    expect(parseFilters(get("metric=official"), ["index", "mom", "yoy"]).metric).toBe("index");
  });
  it("omits defaults", () => {
    expect(serializeFilters({ range: "All", metric: "index", custom: null }).toString()).toBe("");
  });
});

import { toCsvV2 } from "@/lib/analysis";
describe("toCsvV2", () => {
  it("labels calculated columns, keeps blanks empty and exports only given rows", () => {
    const rows = withDerived(series).slice(12, 14);
    const csv = toCsvV2(rows, { source: "MoSPI", indexColumn: "cpi_index", officialColumn: null, baseYear: "2024", seriesId: "s" });
    const [h, a, b] = csv.trim().split("\r\n");
    expect(h).toBe("period,cpi_index,mom_change_pct_calculated,yoy_change_pct_calculated,base_year,source,series_id,release_key,retrieved_at,source_status");
    expect(a.startsWith("2025-01-01,112,")).toBe(true);
    expect(b.split(",")[3]).toBe("12.0000".replace("12.0000", ((113 / 101 - 1) * 100).toFixed(4)));
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    const blank = toCsvV2(withDerived([obs("2025-01-01", 100)]), { source: "x", indexColumn: "i", officialColumn: "o", baseYear: "b", seriesId: "s" });
    expect(blank.split("\r\n")[1]).toBe("2025-01-01,100,,,,b,x,s,,,");
  });
});

import { clipToWindow, latestWithMetric } from "@/lib/analysis";
describe("shared windows", () => {
  const common = { start: 100, end: 130 };
  it("clips presets to the common end and never beyond the common start", () => {
    expect(clipToWindow(common, "3M", null)).toEqual({ start: 128, end: 130 });
    expect(clipToWindow(common, "5Y", null)).toEqual(common);
    expect(clipToWindow(null, "1Y", null)).toBeNull();
  });
  it("clips custom ranges and rejects empty ones", () => {
    const c = (a: string, b: string) => clipToWindow({ start: 2024 * 12, end: 2025 * 12 + 11 }, "Custom", { start: a, end: b });
    expect(c("2023-01", "2024-03")).toEqual({ start: 2024 * 12, end: 2024 * 12 + 2 });
    expect(c("2026-01", "2026-05")).toBeNull();
    expect(c("2025-05", "2025-01")).toBeNull();
  });
  it("finds the latest row that has a metric", () => {
    const rows = withDerived([series[0], series[1], series[5]]);
    expect(latestWithMetric(rows, "mom")?.period).toBe("2024-02-01");
    expect(latestWithMetric(rows, "yoy")).toBeNull();
  });
});

import { seasonalLines } from "@/lib/analysis";
describe("seasonalLines", () => {
  it("groups one series by calendar year with null for missing months", () => {
    const lines = seasonalLines(withDerived([series[1], series[2], series[13]]), "index");
    expect(lines.map((l) => l.year)).toEqual([2024, 2025]);
    expect(lines[0].values[0]).toBeNull();
    expect(lines[0].values[1]).toBe(101);
    expect(lines[1].values[1]).toBe(113);
    expect(lines[1].values[5]).toBeNull();
  });
  it("uses the chosen metric (YoY exists only where the prior year is stored)", () => {
    const lines = seasonalLines(withDerived(series), "yoy");
    expect(lines[0].values.every((v) => v === null)).toBe(true);
    expect(lines[1].values[0]).toBeCloseTo(12, 10);
  });
});

import { seedCustom } from "@/lib/analysis";
describe("seedCustom", () => {
  it("seeds the latest 12 stored months, or everything when fewer", () => {
    expect(seedCustom(series)).toEqual({ start: "2025-01", end: "2025-12" });
    expect(seedCustom(series.slice(20))).toEqual({ start: "2025-09", end: "2025-12" });
    expect(seedCustom([])).toBeNull();
  });
});

describe("toCsvV2 source status", () => {
  const src = (status: string | null) => ({ releaseKey: "rk", retrievedAt: "2026-01-01T00:00:00Z", publishedAt: null, status });
  it("exports the SOURCE's own flag verbatim and leaves our default 'retrieved' empty", () => {
    const rows = withDerived([
      { period: "2020-04-01", index: 149, rate: null, indexSource: src("source_status_F*"), rateSource: null },
      { period: "2020-05-01", index: 150, rate: null, indexSource: src("retrieved"), rateSource: null },
      { period: "2020-06-01", index: 151, rate: null, indexSource: src("source_final"), rateSource: null },
    ]);
    const lines = toCsvV2(rows, { source: "MoSPI", indexColumn: "i", officialColumn: null, baseYear: "2012", seriesId: "s" }).trim().split("\r\n");
    expect(lines[1].endsWith(",source_status_F*")).toBe(true);
    expect(lines[2].endsWith(",rk,2026-01-01T00:00:00Z,")).toBe(true); // empty, not "retrieved"
    expect(lines[3].endsWith(",source_final")).toBe(true);
  });
});

describe("commonWindow with nothing to compare", () => {
  it("returns null for no series instead of an infinite window (hub crashed when the API was down)", () => {
    expect(commonWindow([])).toBeNull();
  });
});
