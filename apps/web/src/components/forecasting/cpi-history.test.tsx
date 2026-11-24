import { renderToStaticMarkup as renderRaw } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ForecastExplorer } from "@/components/forecasting/forecast-explorer";
import { ForecastCard, summarize } from "@/components/forecasting/forecast-pages";
import type { IndicatorForecastData } from "@/lib/forecast-data";
import { type Comparison, type ComparisonGroup, type ModelInfo, type SeriesInfo, type TrainingHistory, trainingLine } from "@/lib/forecasting";
import { fc, run } from "@/lib/forecasting-fixtures";
import type { IndicatorData } from "@/lib/indicator";
import { CPI_CONFIG } from "@/lib/indicators";
import { sourceFor } from "@/lib/source";

/** CPI forecasting on MoSPI's official linked history (Back 2013-2024 + Current 2025-). The UI must show a CPI
 *  forecast only when the API returns tested runs, say what the model was trained on, and keep an honest, more
 *  informative unavailable state for an API that has no such runs (production before the data import). */

const render = (el: React.ReactElement) => renderRaw(el).replace(/<!-- -->/g, "");
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/forecasting/cpi",
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}));

const TH: TrainingHistory = {
  kind: "official_linked", n_observations: 166, first_period: "2013-01-01", last_period: "2026-10-01", join_period: "2025-01-01",
  components: [
    { series_code: "mospi.cpi.2024.back.all_india.combined.general.index", first_period: "2013-01-01", last_period: "2024-12-01", n_observations: 144 },
    { series_code: "mospi.cpi.2024.current.all_india.combined.general.index", first_period: "2025-01-01", last_period: "2026-10-01", n_observations: 22 },
  ],
  note: "MoSPI publishes the Back series on the same 2024 = 100 base, calculated with a documented linking factor, so it extends the Current series without overlap.",
}; // prettier-ignore

