import { describe, expect, it } from "vitest";
import {
  chooseView,
  evidenceFor,
  evidenceReliability,
  forecastViews,
  indicatorHref,
  monthsNeeded,
  plainReliability,
  primaryGroup,
  SHARED_RANGES,
} from "@/lib/forecast-evidence";
import { reliabilityFor } from "@/lib/forecast-v2";
import type { ComparedModel, Comparison, ComparisonGroup } from "@/lib/forecasting";
import { fc, run } from "@/lib/forecasting-fixtures";
import { parseRange } from "@/lib/overview";

// Metrics copied from the LOCAL database (scores table, h=6), see docs/FORECASTS-V3-VERIFICATION.md.
type M = [string, number, number, number | undefined, number | undefined]; // model, n, mae, cov80, cov95
const cm = ([model, n, mae, c80, c95]: M, id: number): ComparedModel => ({
  run_id: id, model, model_name: model.toUpperCase(), is_baseline: model === "naive", n_origins: n, runtime_seconds: 1,
  metrics: { mae, ...(c80 === undefined ? {} : { coverage_80: c80 }), ...(c95 === undefined ? {} : { coverage_95: c95 }) },
  vs_baseline_mae_pct: null,
}); // prettier-ignore
const group = (id: string, n: number, rows: M[], start = "2025-03-01", end = "2026-10-01"): ComparisonGroup => ({
  group_id: id, indicator: "wpi", horizon: 6, evaluation_start: start, evaluation_end: end, n_origins: n, comparable: true,
  rankable: n >= 12, best: {}, warnings: [], models: rows.map(cm),
}); // prettier-ignore

const WPI_CORE = group("core", 20, [["naive", 20, 3.54, 0.35, 0.5], ["drift", 20, 3.387, 0.4, 0.55], ["ets", 20, 3.744, 0.1, 0.4], ["arima", 20, 5.523, 0.4, 0.6], ["snaive", 20, 4.245, 0.4, 0.45]]);
const WPI_ML = group("ml", 7, [["naive", 7, 7.529, 0, 0], ["ets", 7, 7.871, 0, 0.14], ["arima", 7, 13.165, 0, 0], ["xgboost", 7, 7.771, undefined, undefined]], "2026-04-01");
const IIP_CORE = group("core", 19, [["naive", 19, 5.395, 0.95, 1], ["drift", 19, 5.755, 1, 1], ["ets", 19, 4.366, 0.58, 0.89], ["arima", 19, 5.05, 0.84, 0.89]]);
const IIP_ML = group("ml", 6, [["naive", 6, 4.833, 1, 1], ["ets", 6, 4.049, 0.5, 1], ["arima", 6, 4.211, 0.83, 1]], "2026-03-01");
// The API sorts groups by (-models, -origins); put the small set first to prove order does not matter.
const cmp = (...groups: ComparisonGroup[]): Comparison => ({ indicator: "wpi", horizon: 6, baseline: "naive", groups, excluded: [], note: "" });
const WPI = cmp(WPI_ML, WPI_CORE);
const IIP = cmp(IIP_ML, IIP_CORE);

describe("one evaluation set per judgement (regression for the V2 mixed-set flaw)", () => {
  it("V2 helper paired the newest (ml, 7-origin) model MAE with the core (20-origin) baseline", () => {
    const newest = run({ model: "ets", horizon: 6, n_origins: 7, metrics: { mae: 7.871, coverage_80: 0, coverage_95: 0.14 } });
    const v2 = reliabilityFor(newest, cmp(WPI_CORE, WPI_ML), "ets");
    expect(v2.reasons[0]).toContain("MAE 7.87");
    expect(v2.reasons[0]).toContain("(3.54)"); // different origin sets: the documented bug
  });
  it("V3 takes the model AND the baseline from the same group", () => {
    const e = evidenceReliability(WPI, "ets");
    expect(e.set?.group.group_id).toBe("core");
    expect(e.reasons[0]).toContain("MAE 3.74");
    expect(e.reasons[0]).toContain("(3.54)");
    expect(e.set?.baseline?.metrics.mae).toBe(3.54);
  });
  it("primary group = most origins among groups that contain the baseline", () => {
    expect(primaryGroup(WPI)?.group_id).toBe("core");
    expect(primaryGroup(cmp(group("x", 30, [["ets", 30, 1, 0.8, 0.9]]), WPI_ML))?.group_id).toBe("ml"); // no baseline in x
    expect(primaryGroup(null)).toBeNull();
  });
  it("falls back to the largest matched set when the model is not in the reference set", () => {
    const { primary, others } = evidenceFor(WPI, "xgboost");
    expect(primary?.group.group_id).toBe("ml");
    expect(others).toHaveLength(0);
  });
});

