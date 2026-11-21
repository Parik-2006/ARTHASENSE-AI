import { renderToStaticMarkup as renderRaw } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComparisonView } from "@/components/forecasting/comparison-view";
import { ExperimentsView } from "@/components/forecasting/experiments-view";
import { ForecastChart } from "@/components/forecasting/forecast-chart";
import { ForecastExplorer } from "@/components/forecasting/forecast-explorer";
import { RunDetailView } from "@/components/forecasting/run-detail";
import { ForecastingSubNav } from "@/components/forecasting/subnav";
import { ScenarioCalculator } from "@/components/intelligence/scenario";
import { type Comparison, type ComparisonGroup, type ModelInfo } from "@/lib/forecasting";
import { WPI_CONFIG } from "@/lib/indicators";
import { sourceFor } from "@/lib/source";
import { isActive, NAV_ITEMS } from "@/lib/nav";
import { fc, run } from "@/lib/forecasting-fixtures";

/** React inserts <!-- --> between adjacent text nodes; strip them so assertions read naturally. */
const render = (el: React.ReactElement) => renderRaw(el).replace(/<!-- -->/g, "");

let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/forecasting/wpi",
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}));

const history = Array.from({ length: 20 }, (_, i) => ({ period: `${2025 + Math.floor((i + 3) / 12)}-${String(((i + 3) % 12) + 1).padStart(2, "0")}-01`, index: 100 + i }));
const models: ModelInfo[] = [
  { id: "ets", name: "ETS (damped trend)", family: "statistical", explanation: "Exponential smoothing explained.", min_train: 12, status: "evaluated", unavailable_reason: null, completed_runs: 4, is_baseline: false },
  { id: "naive", name: "Naive", family: "baseline", explanation: "Latest value repeats.", min_train: 1, status: "evaluated", unavailable_reason: null, completed_runs: 4, is_baseline: true },
];
const stored = [{ model: "ets", run: run({ kind: "forecast", horizon: 3 }), items: [fc("2026-11-01", 120, 1, 118), fc("2026-12-01", 121, 2, 118), fc("2027-01-01", 122, 3, 117)] }];

const obs = history.map((h) => ({ period: h.period, index: h.index, rate: null, indexSource: null, rateSource: null }));
const source = sourceFor(WPI_CONFIG, null);
const props = (over: Record<string, unknown> = {}) => ({
  indicator: "wpi" as const, shortName: "WPI", indexName: "WPI index", axisLabel: "WPI index", baseYear: "2022-23",
  observations: obs, source, stored, runs: [run({ horizon: 3 })], models, comparisons: {}, ...over,
}); // prettier-ignore

