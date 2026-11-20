import { describe, expect, it } from "vitest";
import {
  beatsBaseline,
  type Comparison,
  comparisonToCsv,
  fmt,
  fmtMetric,
  forecastsToCsv,
  hypotheticalPath,
  loadErrorText,
  methodLabel,
  monthLabel,
  parseComparison,
  parseForecastPage,
  parseLatest,
  parseModels,
  parseRunDetail,
  parseRunPage,
  parseSeries,
  runsToCsv,
  withArticle,
} from "@/lib/forecasting";
import { fc, run } from "@/lib/forecasting-fixtures";
import { forecastStatements, observedStatements } from "@/lib/intelligence";
import { type Observation, withMomChange } from "@/lib/indicator";

const cmp = (modelMae: number, naiveMae: number): Comparison => ({
  indicator: "wpi", horizon: 3, baseline: "naive", excluded: [], note: "",
  groups: [{
    group_id: "g", indicator: "wpi", horizon: 3, evaluation_start: null, evaluation_end: null, n_origins: 23,
    comparable: true, rankable: true, best: {}, warnings: [],
    models: [
      { run_id: 1, model: "naive", model_name: "Naive", is_baseline: true, n_origins: 23, runtime_seconds: 1, metrics: { mae: naiveMae }, vs_baseline_mae_pct: null },
      { run_id: 2, model: "ets", model_name: "ETS", is_baseline: false, n_origins: 23, runtime_seconds: 1, metrics: { mae: modelMae }, vs_baseline_mae_pct: null },
    ],
  }],
}); // prettier-ignore

describe("parsers reject anything that is not the documented shape", () => {
  it("accepts a good run page and rejects a malformed one", () => {
    expect(parseRunPage({ total: 1, items: [run()] })?.items).toHaveLength(1);
    expect(parseRunPage({ total: 1, items: [{ id: "x" }] })).toBeNull();
    expect(parseRunPage({ items: [] })).toBeNull();
    expect(parseRunPage(null)).toBeNull();
  });
  it("run detail needs its configuration", () => {
    expect(parseRunDetail({ ...run(), configuration: {}, n_forecast_rows: 3 })).not.toBeNull();
    expect(parseRunDetail({ ...run() })).toBeNull();
  });
  it("forecast pages keep nulls as null (no interval is not zero)", () => {
    const page = parseForecastPage({ total: 1, kind: "forecast", items: [fc("2026-11-01", 100, 1)] });
    expect(page?.items[0].lower_80).toBeNull();
    expect(parseForecastPage({ total: 1, kind: "forecast", items: [{ target_date: "x" }] })).toBeNull();
  });
  it("latest forecast can legitimately have no run", () => {
    expect(parseLatest({ run: null, items: [], note: "none stored" })?.run).toBeNull();
    expect(parseLatest({ run: { id: 1 }, items: [], note: "" })).toBeNull();
  });
  it("models, series and comparison", () => {
    expect(parseModels([{ id: "naive", name: "Naive", family: "baseline", explanation: "x", status: "evaluated", completed_runs: 2, min_train: 1 }])).toHaveLength(1);
    expect(parseModels([{ id: 1 }])).toBeNull();
    expect(parseSeries([{ indicator: "wpi", n_observations: 43, forecast_status: "has_experiments", evaluable_horizons: [1], completed_backtests: 1, future_forecasts: 0, latest_value: null }])).toHaveLength(1);
    expect(parseSeries("nope")).toBeNull();
    expect(parseComparison(cmp(1, 2))).not.toBeNull();
    expect(parseComparison({ indicator: "wpi" })).toBeNull();
  });
});

describe("formatting and exports", () => {
  it("formats metrics and months", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(113.3)).toBe("113.30");
    expect(fmtMetric("coverage_80", 0.755)).toBe("76%");
    expect(fmtMetric("mase", undefined)).toBe("—");
    expect(monthLabel("2026-10-01", true)).toBe("October 2026");
    expect(methodLabel("ets_state_space")).toBe("ETS state-space");
    expect(methodLabel(null)).toBe("none");
    expect(withArticle("IIP")).toBe("an IIP");
    expect(withArticle("CPI")).toBe("a CPI");
    expect(withArticle("WPI")).toBe("a WPI");
  });
  it("forecast CSV keeps missing intervals empty, never 0", () => {
    const csv = forecastsToCsv([fc("2026-11-01", 113.5, 1), fc("2026-12-01", 114, 2, 112)], "ets", "wpi").trim().split("\r\n");
    expect(csv[0]).toContain("forecast_index,lower_80,upper_80");
    expect(csv[1]).toBe("wpi,ets,2026-10-01,2026-11-01,113.5,,,,,");
    expect(csv[2].split(",").slice(5, 7)).toEqual(["112", "116"]);
  });
  it("experiment and comparison CSVs", () => {
    const csv = runsToCsv([run({ status: "skipped", error: "unavailable: weights, not downloaded", metrics: {} })]);
    expect(csv).toContain('"unavailable: weights, not downloaded"');
    expect(csv.split("\r\n")[1]).toMatch(/,,,,/); // empty metrics stay empty
    expect(comparisonToCsv(cmp(1, 2).groups[0])).toContain("wpi,3,naive,true,23,2");
  });
});

