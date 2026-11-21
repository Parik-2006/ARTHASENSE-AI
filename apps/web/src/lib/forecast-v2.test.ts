import { describe, expect, it } from "vitest";
import type { ForecastRow } from "@/lib/forecasting";
import {
  assessReliability,
  changeFrom,
  directionOf,
  interpretForecast,
  pickDefault,
  parseForecastFilters,
  serializeForecastFilters,
  toForecastQuery,
  toIndicatorQuery,
  DEFAULT_FORECAST_FILTERS,
} from "@/lib/forecast-v2";

// All fixtures below are SYNTHETIC test inputs, not stored data.

describe("assessReliability", () => {
  const base = { nOrigins: 24, mae: 1, baselineMae: 1.2, coverage80: 0.8, coverage95: 0.95 };
  it("no backtest or fewer than 5 origins is insufficient evidence", () => {
    expect(assessReliability({ ...base, nOrigins: null }).level).toBe("insufficient");
    expect(assessReliability({ ...base, nOrigins: 4 }).level).toBe("insufficient");
    expect(assessReliability({ ...base, nOrigins: 4 }).reasons[0]).toMatch(/Only 4 backtest origins/);
  });
  it("WPI-like: 7 origins, zero coverage, worse than naive => concerning, with every reason shown", () => {
    const r = assessReliability({ nOrigins: 7, mae: 13.165, baselineMae: 7.529, coverage80: 0, coverage95: 0 });
    expect(r.level).toBe("concerning");
    const t = r.reasons.join(" ");
    expect(t).toMatch(/larger than the naive baseline/);
    expect(t).toMatch(/80% intervals contained the actual value only 0%/);
    expect(t).toMatch(/only 7 origins/);
  });
  it("IIP-like: 6 origins but sensible coverage => limited (never supported on few origins)", () => {
    const r = assessReliability({ nOrigins: 6, mae: 4.2, baselineMae: 5.1, coverage80: 0.83, coverage95: 1 });
    expect(r.level).toBe("limited");
    expect(r.reasons.join(" ")).toMatch(/indicative/);
  });
  it("supported needs 12+ origins, beating the baseline, and near-nominal coverage", () => {
    expect(assessReliability(base).level).toBe("supported");
    expect(assessReliability({ ...base, mae: 2 }).level).toBe("concerning"); // worse than baseline
    expect(assessReliability({ ...base, coverage80: 0.55 }).level).toBe("limited"); // above the concerning floor but not near nominal
  });
  it("narrow intervals are not rewarded: low coverage is concerning even with low error", () => {
    expect(assessReliability({ ...base, coverage80: 0.3 }).level).toBe("concerning");
    expect(assessReliability({ ...base, coverage95: 0.6 }).level).toBe("concerning");
  });
  it("missing intervals are NOT treated as zero coverage and cap the level", () => {
    const r = assessReliability({ ...base, coverage80: null, coverage95: null });
    expect(r.level).toBe("limited");
    expect(r.reasons.join(" ")).toMatch(/not zero coverage/);
  });
  it("unknown baseline cannot yield supported", () => {
    expect(assessReliability({ ...base, baselineMae: null }).level).toBe("limited");
  });
  it("a stale forecast is never 'supported'", () => {
    expect(assessReliability({ ...base, stale: true }).level).toBe("limited");
  });
  it("always explains itself", () => {
    for (const n of [null, 3, 7, 24]) expect(assessReliability({ ...base, nOrigins: n }).reasons.length).toBeGreaterThan(0);
  });
});

describe("changes and direction", () => {
  it("computes absolute and percent change; null/zero reference gives no percent", () => {
    const c = changeFrom(100, 105)!;
    expect(c.abs).toBe(5);
    expect(c.pct).toBeCloseTo(5, 10);
    expect(changeFrom(0, 5)).toEqual({ abs: 5, pct: null });
    expect(changeFrom(null, 5)).toBeNull();
  });
  it("direction uses a documented flat band", () => {
    expect(directionOf(changeFrom(100, 100.2))).toBe("flat");
    expect(directionOf(changeFrom(100, 100.3))).toBe("up");
    expect(directionOf(changeFrom(100, 99.5))).toBe("down");
    expect(directionOf(null)).toBeNull();
  });
});

