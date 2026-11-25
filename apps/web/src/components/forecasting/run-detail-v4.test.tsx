import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDetailView } from "@/components/forecasting/run-detail";
import type { RunDetail } from "@/lib/forecasting";
import { fc, run } from "@/lib/forecasting-fixtures";

const detail = (over: Partial<RunDetail>): RunDetail => ({
  ...run({ id: 403, indicator: "gdp", model: "arima", model_name: "ARIMA", kind: "forecast", horizon: 1, training_start: "2022-04-01", training_cutoff: "2026-04-01" }),
  configuration: {}, n_forecast_rows: 1, score_notes: {}, score_samples: {}, rankable: false, disclaimer: "", ...over,
}); // prettier-ignore

describe("run detail: quarterly runs are labelled in fiscal quarters", () => {
  it("GDP run: quarters, never months", () => {
    const html = renderToStaticMarkup(<RunDetailView run={detail({ frequency: "quarterly", model_label: "ARIMA(0,1,0)" })} rows={[fc("2026-07-01", 8.2e6, 1)]} totalRows={1} />);
    expect(html).toContain("1 quarter");
    expect(html).not.toMatch(/\b1 month\b/);
    expect(html).toContain("Q1 FY2022-23");
    expect(html).toContain("Q2 FY2026-27");
    expect(html).toContain("ARIMA(0,1,0)");
  });
  it("monthly run unchanged", () => {
    const html = renderToStaticMarkup(<RunDetailView run={detail({ indicator: "wpi", frequency: "monthly", horizon: 6, training_start: "2012-04-01", training_cutoff: "2026-10-01" })} rows={[]} totalRows={0} />);
    expect(html).toContain("6 months");
    expect(html).toContain("April 2012");
  });
});
