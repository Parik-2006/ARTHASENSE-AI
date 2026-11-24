import { describe, expect, it } from "vitest";
import { forecastViews, MAE_TIE_TOLERANCE, pickDefaultV4 } from "@/lib/forecast-evidence";
import { forecastMeta, forecastsToCsvV4, impliedYoy } from "@/lib/forecast-meta";
import { modelDetail, periodAdj, periodLabel, periodsText, quarterOfLabel, type TrainingHistory, trainingLine } from "@/lib/forecasting";
import { fc, run } from "@/lib/forecasting-fixtures";

describe("fiscal quarters", () => {
  it("labels quarters by India's fiscal year (Q1 = Apr–Jun)", () => {
    expect(quarterOfLabel("2026-04-01")).toBe("Q1 FY2026-27");
    expect(quarterOfLabel("2026-07-01", true)).toBe("Q2 FY2026-27 (Jul–Sep 2026)");
    expect(quarterOfLabel("2027-01-01", true)).toBe("Q4 FY2026-27 (Jan–Mar 2027)");
    expect(periodLabel("2026-10-01", "monthly")).toBe("Oct 2026");
    expect(periodsText(4, "quarterly")).toBe("4 quarters");
    expect(periodsText(1, "monthly")).toBe("1 month");
    expect(periodAdj(6)).toBe("6-month");
  });

  it("formats GDP in lakh crore and keeps index formatting for prices", () => {
    expect(forecastMeta("gdp").value(8136153)).toBe("₹81.36 lakh cr");
    expect(forecastMeta("wpi").value(113.3)).toBe("113.30");
    expect(forecastMeta("gdp").horizons).toEqual([1, 2, 4]);
    expect(forecastMeta("gdp").preferH).toBe(4);
  });
});

describe("implied year-on-year growth", () => {
  const hist = [
    { period: "2025-04-01", index: 7546230 },
    { period: "2025-07-01", index: 7541258 },
    { period: "2026-04-01", index: 8136153 },
  ];
  it("divides by the SAME quarter one year earlier, never the previous quarter", () => {
    expect(impliedYoy("2026-04-01", 8136153, hist)).toBeCloseTo((8136153 / 7546230 - 1) * 100, 10);
    expect(impliedYoy("2026-07-01", 8000000, hist)).toBeCloseTo((8000000 / 7541258 - 1) * 100, 10);
  });
  it("is unavailable (null) when that quarter is not stored", () => {
    expect(impliedYoy("2027-01-01", 9e6, hist)).toBeNull();
  });
  it("quarterly CSV carries quarter labels, implied YoY and the model configuration", () => {
    const r = { ...run({ id: 7, kind: "forecast", horizon: 1, model: "drift" }), model_label: "Drift" };
    const csv = forecastsToCsvV4([{ ...fc("2026-07-01", 8.1e6, 1), origin_date: "2026-04-01" }], {
      indicator: "GDP", baseYear: "2022-23", seriesId: "s", publisher: "NSO", modelId: "drift", modelName: "Drift", run: r,
      latest: { period: "2026-04-01", value: 8136153 }, reliability: "Limited evidence", unit: "₹ lakh crore", history: hist,
    }); // prettier-ignore
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toContain("target_quarter");
    expect(row).toContain("Q2 FY2026-27");
    expect(row).toContain(((8.1e6 / 7541258 - 1) * 100).toFixed(4));
  });
});

describe("quarterly forecast views", () => {
  it("a 4-quarter run offers 1, 2 and 4 quarters (never the monthly 3)", () => {
    const r = run({ id: 1, kind: "forecast", horizon: 4, model: "drift" });
    const items = ["2026-07-01", "2026-10-01", "2027-01-01", "2027-04-01"].map((t, i) => fc(t, 1 + i, i + 1));
    expect(forecastViews([{ model: "drift", run: r, items }], [1, 2, 4]).map((v) => v.horizon)).toEqual([1, 2, 4]);
  });
});

describe("default selection (V4 tie-break)", () => {
  const c = (model: string, mae: number | null, level: "supported" | "limited" | "concerning" | "insufficient" = "supported") => ({ model, horizon: 6, level, mae });
  it("evidence level first: a lower MAE never beats a stronger track record", () => {
    expect(pickDefaultV4([c("rf", 1.9, "concerning"), c("sarima", 2.0)])?.model).toBe("sarima");
  });
  it("within the tolerance the SIMPLER model wins", () => {
    const close = 1.0 * (1 + MAE_TIE_TOLERANCE / 2);
    const p = pickDefaultV4([c("xgboost", 1.0), c("drift", close)]);
    expect(p?.model).toBe("drift");
    expect(p?.reason).toMatch(/simplest/);
  });
  it("outside the tolerance the lower error wins", () => {
    expect(pickDefaultV4([c("xgboost", 1.0), c("drift", 1.05)])?.model).toBe("xgboost");
  });
  it("the reader's URL choice wins when stored", () => {
    expect(pickDefaultV4([c("drift", 1), c("ets", 2)], { model: "ets" })).toMatchObject({ model: "ets", reason: "Chosen in the page link." });
  });
  it("quarterly: prefers the 4-quarter horizon and says quarters", () => {
    const q = [{ model: "drift", horizon: 4, level: "limited" as const, mae: 1 }, { model: "naive", horizon: 1, level: "limited" as const, mae: 1 }];
    const p = pickDefaultV4(q, {}, 4, "quarterly");
    expect(p).toMatchObject({ model: "drift", horizon: 4 });
    expect(p?.reason).toMatch(/4-quarter/);
  });
});

describe("model transparency", () => {
  it("shows the exact configuration only when it says more than the name", () => {
    expect(modelDetail("SARIMA", { model_label: "SARIMA(1,1,1)(0,1,1)12" })).toBe("SARIMA(1,1,1)(0,1,1)12");
    expect(modelDetail("Drift", { model_label: "Drift" })).toBeNull();
    expect(modelDetail("Drift", null)).toBeNull();
  });
  it("names the publisher and factor of a linking-factor history", () => {
    const th: TrainingHistory = {
      kind: "official_linking_factor", linking_factor: 1.53, n_observations: 175, first_period: "2012-04-01", last_period: "2026-10-01", join_period: "2023-04-01", note: "",
      components: [
        { series_code: "mospi.wpi.2011-12.india.all_commodities.index", first_period: "2012-04-01", last_period: "2023-03-01", n_observations: 132, base_year: "2011-12" },
        { series_code: "mospi.wpi.2022-23.india.all_commodities.index", first_period: "2023-04-01", last_period: "2026-10-01", n_observations: 43, base_year: "2022-23" },
      ],
    }; // prettier-ignore
    expect(trainingLine(th)).toBe(
      "Trained on 175 months (Apr 2012 – Oct 2026): the base 2011-12 series until Mar 2023, carried onto the current base with the Office of the Economic Adviser's published linking factor (÷ 1.53), then the official current series.",
    );
  });
});