describe("interpretForecast", () => {
  const row = (m: number, f: number, w = 1): ForecastRow => ({
    origin_date: "2026-10-01", target_date: `2026-${String(m).padStart(2, "0")}-01`, step: m - 10, forecast: f,
    actual: null, lower_80: f - w, upper_80: f + w, lower_95: f - 2 * w, upper_95: f + 2 * w, interval_method: "x",
  });
  const rel = assessReliability({ nOrigins: 7, mae: 13, baselineMae: 7, coverage80: 0, coverage95: 0 });
  const base = { indicator: "WPI", modelName: "ARIMA(1,1,0)", horizon: 2, latest: { period: "2026-10-01", value: 113.3 }, rows: [row(11, 114, 1), row(12, 116, 3)], reliability: rel };
  it("describes direction, size, interval growth and reliability from stored numbers only", () => {
    const t = interpretForecast(base).join(" ");
    expect(t).toMatch(/projects the WPI index at 116.00 in December 2026, higher by 2.70 points \(2.38%\)/);
    expect(t).toMatch(/not official inflation or growth/);
    expect(t).toMatch(/3.0× the one-month width/);
    expect(t).toMatch(/Reliability: Concerning historical performance/);
    expect(t).not.toMatch(/will definitely|recession|RBI/i);
  });
  it("says so when there are no intervals or the forecast is stale", () => {
    const noIv = { ...base, rows: [{ ...row(11, 114), lower_80: null, upper_80: null }] };
    expect(interpretForecast(noIv).join(" ")).toMatch(/no prediction interval/);
    const stale = { ...base, rows: base.rows.map((r) => ({ ...r, origin_date: "2026-08-01" })) };
    expect(interpretForecast(stale).join(" ")).toMatch(/newer official data are not reflected/);
  });
  it("reports model disagreement only for the same origin and above 2% of the latest index", () => {
    const o = (v: number, origin: string | null) => ({ modelName: "Drift", finalForecast: v, origin });
    expect(interpretForecast({ ...base, others: [o(125, "2026-10-01")] }).join(" ")).toMatch(/models disagree/);
    expect(interpretForecast({ ...base, others: [o(125, "2026-09-01")] }).join(" ")).not.toMatch(/models disagree/);
    expect(interpretForecast({ ...base, others: [o(116.5, "2026-10-01")] }).join(" ")).not.toMatch(/models disagree/);
  });
  it("empty input is handled", () => {
    expect(interpretForecast({ ...base, rows: [] })[0]).toMatch(/No stored forecast rows/);
  });
});

describe("pickDefault", () => {
  const c = [
    { model: "arima", horizon: 6, level: "concerning" as const, mae: 13, createdAt: "2026-11-01" },
    { model: "drift", horizon: 6, level: "concerning" as const, mae: 6.7, createdAt: "2026-11-01" },
    { model: "ets", horizon: 6, level: "limited" as const, mae: 9, createdAt: "2026-11-01" },
    { model: "naive", horizon: 1, level: "supported" as const, mae: 1, createdAt: "2026-11-01" },
  ];
  it("explicit URL choice wins", () => {
    expect(pickDefault(c, { model: "arima" })).toMatchObject({ model: "arima", horizon: 6, reason: "Chosen in the page link." });
    expect(pickDefault(c, { model: "arima", horizon: 6 })?.model).toBe("arima");
  });
  it("otherwise prefers stronger evidence over the lowest error and does not auto-pick ARIMA", () => {
    const p = pickDefault(c)!;
    expect(p).toMatchObject({ model: "ets", horizon: 6 });
    expect(p.reason).toMatch(/not a claim that it is best at every horizon/);
  });
  it("ignores an unknown requested model and handles empty input", () => {
    expect(pickDefault(c, { model: "nope" })?.model).toBe("ets");
    expect(pickDefault([])).toBeNull();
  });
});

