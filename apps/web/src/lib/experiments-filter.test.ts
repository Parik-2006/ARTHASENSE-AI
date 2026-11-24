import { describe, expect, it } from "vitest";
import {
  applyExperimentFilters,
  DEFAULT_EXPERIMENT_FILTERS,
  paginate,
  parseExperimentFilters,
  serializeExperimentFilters,
} from "@/lib/experiments-filter";
import { run } from "@/lib/forecasting-fixtures";

// Synthetic runs: test fixtures only.
const runs = [
  run({ id: 1, indicator: "wpi", model: "arima", model_name: "ARIMA(1,1,0)", horizon: 6, n_origins: 7, status: "completed", created_at: "2026-11-01T00:00:00Z", metrics: { mae: 13 } }),
  run({ id: 2, indicator: "iip", model: "naive", model_name: "Naive", horizon: 6, n_origins: 19, status: "completed", created_at: "2026-11-02T00:00:00Z", metrics: { mae: 5 } }),
  run({ id: 3, indicator: "cpi", model: "arima", model_name: "ARIMA(1,1,0)", horizon: 1, n_origins: 0, status: "skipped", created_at: "2026-11-03T00:00:00Z", metrics: {} }),
  run({ id: 12, indicator: "iip", model: "ets", model_name: "ETS (damped trend)", horizon: 3, n_origins: 22, kind: "forecast", status: "completed", created_at: "2026-11-04T00:00:00Z", metrics: { mae: 4 } }),
];
const get = (q: string) => { const p = new URLSearchParams(q); return (k: string) => p.get(k); };
const F = DEFAULT_EXPERIMENT_FILTERS;

describe("URL round trip", () => {
  it("parses valid values and serializes only non-defaults", () => {
    const f = parseExperimentFilters(get("indicator=iip&model=ets&status=completed&kind=forecast&horizon=3&minOrigins=10&q=%2312&sort=mae&dir=asc&page=2"), ["ets"]);
    expect(f).toMatchObject({ indicator: "iip", model: "ets", status: "completed", kind: "forecast", horizon: 3, minOrigins: 10, q: "#12", sort: "mae", dir: "asc", page: 2 });
    expect(serializeExperimentFilters(f).toString()).toBe("indicator=iip&model=ets&status=completed&kind=forecast&horizon=3&minOrigins=10&q=%2312&sort=mae&dir=asc&page=2");
    expect(serializeExperimentFilters(F).toString()).toBe("");
  });
  it("drops invalid and unknown values safely", () => {
    const f = parseExperimentFilters(get("indicator=gva&model=chronos2&status=x&kind=y&horizon=-1&minOrigins=abc&sort=drop%20table&dir=up&page=0"), ["ets"]);
    expect(f).toEqual(F);
  });
});

describe("applyExperimentFilters", () => {
  const ids = (f: Partial<typeof F>) => applyExperimentFilters(runs, { ...F, sort: "n_origins", dir: "asc", ...f }).map((r) => r.id);
  it("filters by indicator, model, status, type, horizon and minimum origins", () => {
    expect(ids({ indicator: "iip" })).toEqual([2, 12]);
    expect(ids({ model: "arima" })).toEqual([3, 1]);
    expect(ids({ status: "skipped" })).toEqual([3]);
    expect(ids({ kind: "forecast" })).toEqual([12]);
    expect(ids({ horizon: 6 })).toEqual([1, 2]);
    expect(ids({ minOrigins: 10 })).toEqual([2, 12]);
  });
  it("searches by run id (exact) and by model name", () => {
    expect(ids({ q: "12" })).toEqual([12]);
    expect(ids({ q: "#1" })).toEqual([1]); // exact id, not 12
    expect(ids({ q: "damped" })).toEqual([12]);
  });
  it("sorts with missing values always last", () => {
    expect(applyExperimentFilters(runs, { ...F, sort: "mae", dir: "asc" }).map((r) => r.id)).toEqual([12, 2, 1, 3]);
    expect(applyExperimentFilters(runs, { ...F, sort: "mae", dir: "desc" }).map((r) => r.id)).toEqual([1, 2, 12, 3]);
  });
  it("a skipped run is kept unless filtered out (nothing hidden by default)", () => {
    expect(applyExperimentFilters(runs, F).map((r) => r.id)).toContain(3);
  });
});

describe("paginate", () => {
  it("clamps the page and reports page count", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    expect(paginate(items, 1)).toMatchObject({ page: 1, pages: 3 });
    expect(paginate(items, 3).items).toHaveLength(10);
    expect(paginate(items, 99).page).toBe(3);
    expect(paginate([], 5)).toEqual({ items: [], page: 1, pages: 1 });
  });
});