describe("ForecastExplorer (synthetic fixtures)", () => {
  const html = render(<ForecastExplorer {...props()} />);
  it("shows stored forecasts with model, origin, intervals, run id and backtest accuracy", () => {
    expect(html).toContain("Forecast table");
    expect(html).toContain("ETS (damped trend)");
    expect(html).toContain("120.00");
    expect(html).toContain("118.00 to 122.00");
    expect(html).toContain("Backtest accuracy, 3-month horizon");
    expect(html).toContain("Exponential smoothing explained.");
    expect(html).toContain("ETS state-space");
    expect(html).toContain("Download CSV");
    expect(html).toContain("not official");
    expect(html).toContain("Reset filters");
  });
  it("separates official history and the model forecast in source attribution", () => {
    expect(html).toContain("Official data");
    expect(html).toContain("Model-generated forecast");
    expect(html).toContain("run #");
  });
  it("always shows a reliability assessment with reasons, and never calls a 7-origin run supported", () => {
    expect(html).toContain('data-testid="reliability"');
    const few = render(<ForecastExplorer {...props({ runs: [run({ horizon: 3, n_origins: 7 })] })} />);
    expect(few).not.toContain("Supported by available backtests");
    expect(few).toContain("indicative");
  });
  it("lists a stored forecast even without a backtest, labelled insufficient evidence (nothing hidden)", () => {
    const none = render(<ForecastExplorer {...props({ runs: [] })} />);
    expect(none).toContain("Insufficient evidence");
    expect(none).toContain("No backtest was stored");
    expect(none).toContain("has not been backtested, so no accuracy is claimed");
  });
  it("says so when there is no stored forecast at all", () => {
    const out = render(<ForecastExplorer {...props({ stored: [] })} />);
    expect(out).toContain("No stored forecast exists");
    expect(out).not.toContain("Forecast table");
  });
  it("warns when intervals are missing", () => {
    const noIv = [{ ...stored[0], items: stored[0].items.map((i) => ({ ...i, lower_80: null, upper_80: null })) }];
    expect(render(<ForecastExplorer {...props({ stored: noIv })} />)).toContain("provides no prediction interval");
  });
  it("flags indicative backtests and WPI-like concerning performance prominently", () => {
    const bad = run({ horizon: 3, n_origins: 7, metrics: { mae: 13.1, rmse: 19, mase: 33, smape: 11, coverage_80: 0, coverage_95: 0 } });
    const out = render(<ForecastExplorer {...props({ runs: [bad] })} />);
    expect(out).toContain('data-level="concerning"');
    expect(out).toContain('role="alert"');
    expect(out).toContain("only 0%");
    expect(out).toContain("only 7 origins");
  });
  it("URL filters: model/horizon in the link are honoured, unavailable ones are reported", () => {
    search = "model=chronos2&horizon=12";
    const out = render(<ForecastExplorer {...props()} />);
    search = "";
    expect(out).toContain('No stored forecast exists for model &quot;chronos2&quot;');
    expect(out).toContain("12-month horizon");
  });
  it("history window is separate from the horizon: a 3M window keeps the 3-month forecast", () => {
    search = "range=3M";
    const out = render(<ForecastExplorer {...props()} />);
    search = "";
    expect(out).toContain("Backtest accuracy, 3-month horizon");
    expect(out).toMatch(/Selection: .*Changing the history window does not change the forecast horizon/);
  });
  it("links back to the historical indicator page carrying only the window", () => {
    search = "range=3Y&model=ets&horizon=3";
    const out = render(<ForecastExplorer {...props()} />);
    search = "";
    expect(out).toContain('href="/indicators/wpi?range=3Y"');
  });
});