describe("baseline comparison logic", () => {
  it("is true only when the model's MAE is lower on the same group", () => {
    expect(beatsBaseline(cmp(1, 2), "ets")).toBe(true);
    expect(beatsBaseline(cmp(3, 2), "ets")).toBe(false);
    expect(beatsBaseline(cmp(1, 2), "xgboost")).toBeNull();
    expect(beatsBaseline(null, "ets")).toBeNull();
  });
});

describe("hypothetical scenario arithmetic", () => {
  it("compounds exactly", () => {
    const p = hypotheticalPath(100, 1, 3);
    expect(p[0]).toBeCloseTo(101, 10);
    expect(p[2]).toBeCloseTo(103.0301, 10);
    expect(hypotheticalPath(100, -2, 1)[0]).toBeCloseTo(98, 10);
    expect(hypotheticalPath(100, 5, 0)).toEqual([]);
  });
});

const obs = (period: string, index: number | null, rate: number | null = null): Observation => ({ period, index, rate, indexSource: null, rateSource: null });

describe("deterministic statements (only from stored numbers)", () => {
  const rows = withMomChange([obs("2025-09-01", 100), obs("2025-10-01", 101), obs("2026-09-01", 106), obs("2026-10-01", 107)]);
  it("derives MoM only across consecutive months and YoY only when the month exists", () => {
    const s = observedStatements("WPI", "2022-23", rows, null).map((x) => x.text);
    expect(s[0]).toContain("WPI was 107.00 in October 2026");
    expect(s[1]).toContain("0.94% above the previous month"); // 107/106
    expect(s[2]).toContain("5.94% higher than in October 2025"); // 107/101
    const gap = observedStatements("WPI", "2022-23", withMomChange([obs("2026-07-01", 100), obs("2026-10-01", 107)]), null).map((x) => x.text);
    expect(gap[1]).toContain("previous calendar month is not stored");
    expect(gap[2]).toContain("No same-month-last-year comparison");
  });
  it("labels official rates as official and never invents one", () => {
    const withRate = withMomChange([obs("2026-09-01", 100, 5.5), obs("2026-10-01", 101, 6.7)]);
    const s = observedStatements("IIP", "2022-23", withRate, "year-on-year growth");
    expect(s.find((x) => x.text.includes("Official"))?.text).toContain("+6.70%");
    expect(s.find((x) => x.text.includes("Official"))?.kind).toBe("observed");
    expect(observedStatements("WPI", "2022-23", rows, null).some((x) => x.text.includes("Official"))).toBe(false);
    expect(observedStatements("CPI", "2024", [], "year-on-year inflation")).toEqual([]);
  });
  it("forecast statements name the model and origin and state the baseline result honestly", () => {
    const base = { name: "WPI", modelName: "ETS", latestIndex: 100, items: [fc("2027-01-01", 102, 3, 99)], horizon: 3, run: run({ kind: "forecast" }), backtestOrigins: 23 };
    const worse = forecastStatements({ ...base, beatsNaive: false }).map((x) => x.text).join(" ");
    expect(worse).toContain("forecast origin October 2026");
    expect(worse).toContain("2.00% higher");
    expect(worse).toContain("did NOT beat the naive baseline");
    expect(worse).toContain("80% interval (ETS state-space) for that month is 99.00 to 105.00");
    const better = forecastStatements({ ...base, beatsNaive: true }).map((x) => x.text).join(" ");
    expect(better).toContain("was lower than the naive baseline");
    const unknown = forecastStatements({ ...base, beatsNaive: null, backtestOrigins: 7, items: [fc("2027-01-01", 98, 3)] }).map((x) => x.text).join(" ");
    expect(unknown).toContain("lower than the latest observed value");
    expect(unknown).toContain("no prediction interval");
    expect(unknown).toContain("No like-for-like comparison");
    expect(unknown).toContain("Only 7 backtest origins");
  });
  it("produces nothing when there is nothing to say", () => {
    const base = { name: "CPI", modelName: "ETS", latestIndex: null, items: [], horizon: 3, run: null, beatsNaive: null, backtestOrigins: null };
    expect(forecastStatements(base)).toEqual([]);
  });
});


describe("loadErrorText", () => {
  it("names the real cause for an unmigrated database, and otherwise blames the connection", () => {
    const migrated = loadErrorText("experiments", "API answered HTTP 503: forecasting tables not migrated: run python -m db.migrate");
    expect(migrated).toContain("migration 0002 has not been applied");
    expect(migrated).not.toContain("API connection");
    expect(loadErrorText("experiments", "ECONNREFUSED")).toBe("Unable to load experiments. Please check the API connection.");
    expect(loadErrorText("experiments", "")).toContain("check the API connection");
  });
});
