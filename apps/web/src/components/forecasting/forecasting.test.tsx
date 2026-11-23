import { renderToStaticMarkup as renderRaw } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComparisonView } from "@/components/forecasting/comparison-view";
import { ExperimentsView } from "@/components/forecasting/experiments-view";
import { ForecastChart } from "@/components/forecasting/forecast-chart";
import { ForecastExplorer } from "@/components/forecasting/forecast-explorer";
import { RunDetailView } from "@/components/forecasting/run-detail";
import { ForecastingSubNav } from "@/components/forecasting/subnav";
import { ScenarioCalculator } from "@/components/intelligence/scenario";
import { type Comparison, type ComparisonGroup, type ModelInfo, type SeriesInfo } from "@/lib/forecasting";
import { WPI_CONFIG } from "@/lib/indicators";
import { sourceFor } from "@/lib/source";
import { isActive, NAV_ITEMS } from "@/lib/nav";
import { fc, run } from "@/lib/forecasting-fixtures";

/** React inserts <!-- --> between adjacent text nodes; strip them so assertions read naturally. */
const render = (el: React.ReactElement) => renderRaw(el).replace(/<!-- -->/g, "");

let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/forecasting/wpi",
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
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

// Evidence comes from ONE comparison group that holds the model and the naive baseline (identical origins).
const cmpGroup = (over: Partial<ComparisonGroup> = {}, ets: Record<string, number> = { mae: 2.0, rmse: 2.5, mase: 1.1, smape: 1.5, coverage_80: 0.8, coverage_95: 0.95 }): ComparisonGroup => ({
  group_id: "core-3", indicator: "wpi", horizon: 3, evaluation_start: "2024-10-01", evaluation_end: "2026-10-01", n_origins: 23, comparable: true, rankable: true,
  best: {}, warnings: [], models: [
    { run_id: 31, model: "naive", model_name: "Naive", is_baseline: true, n_origins: 23, runtime_seconds: 0.1, metrics: { mae: 2.4, coverage_80: 0.7, coverage_95: 0.9 }, vs_baseline_mae_pct: null },
    { run_id: 32, model: "ets", model_name: "ETS (damped trend)", is_baseline: false, n_origins: 23, runtime_seconds: 1, metrics: ets, vs_baseline_mae_pct: -16.7 },
  ], ...over,
}); // prettier-ignore
const cmp3 = (g: ComparisonGroup = cmpGroup()): Record<number, Comparison> => ({ 3: { indicator: "wpi", horizon: 3, baseline: "naive", groups: [g], excluded: [], note: "" } });

describe("ForecastExplorer: Simple View (default)", () => {
  const html = render(<ForecastExplorer {...props({ comparisons: cmp3() })} />);
  it("leads with KPIs: latest official, forecast, expected change and reliability", () => {
    expect(html).toContain("Latest official");
    expect(html).toContain("119.00"); // last synthetic observation
    expect(html).toContain("Forecast · January 2027");
    expect(html).toContain("122.00");
    expect(html).toContain("Expected change");
    expect(html).toContain("+2.52%"); // (122 / 119 - 1) * 100
    expect(html).toContain('data-testid="reliability-meter"');
  });
  it("has model and horizon controls separate from the history window", () => {
    expect(html).toContain('aria-label="Model"');
    expect(html).toContain('aria-labelledby="fx-horizon-label"');
    expect(html).toContain('aria-label="History shown"');
  });
  it("explains in plain words, with the 80% range and its past coverage", () => {
    expect(html).toContain("What this means");
    expect(html).toContain("ETS (damped trend) estimates the WPI index at 122.00 in January 2027");
    expect(html).toContain("117.00 to 127.00");
    expect(html).toContain("80% of actual values fell inside");
    expect(html).toContain("Values outside the range are possible.");
  });
  it("states the data connection and links to the historical series", () => {
    expect(html).toContain("same official series shown in Indicators");
    expect(html).toContain("separately generated statistical estimates");
    expect(html).toContain('href="/indicators/wpi"');
  });
  it("keeps technical detail out of Simple View but provenance in one line", () => {
    expect(html).not.toContain('data-testid="research-view"');
    expect(html).not.toContain("Forecast table");
    expect(html).toContain("run #1");
    expect(html).toContain("Official data:");
  });
  it("mounts the spotlight tour targets for every explorer step", () => {
    for (const t of ["fx-official", "fx-model", "fx-horizon", "fx-chart", "fx-bands", "fx-reliability"]) expect(html).toContain(`data-tour="${t}"`);
  });
});