describe("before/after table in the verification report", () => {
  const lv = (c: Comparison, m: string) => evidenceReliability(c, m).level;
  it("WPI: every stored model is concerning on identical origins", () => {
    for (const m of ["naive", "drift", "ets", "arima"]) expect(lv(WPI, m)).toBe("concerning");
  });
  it("IIP: naive limited, drift concerning, ets limited, arima supported", () => {
    expect(lv(IIP, "naive")).toBe("limited");
    expect(lv(IIP, "drift")).toBe("concerning");
    expect(lv(IIP, "ets")).toBe("limited");
    expect(lv(IIP, "arima")).toBe("supported");
  });
  it("the baseline is described as the baseline, not as 'no baseline stored'", () => {
    const e = evidenceReliability(IIP, "naive");
    expect(e.reasons.join(" ")).toContain("naive baseline itself");
    expect(e.reasons.join(" ")).not.toContain("No naive baseline");
  });
  it("a concerning result on another matched set is surfaced and caps 'supported'", () => {
    const badMl = group("ml", 6, [["naive", 6, 4.0, 1, 1], ["arima", 6, 9.0, 0.83, 1]], "2026-03-01");
    const e = evidenceReliability(cmp(badMl, IIP_CORE), "arima");
    expect(e.level).toBe("limited");
    expect(e.caveats[0]).toContain("6 origins");
    expect(e.caveats[0]).toContain("larger than");
  });
  it("stale forecasts are never 'supported'", () => {
    expect(evidenceReliability(IIP, "arima", true).level).toBe("limited");
  });
  it("no comparable evidence => insufficient, missing coverage is not zero", () => {
    const e = evidenceReliability(null, "ets");
    expect(e.level).toBe("insufficient");
    expect(e.set).toBeNull();
    expect(plainReliability(e)).toContain("not been tested");
  });
  it("plain sentences come from flags", () => {
    expect(plainReliability(evidenceReliability(WPI, "ets"))).toMatch(/less accurate than simply repeating.*outside its uncertainty range/);
    expect(plainReliability(evidenceReliability(IIP, "arima"))).toContain("beat simply repeating");
  });
});

describe("horizon views and default choice", () => {
  const six = (model: string, id: number) => ({
    model,
    run: run({ id, model, kind: "forecast", horizon: 6, training_cutoff: "2026-09-01" }),
    items: [1, 2, 3, 4, 5, 6].map((s) => ({ ...fc(`2026-${String(9 + s).padStart(2, "0")}-01`.replace("2026-13", "2027-01").replace("2026-14", "2027-02").replace("2026-15", "2027-03"), 100 + s, s, 99), origin_date: "2026-09-01" })),
  });
  const stored = [six("arima", 116), six("ets", 115), six("naive", 113), six("drift", 114)];
  it("offers 1, 3 and 6 months from one stored 6-step run, never more than stored", () => {
    const v = forecastViews(stored).filter((x) => x.model === "arima");
    expect(v.map((x) => x.horizon)).toEqual([1, 3, 6]);
    expect(v[1].rows.map((r) => r.step)).toEqual([1, 2, 3]);
    expect(v[1].partial).toBe(true);
    expect(v[2].partial).toBe(false);
    const short = forecastViews([{ ...stored[0], items: stored[0].items.slice(0, 4) }]);
    expect(short.map((x) => x.horizon)).toEqual([1, 3]); // h=6 view needs all six rows
  });
  it("every forecast date follows the training cutoff", () => {
    for (const v of forecastViews(stored)) for (const r of v.rows) expect(r.target_date > v.run.training_cutoff).toBe(true);
  });
  it("IIP default becomes ARIMA (supported, same 19 origins for all candidates)", () => {
    const pick = chooseView(forecastViews(stored), { 6: IIP }, "2026-09-01");
    expect(pick?.view.model).toBe("arima");
    expect(pick?.view.horizon).toBe(6);
    expect(pick?.reason).toContain("same 19 test origins");
  });
  it("a URL choice wins when it exists", () => {
    expect(chooseView(forecastViews(stored), { 6: IIP }, "2026-09-01", { model: "ets", horizon: 3 })?.view).toMatchObject({ model: "ets", horizon: 3 });
  });
  it("CPI needs 23 months for a 1-month horizon (18 training + 5 origins)", () => {
    expect(monthsNeeded(1)).toBe(23);
    expect(monthsNeeded(6)).toBe(28);
  });
});

describe("links to Indicators", () => {
  it("only forwards ranges that Indicators parses without error, never model/horizon/view", () => {
    for (const r of SHARED_RANGES) {
      const href = indicatorHref("wpi", r);
      const q = new URLSearchParams(href.split("?")[1]);
      expect(parseRange(q.get("range"), q.get("from"), q.get("to")).error).toBeNull();
      expect(href).not.toMatch(/model|horizon|view/);
    }
    expect(indicatorHref("cpi", "All")).toBe("/indicators/cpi");
    expect(indicatorHref("cpi", "Custom")).toBe("/indicators/cpi");
  });
});