describe("filters / URL contract", () => {
  const get = (q: string) => { const p = new URLSearchParams(q); return (k: string) => p.get(k); };
  const avail = { models: ["arima", "naive"], horizons: [1, 6], byModel: { arima: [6], naive: [1, 6] } };
  it("reads valid range, model and horizon", () => {
    const { filters, notices } = parseForecastFilters(get("range=2Y&model=arima&horizon=6"), avail);
    expect(filters).toMatchObject({ range: "2Y", model: "arima", horizon: 6 });
    expect(notices).toEqual([]);
  });
  it("custom range is kept and serialized", () => {
    const { filters } = parseForecastFilters(get("range=Custom&from=2024-01&to=2026-10&model=naive&horizon=1"), avail);
    expect(serializeForecastFilters(filters).toString()).toBe("range=Custom&from=2024-01&to=2026-10&model=naive&horizon=1");
  });
  it("reports (never silently ignores) unavailable models, horizons and incompatible pairs", () => {
    expect(parseForecastFilters(get("model=chronos2"), avail).notices[0]).toMatch(/No stored forecast exists for model "chronos2"/);
    expect(parseForecastFilters(get("horizon=12"), avail).notices[0]).toMatch(/12-month horizon/);
    const pair = parseForecastFilters(get("model=arima&horizon=1"), avail);
    expect(pair.filters.horizon).toBeNull();
    expect(pair.notices[0]).toMatch(/Model "arima" has no stored 1-month forecast/);
    expect(parseForecastFilters(get("range=Custom&from=bad"), avail).notices[0]).toMatch(/incomplete/);
  });
  it("garbage is safe", () => {
    const { filters } = parseForecastFilters(get("range=%00&model=%3Cscript%3E&horizon=1e9"), avail);
    expect(filters).toEqual({ ...DEFAULT_FORECAST_FILTERS });
  });
  it("carries only what each destination can interpret", () => {
    const f = { range: "3Y" as const, custom: null, metric: "yoy" as const, model: "arima", horizon: 6 };
    expect(toIndicatorQuery(f)).toBe("?range=3Y&metric=yoy"); // no model/horizon on Indicators
    expect(toForecastQuery(f)).toBe("?range=3Y&model=arima&horizon=6"); // no metric on Forecasts
    expect(toForecastQuery({ range: "All", custom: null })).toBe("");
  });
});

import { reliabilityFor } from "@/lib/forecast-v2";
import type { Comparison, Run } from "@/lib/forecasting";
describe("reliabilityFor (synthetic runs)", () => {
  const run = (over: Partial<Run> = {}): Run => ({
    id: 1, experiment_id: null, indicator: "wpi", model: "arima", model_name: "ARIMA", kind: "backtest", status: "completed",
    error: null, horizon: 6, suite: null, n_origins: 7, training_start: null, training_cutoff: "2026-10-01",
    dataset_fingerprint: null, origins_fingerprint: null, snapshot_policy: null, random_seed: null, runtime_seconds: null,
    created_at: "2026-11-01T00:00:00Z", evaluation_start: null, evaluation_end: null,
    metrics: { mae: 13.165, coverage_80: 0, coverage_95: 0 }, ...over,
  });
  const cmp = (comparable = true): Comparison => ({
    indicator: "wpi", horizon: 6, baseline: "naive", excluded: [], note: "",
    groups: [{ group_id: "g", indicator: "wpi", horizon: 6, evaluation_start: null, evaluation_end: null, n_origins: 7, comparable, rankable: false, best: {}, warnings: [],
      models: [
        { run_id: 1, model: "arima", model_name: "ARIMA", is_baseline: false, n_origins: 7, runtime_seconds: null, metrics: { mae: 13.165 }, vs_baseline_mae_pct: null },
        { run_id: 2, model: "naive", model_name: "Naive", is_baseline: true, n_origins: 7, runtime_seconds: null, metrics: { mae: 7.529 }, vs_baseline_mae_pct: null },
      ] }],
  });
  it("uses the naive MAE from a comparable group on identical origins", () => {
    const r = reliabilityFor(run(), cmp(), "arima");
    expect(r.level).toBe("concerning");
    expect(r.reasons.join(" ")).toMatch(/7\.53/);
  });
  it("does not use a baseline from a non-comparable group", () => {
    expect(reliabilityFor(run({ metrics: { mae: 1, coverage_80: 0.8, coverage_95: 0.95 } }), cmp(false), "arima").reasons.join(" ")).toMatch(/No naive baseline on identical origins/);
  });
  it("missing backtest or coverage never becomes zero", () => {
    expect(reliabilityFor(null, null, "arima").level).toBe("insufficient");
    expect(reliabilityFor(run({ metrics: { mae: 1 }, n_origins: 20 }), cmp(), "arima").reasons.join(" ")).toMatch(/not zero coverage/);
    expect(reliabilityFor(run({ status: "skipped" }), cmp(), "arima").level).toBe("insufficient");
  });
  it("the baseline itself is not compared with itself", () => {
    expect(reliabilityFor(run({ model: "naive" }), cmp(), "naive").reasons.join(" ")).toMatch(/No naive baseline/);
  });
});