describe("ForecastExplorer: Research View", () => {
  const html = (over: Record<string, unknown> = {}, q = "view=research") => {
    search = q;
    const out = render(<ForecastExplorer {...props({ comparisons: cmp3(), ...over })} />);
    search = "";
    return out;
  };
  it("shows metrics for the model AND the baseline from one test set, with links", () => {
    const out = html();
    expect(out).toContain('data-testid="research-view"');
    expect(out).toContain("Backtest evidence · 3-month horizon");
    expect(out).toContain("come from one test set: 23 forecast origins");
    expect(out).toContain("Naive baseline");
    expect(out).toContain("2.400"); // baseline MAE in the same table
    expect(out).toContain('href="/forecasting/experiments/32?view=research"');
    expect(out).toContain("Compare models");
  });
  it("keeps the forecast table, CSV, interval method and both source attributions", () => {
    const out = html();
    expect(out).toContain("Forecast table");
    expect(out).toContain("118.00 to 122.00");
    expect(out).toContain("Download CSV");
    expect(out).toContain("ETS state-space");
    expect(out).toContain("Official data");
    expect(out).toContain("Model-generated forecast");
    expect(out).toContain("Exponential smoothing explained.");
    expect(out).toContain("Data fingerprint");
  });
  it("never calls a 7-origin set supported", () => {
    const out = html({ comparisons: cmp3(cmpGroup({ n_origins: 7, rankable: false, models: cmpGroup().models.map((m) => ({ ...m, n_origins: 7 })) })) });
    expect(out).not.toContain("Supported by available backtests");
    expect(out).toContain("indicative");
  });
  it("without a comparable test set: insufficient evidence, no accuracy claimed (nothing hidden)", () => {
    const out = html({ comparisons: {} });
    expect(out).toContain("Insufficient evidence");
    expect(out).toContain("no accuracy is claimed");
    expect(out).toContain("Not yet tested");
  });
  it("flags WPI-like concerning performance (worse than baseline, 0% coverage)", () => {
    const bad = cmpGroup({ n_origins: 7, rankable: false, models: cmpGroup().models.map((m) => (m.model === "ets" ? { ...m, n_origins: 7, metrics: { mae: 13.1, rmse: 19, mase: 33, smape: 11, coverage_80: 0, coverage_95: 0 } } : { ...m, n_origins: 7 })) });
    const out = html({ comparisons: cmp3(bad) });
    expect(out).toContain('data-level="concerning"');
    expect(out).toContain("only 0%");
    expect(out).toContain("only 7 origins");
    expect(out).toContain("Use with caution");
  });
});