const months = Array.from({ length: 22 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`);
const hist: IndicatorData = {
  kind: "cpi", baseYear: "2024", coverage: "All India", geography: "India", sourceName: "MoSPI", publisherNote: null, limitations: [], note: null,
  observations: months.map((p, i) => ({ period: p, index: 101 + i * 0.4, rate: null, indexSource: null, rateSource: null })),
} as IndicatorData; // prettier-ignore
const models: ModelInfo[] = [
  { id: "drift", name: "Drift", family: "baseline", explanation: "Straight line.", min_train: 4, status: "evaluated", unavailable_reason: null, completed_runs: 4, is_baseline: false },
  { id: "naive", name: "Naive", family: "baseline", explanation: "Latest value repeats.", min_train: 1, status: "evaluated", unavailable_reason: null, completed_runs: 4, is_baseline: true },
]; // prettier-ignore
const info = (over: Partial<SeriesInfo> = {}): SeriesInfo => ({
  indicator: "cpi", series_code: "mospi.cpi.2024.current.all_india.combined.general.index", base_year: "2024", n_observations: 22,
  first_period: "2025-01-01", last_period: "2026-10-01", latest_value: 109.4, evaluable_horizons: [1, 3, 6, 12],
  forecast_status: "has_experiments", reason: null, completed_backtests: 24, future_forecasts: 4, last_experiment_at: "2026-11-23T12:00:00Z",
  training_history: TH, ...over,
}); // prettier-ignore
const fRun = run({ id: 9, indicator: "cpi", model: "drift", model_name: "Drift", kind: "forecast", horizon: 6, training_start: "2013-01-01", training_cutoff: "2026-10-01" });
const targets = ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01"];
const items = targets.map((t, i) => fc(t, 110 + (i + 1) * 0.33, i + 1, 109 + (i + 1) * 0.3));
const group: ComparisonGroup = { group_id: "g", indicator: "cpi", horizon: 6, evaluation_start: "2025-06-01", evaluation_end: "2026-10-01", n_origins: 17, comparable: true, rankable: true, best: {}, warnings: [],
  models: [
    { run_id: 1, model: "naive", model_name: "Naive", is_baseline: true, n_origins: 17, runtime_seconds: 1, metrics: { mae: 2.3, coverage_80: 0.41, coverage_95: 0.71 }, vs_baseline_mae_pct: null },
    { run_id: 2, model: "drift", model_name: "Drift", is_baseline: false, n_origins: 17, runtime_seconds: 1, metrics: { mae: 1.08, coverage_80: 0.76, coverage_95: 0.88 }, vs_baseline_mae_pct: -53 },
  ] }; // prettier-ignore
const cmps: Record<number, Comparison> = Object.fromEntries([1, 3, 6].map((h) => [h, { indicator: "cpi", horizon: h, baseline: "naive", groups: [{ ...group, horizon: h }], excluded: [], note: "" }]));

const data = (over: Partial<IndicatorForecastData> = {}): IndicatorForecastData => ({
  id: "cpi", hist: { baseYear: hist.baseYear, observations: hist.observations, source: sourceFor(CPI_CONFIG, hist) }, histError: null, status: [], info: info(), models, runs: [fRun], stored: [{ model: "drift", run: fRun, items }], comparisons: cmps, error: null, ...over,
}); // prettier-ignore

describe("CPI forecast on the official linked history", () => {
  it("trainingLine names both official parts and the months", () => {
    expect(trainingLine(TH)).toBe("Trained on 166 months of official data (Jan 2013 – Oct 2026): MoSPI's back series on the same base until Dec 2024, then the current series.");
  });

  it("with tested runs the CPI card is a real forecast card and says what the model was trained on", () => {
    const s = summarize(data());
    expect(s.state).toBe("available");
    expect(s.selected?.view.model).toBe("drift");
    const html = render(<ForecastCard s={s} anchor />);
    expect(html).toContain("Latest official");
    expect(html).toContain("Model estimate");
    expect(html).toContain('data-testid="card-training"');
    expect(html).toContain("MoSPI&#x27;s back series on the same base until Dec 2024");
    expect(html).toContain('data-tour="fo-official"'); // the tour can anchor on CPI when it is the first available card
    expect(html).not.toContain("card-unavailable");
    expect(html).toContain('href="/indicators/cpi"');
  });

  it("an older API (no linked runs, 22 months): honest unavailable card that says older official CPI exists", () => {
    const s = summarize(data({ info: info({ forecast_status: "insufficient_history", evaluable_horizons: [], training_history: undefined, completed_backtests: 0, future_forecasts: 0, reason: "22 monthly observations: not enough." }), stored: [], runs: [], comparisons: {} }));
    expect(s.state).toBe("insufficient_history");
    const html = render(<ForecastCard s={s} anchor />);
    expect(html).toContain("Not enough comparable history");
    expect(html).toContain("has 22 months; testing a model needs at least 23");
    expect(html).toContain("back series on the same 2024 base (Jan 2013 – Dec 2024)");
    expect(html).toContain("The 2012-base levels are never mixed in.");
    expect(html).not.toContain("Model estimate");
  });

  it("a new API before the runs are imported: no forecast is claimed, the API's reason is shown", () => {
    const reason = "The official linked history (166 months) is long enough to test models, but no tested forecast is stored yet.";
    const s = summarize(data({ info: info({ forecast_status: "ready_not_run", reason, completed_backtests: 0, future_forecasts: 0 }), stored: [], runs: [], comparisons: {} }));
    expect(s.state).toBe("no_stored_forecast");
    const html = render(<ForecastCard s={s} anchor />);
    expect(html).toContain(reason.replace("'", "&#x27;"));
    expect(html).not.toContain("Model estimate");
  });

  const explorer = (th: TrainingHistory | null) => (
    <ForecastExplorer indicator="cpi" shortName="CPI" indexName="CPI index" axisLabel="Index (2024 = 100)" baseYear="2024" observations={hist.observations} source={sourceFor(CPI_CONFIG, hist)} stored={data().stored} runs={[fRun]} models={models} comparisons={cmps} trainingHistory={th} />
  );
  it("the explorer states the training data in Simple View and lists both series in Research View", () => {
    search = "";
    const simple = render(explorer(TH));
    expect(simple).toContain('data-testid="training-history"');
    search = "view=research";
    const research = render(explorer(TH));
    expect(research).toContain("Training data");
    expect(research).toContain("mospi.cpi.2024.back.all_india.combined.general.index (Jan 2013 – Dec 2024, 144 mo)");
    search = "";
  });
  it("without a linked history (WPI, IIP, or an older API) nothing about training data is added", () => {
    search = "view=research";
    const html = render(explorer(null));
    expect(html).not.toContain("training-history");
    expect(html).not.toContain("Training data");
    search = "";
  });
});