describe("ForecastChart", () => {
  it("renders a long series (40 years of months) quickly and completely", () => {
    const long = Array.from({ length: 480 }, (_, i) => ({ period: `${1990 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, index: 100 + Math.sin(i / 6) * 5 + i * 0.1 }));
    const t0 = performance.now();
    const html = render(<ForecastChart history={long} forecast={stored[0].items} axisLabel="x" name="x" />);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(html.match(/<circle/g)?.length).toBe(480 + 3);
  });
  it("separates observed and forecast and labels the origin", () => {
    const html = render(<ForecastChart history={history} forecast={stored[0].items} axisLabel="WPI index" name="WPI index" />);
    expect(html).toContain("forecast origin");
    expect(html).toContain("Observed (official)");
    expect(html).toContain("80% interval");
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).not.toContain("95% interval"); // no 95% band was supplied
  });
  it("renders nothing with too little history", () => {
    expect(render(<ForecastChart history={history.slice(0, 1)} forecast={[]} axisLabel="x" name="x" />)).toBe("");
  });
});

const group = (over: Partial<ComparisonGroup> = {}): ComparisonGroup => ({
  group_id: "g", indicator: "wpi", horizon: 1, evaluation_start: "2024-10-01", evaluation_end: "2026-10-01",
  n_origins: 25, comparable: true, rankable: true, best: { mae: "naive", rmse: "naive", mase: "naive", smape: "naive" }, warnings: ["Differences between models are not tested for statistical significance."],
  models: [
    { run_id: 1, model: "naive", model_name: "Naive", is_baseline: true, n_origins: 25, runtime_seconds: 0.4, metrics: { mae: 0.676, rmse: 1.09, mase: 1.77, smape: 0.64, coverage_80: 0.68, coverage_95: 0.8 }, vs_baseline_mae_pct: null },
    { run_id: 2, model: "ets", model_name: "ETS (damped trend)", is_baseline: false, n_origins: 25, runtime_seconds: 1.2, metrics: { mae: 1.136, rmse: 1.75, mase: 3.05, smape: 1.09 }, vs_baseline_mae_pct: 68.0 },
  ],
  ...over,
}); // prettier-ignore
const comparison = (g = group()): Comparison => ({ indicator: "wpi", horizon: 1, baseline: "naive", groups: [g], excluded: [{ model: "chronos2", model_name: "Chronos-2", reason: "unavailable: weights not downloaded" }], note: "Only identical data." });

describe("ComparisonView", () => {
  it("highlights the lowest error only for a rankable set and shows baseline, coverage and exclusions", () => {
    const html = render(<ComparisonView data={{ "wpi-1": comparison() }} />);
    expect(html).toContain("baseline");
    expect(html).toContain("68%"); // naive 80% coverage
    expect(html).toContain("+68.0%");
    expect(html).toContain("(lowest error)");
    expect(html).toContain("Chronos-2");
    expect(html).toContain("unavailable: weights not downloaded");
    expect(html).toContain("25 backtest origins");
  });
  it("never highlights when the evaluation set is too small", () => {
    const small = comparison(group({ rankable: false, best: {}, n_origins: 7, warnings: ["Only 7 backtest origins (< 12): differences are indicative, not evidence of superiority."] }));
    const html = render(<ComparisonView data={{ "wpi-1": small }} />);
    expect(html).not.toContain("(lowest error)");
    expect(html).toContain("indicative");
    expect(html).toContain("No model is highlighted");
  });
  it("explains why there is nothing to compare (CPI-style) and handles API failure", () => {
    const empty: Comparison = { indicator: "wpi", horizon: 1, baseline: "naive", groups: [], excluded: [], note: "" };
    expect(render(<ComparisonView data={{ "wpi-1": empty }} />)).toContain("nothing to compare");
    expect(render(<ComparisonView data={{ "wpi-1": null }} />)).toContain("Unable to load the comparison");
  });
});

describe("ExperimentsView and RunDetailView", () => {
  const runs = [run(), run({ id: 2, status: "skipped", model: "chronos2", model_name: "Chronos-2", error: "unavailable: weights", metrics: {}, n_origins: null })];
  it("lists runs with links, keeps skipped ones with their reason", () => {
    const html = render(<ExperimentsView runs={runs} total={2} />);
    expect(html).toContain('href="/forecasting/experiments/1"');
    expect(html).toContain("unavailable: weights");
    expect(html).toContain("Download CSV");
    expect(html).toContain("2 of 2 shown");
  });
  it("empty state", () => {
    expect(render(<ExperimentsView runs={[]} total={0} />)).toContain("No forecasting experiments have been stored yet.");
  });
  it("run detail shows provenance and the rankable caveat", () => {
    const html = render(<RunDetailView run={{ ...run({ n_origins: 7 }), configuration: { initial_train: 18 }, n_forecast_rows: 1, score_notes: {}, score_samples: { mae: 7 }, rankable: false, disclaimer: "Forecasts are statistical estimates." }} rows={[{ ...fc("2026-11-01", 120, 3), actual: 119 }]} totalRows={1} />);
    expect(html).toContain("Dataset fingerprint");
    expect(html).toContain("&quot;initial_train&quot;: 18");
    expect(html).toContain("indicative only");
    expect(html).toContain("1.00"); // error = 120 - 119
  });
});

describe("ScenarioCalculator", () => {
  it("is labelled hypothetical and uses the real latest value as its start", () => {
    const html = render(<ScenarioCalculator starts={[{ id: "wpi", name: "Wholesale Price Index", index: 113.3, period: "2026-10-01" }]} />);
    expect(html).toContain("not a forecast");
    expect(html).toContain("113.30");
    expect(html).toContain("(observed)");
    expect(html).toContain("(hypothetical)");
    expect(html).toContain("113.87"); // 113.3 * 1.005
  });
  it("has an honest empty state", () => {
    expect(render(<ScenarioCalculator starts={[]} />)).toContain("No stored index is available");
  });
});

describe("navigation", () => {
  it("has one Forecasts entry pointing at the real section, plus Intelligence", () => {
    const hrefs = NAV_ITEMS.map((n) => n.href);
    expect(hrefs).toContain("/forecasting");
    expect(hrefs).toContain("/intelligence");
    expect(hrefs).not.toContain("/forecasts");
    expect(NAV_ITEMS.filter((n) => n.label === "Forecasts")).toHaveLength(1);
    expect(isActive("/forecasting/wpi", "/forecasting")).toBe(true);
  });
  it("forecasting sub-navigation links every page and marks the current one", () => {
    const html = render(<ForecastingSubNav />);
    for (const href of ["/forecasting", "/forecasting/cpi", "/forecasting/wpi", "/forecasting/iip", "/forecasting/comparison", "/forecasting/experiments"])
      expect(html).toContain(`href="${href}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