describe("ForecastExplorer: URL contract", () => {
  const at = (q: string, over: Record<string, unknown> = {}) => {
    search = q;
    const out = render(<ForecastExplorer {...props({ comparisons: cmp3(), ...over })} />);
    search = "";
    return out;
  };
  it("unavailable model/horizon in the link are reported, not silently replaced", () => {
    const out = at("model=chronos2&horizon=12");
    expect(out).toContain("No stored forecast exists for model &quot;chronos2&quot;");
    expect(out).toContain("12-month horizon");
  });
  it("offers 1 and 3 months from a stored 3-month run and labels a partial view", () => {
    const out = at("horizon=1");
    expect(out).toMatch(/role="radio" aria-checked="true"[^>]*>1 month/);
    expect(out).toContain("first 1 of 3 stored months");
  });
  it("history window never changes the horizon", () => {
    expect(at("range=1Y")).toContain("3-month forecast");
  });
  it("links back to Indicators carrying only a supported window", () => {
    const out = at("range=3Y&model=ets&horizon=3&view=research");
    expect(out).toContain('href="/indicators/wpi?range=3Y"');
    expect(out).not.toMatch(/href="\/indicators\/wpi[^"]*(model|horizon|view)=/);
  });
  it("warns when intervals are missing", () => {
    const noIv = [{ ...stored[0], items: stored[0].items.map((i) => ({ ...i, lower_80: null, upper_80: null })) }];
    expect(at("", { stored: noIv })).toContain("provides no uncertainty range");
  });
  it("says so when there is no stored forecast at all", () => {
    const out = at("", { stored: [] });
    expect(out).toContain("No stored forecast exists");
    expect(out).not.toContain("What this means");
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
  const at = (q: string, el: () => React.ReactElement) => {
    search = q;
    const out = render(el());
    search = "";
    return out;
  };
  it("marks the lowest error only for a rankable set and shows baseline, coverage and track record", () => {
    const html = at("indicator=wpi&horizon=1", () => <ComparisonView data={{ "wpi-1": comparison() }} />);
    expect(html).toContain("baseline");
    expect(html).toContain("68%"); // naive 80% coverage
    expect(html).toContain("+68.0%");
    expect(html).toContain("lowest error");
    expect(html).toContain("Lower error is generally better.");
    expect(html).toContain("not tested for statistical significance");
    expect(html).toContain('data-testid="reliability-meter"');
  });
  it("shows the error chart with the naive reference line", () => {
    const html = at("indicator=wpi&horizon=1", () => <ComparisonView data={{ "wpi-1": comparison() }} />);
    expect(html).toContain("Error by model");
    expect(html).toContain("Naive baseline level");
  });
  it("never ranks when the evaluation set is too small", () => {
    const small = comparison(group({ rankable: false, best: {}, n_origins: 7, warnings: ["Only 7 backtest origins (< 12): differences are indicative, not evidence of superiority."] }));
    const html = at("indicator=wpi&horizon=1", () => <ComparisonView data={{ "wpi-1": small }} />);
    expect(html).not.toContain("lowest error</span>");
    expect(html).toContain("indicative");
    expect(html).toContain("No model is marked as best");
  });
  it("does not order by error on a non-rankable set (neutral order in table and bars), but does on a rankable one", () => {
    const models = [
      { run_id: 7, model: "arima", model_name: "ARIMA(1,1,0)", is_baseline: false, n_origins: 7, runtime_seconds: 1, metrics: { mae: 1.0 }, vs_baseline_mae_pct: -50 },
      { run_id: 8, model: "drift", model_name: "Drift", is_baseline: false, n_origins: 7, runtime_seconds: 1, metrics: { mae: 9.0 }, vs_baseline_mae_pct: 350 },
      { run_id: 9, model: "naive", model_name: "Naive", is_baseline: true, n_origins: 7, runtime_seconds: 1, metrics: { mae: 2.0 }, vs_baseline_mae_pct: null },
      { run_id: 10, model: "ets", model_name: "ETS (damped trend)", is_baseline: false, n_origins: 7, runtime_seconds: 1, metrics: { mae: 0.5 }, vs_baseline_mae_pct: -75 },
    ];
    const order = (html: string) => ["Naive", "ARIMA(1,1,0)", "Drift", "ETS (damped trend)"].map((n) => ({ n, i: html.indexOf(n) })).sort((a, b) => a.i - b.i).map((x) => x.n);
    const small = at("indicator=wpi&horizon=1", () => <ComparisonView data={{ "wpi-1": comparison(group({ rankable: false, best: {}, n_origins: 7, models })) }} />);
    const table = small.slice(small.indexOf("<tbody"), small.indexOf("</tbody>"));
    const bars = small.slice(small.indexOf("Error by model"));
    expect(order(table)).toEqual(["Naive", "ARIMA(1,1,0)", "Drift", "ETS (damped trend)"]); // baseline first, then A-Z
    expect(order(bars)).toEqual(["Naive", "ARIMA(1,1,0)", "Drift", "ETS (damped trend)"]);
    expect(small).toContain("listed baseline first, then alphabetically");
    const big = at("indicator=wpi&horizon=1", () => <ComparisonView data={{ "wpi-1": comparison(group({ rankable: true, best: { mae: "ets" }, n_origins: 25, models: models.map((m) => ({ ...m, n_origins: 25 })) })) }} />);
    expect(order(big.slice(big.indexOf("<tbody"), big.indexOf("</tbody>")))).toEqual(["ETS (damped trend)", "ARIMA(1,1,0)", "Naive", "Drift"]);
  });
  it("Research View adds all metrics, runs, exclusions and CSV", () => {
    const html = at("indicator=wpi&horizon=1&view=research", () => <ComparisonView data={{ "wpi-1": comparison() }} />);
    expect(html).toContain('data-testid="research-view"');
    expect(html).toContain("All metrics on this test set");
    expect(html).toContain("Chronos-2");
    expect(html).toContain("unavailable: weights not downloaded");
    expect(html).toContain("Download CSV");
  });
  it("explains why there is nothing to compare from real series counts, and handles API failure", () => {
    const empty: Comparison = { indicator: "cpi", horizon: 1, baseline: "naive", groups: [], excluded: [], note: "" };
    const series = [{ indicator: "cpi", n_observations: 22, evaluable_horizons: [] } as unknown as SeriesInfo];
    const html = at("indicator=cpi&horizon=1", () => <ComparisonView data={{ "cpi-1": empty }} series={series} />);
    const failed = at("indicator=cpi&horizon=1", () => <ComparisonView data={{ "cpi-1": null }} />);
    expect(html).toContain("Nothing to compare yet");
    expect(html).toContain("has 22 monthly observations");
    expect(html).toContain("needs at least 23");
    expect(html).not.toContain("only 12 monthly observations");
    expect(failed).toContain("Unable to load the comparison");
  });
});

describe("ExperimentsView and RunDetailView", () => {
  const runs = [run(), run({ id: 2, status: "skipped", model: "chronos2", model_name: "Chronos-2", error: "unavailable: weights", metrics: {}, n_origins: null })];
  it("lists runs with links, keeps skipped ones with their reason", () => {
    const html = render(<ExperimentsView runs={runs} total={2} />);
    expect(html).toContain('href="/forecasting/experiments/1"');
    expect(html).toContain("skipped");
    expect(html).toContain("Download CSV");
    expect(html).toContain("2 of 2 runs");
    expect(html).toContain('aria-expanded="false"'); // details collapsed by default
    expect(html).toContain('data-tour="fe-details"');
    expect(html).not.toMatch(/MASE<span/); // metric columns only in Research View
    search = "view=research";
    const research = render(<ExperimentsView runs={runs} total={2} />);
    search = "";
    expect(research).toContain('href="/forecasting/experiments/1?view=research"');
    expect(research).toMatch(/MASE<span/);
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
    expect(html).toContain('role="radiogroup" aria-label="Detail level"');
  });
  it("Research View follows the reader across Forecasts tabs", () => {
    search = "view=research";
    const html = render(<ForecastingSubNav />);
    search = "";
    expect(html).toContain('href="/forecasting/wpi?view=research"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Research/);
  });
});
