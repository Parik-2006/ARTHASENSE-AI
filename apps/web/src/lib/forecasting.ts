/** Types, strict parsers, and deterministic helpers for the forecasting pages.
 *  Shapes mirror services/api/app/forecasting.py. Nothing here invents a number. */

export type IndicatorId = "cpi" | "wpi" | "iip";
export const INDICATOR_IDS: IndicatorId[] = ["cpi", "wpi", "iip"];
export const INDICATOR_NAMES: Record<IndicatorId, string> = {
  cpi: "Consumer Price Index (CPI)",
  wpi: "Wholesale Price Index (WPI)",
  iip: "Index of Industrial Production (IIP)",
};
export const HORIZONS = [1, 3, 6, 12] as const;

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  explanation: string;
  min_train: number;
  status: "evaluated" | "not_evaluated" | "unavailable";
  unavailable_reason: string | null;
  completed_runs: number;
  is_baseline: boolean;
}

export interface SeriesInfo {
  indicator: IndicatorId;
  series_code: string;
  base_year: string | null;
  n_observations: number;
  first_period: string | null;
  last_period: string | null;
  latest_value: number | null;
  evaluable_horizons: number[];
  forecast_status: "no_data" | "insufficient_history" | "ready_not_run" | "has_experiments";
  reason: string | null;
  completed_backtests: number;
  future_forecasts: number;
  last_experiment_at: string | null;
  /** Present only when models train on a documented official linked history (CPI). Older APIs omit it. */
  training_history?: TrainingHistory | null;
}

export interface TrainingHistory {
  kind: "official_linked";
  n_observations: number;
  first_period: string;
  last_period: string;
  /** First month of the current series. */
  join_period: string;
  components: { series_code: string; first_period: string; last_period: string; n_observations: number }[];
  note: string;
}

/** One plain sentence on what a linked-history model was trained on. */
export function trainingLine(th: TrainingHistory): string {
  const back = th.components[0];
  return `Trained on ${th.n_observations} months of official data (${monthLabel(th.first_period)} – ${monthLabel(th.last_period)}): MoSPI's back series on the same base until ${monthLabel(back.last_period)}, then the current series.`;
}

export interface Run {
  id: number;
  experiment_id: string | null;
  indicator: IndicatorId | null;
  model: string;
  model_name: string;
  kind: "backtest" | "forecast";
  status: "completed" | "failed" | "skipped";
  error: string | null;
  horizon: number;
  suite: string | null;
  n_origins: number | null;
  training_start: string | null;
  training_cutoff: string;
  dataset_fingerprint: string | null;
  origins_fingerprint: string | null;
  snapshot_policy: string | null;
  random_seed: number | null;
  runtime_seconds: number | null;
  created_at: string;
  evaluation_start: string | null;
  evaluation_end: string | null;
  metrics: Record<string, number>;
}

export interface RunDetail extends Run {
  configuration: Record<string, unknown>;
  n_forecast_rows: number;
  score_notes: Record<string, string | null>;
  score_samples: Record<string, number | null>;
  rankable: boolean;
  disclaimer: string;
}

export interface ForecastRow {
  origin_date: string | null;
  target_date: string;
  step: number | null;
  forecast: number;
  actual: number | null;
  lower_80: number | null;
  upper_80: number | null;
  lower_95: number | null;
  upper_95: number | null;
  interval_method: string | null;
}

export interface LatestForecast {
  run: Run | null;
  items: ForecastRow[];
  note: string;
}

export interface ComparedModel {
  run_id: number;
  model: string;
  model_name: string;
  is_baseline: boolean;
  n_origins: number;
  runtime_seconds: number | null;
  metrics: Record<string, number>;
  vs_baseline_mae_pct: number | null;
}

export interface ComparisonGroup {
  group_id: string;
  indicator: IndicatorId;
  horizon: number;
  evaluation_start: string | null;
  evaluation_end: string | null;
  n_origins: number;
  comparable: boolean;
  rankable: boolean;
  best: Record<string, string>;
  warnings: string[];
  models: ComparedModel[];
}

export interface Comparison {
  indicator: IndicatorId;
  horizon: number;
  baseline: string;
  groups: ComparisonGroup[];
  excluded: { model: string; model_name: string; reason: string }[];
  note: string;
}

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nullable = (f: (v: unknown) => boolean) => (v: unknown) => v === null || f(v);
const numMap = (v: unknown) => rec(v) && Object.values(v).every(isNum);

function has(o: Record<string, unknown>, shape: Record<string, (v: unknown) => boolean>): boolean {
  return Object.entries(shape).every(([k, f]) => f(o[k]));
}

const RUN_SHAPE: Record<string, (v: unknown) => boolean> = {
  id: isNum, model: isStr, model_name: isStr, kind: isStr, status: isStr, horizon: isNum,
  training_cutoff: isStr, created_at: isStr, metrics: numMap,
  error: nullable(isStr), n_origins: nullable(isNum), suite: nullable(isStr), runtime_seconds: nullable(isNum),
}; // prettier-ignore

export function parseRun(v: unknown): Run | null {
  return rec(v) && has(v, RUN_SHAPE) ? (v as unknown as Run) : null;
}

export function parseRunDetail(v: unknown): RunDetail | null {
  if (!rec(v) || !has(v, RUN_SHAPE) || !rec(v.configuration) || !isNum(v.n_forecast_rows)) return null;
  return v as unknown as RunDetail;
}

export function parseRunPage(v: unknown): { total: number; items: Run[] } | null {
  if (!rec(v) || !isNum(v.total) || !Array.isArray(v.items)) return null;
  const items = v.items.map(parseRun);
  return items.every((i) => i) ? { total: v.total, items: items as Run[] } : null;
}

const FC_SHAPE: Record<string, (v: unknown) => boolean> = {
  target_date: isStr, forecast: isNum, actual: nullable(isNum), lower_80: nullable(isNum),
  upper_80: nullable(isNum), lower_95: nullable(isNum), upper_95: nullable(isNum),
}; // prettier-ignore

export function parseForecastRows(v: unknown): ForecastRow[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((r) => rec(r) && has(r, FC_SHAPE)) ? (v as ForecastRow[]) : null;
}

export function parseForecastPage(v: unknown): { total: number; items: ForecastRow[]; kind: string } | null {
  if (!rec(v) || !isNum(v.total) || !isStr(v.kind)) return null;
  const items = parseForecastRows(v.items);
  return items ? { total: v.total, items, kind: v.kind } : null;
}

export function parseLatest(v: unknown): LatestForecast | null {
  if (!rec(v) || !isStr(v.note)) return null;
  const items = parseForecastRows(v.items);
  const run = v.run === null ? null : parseRun(v.run);
  return items && (v.run === null || run) ? { run, items, note: v.note } : null;
}

export function parseModels(v: unknown): ModelInfo[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every((m) => rec(m) && has(m, { id: isStr, name: isStr, family: isStr, explanation: isStr, status: isStr, completed_runs: isNum, min_train: isNum }));
  return ok ? (v as ModelInfo[]) : null;
}

export function parseSeries(v: unknown): SeriesInfo[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every((s) => rec(s) && has(s, { indicator: isStr, n_observations: isNum, forecast_status: isStr, evaluable_horizons: Array.isArray, completed_backtests: isNum, future_forecasts: isNum, latest_value: nullable(isNum) }));
  return ok ? (v as SeriesInfo[]) : null;
}

export function parseComparison(v: unknown): Comparison | null {
  if (!rec(v) || !isStr(v.indicator) || !isNum(v.horizon) || !Array.isArray(v.groups) || !Array.isArray(v.excluded)) return null;
  const ok = v.groups.every(
    (g) => rec(g) && has(g, { group_id: isStr, n_origins: isNum, rankable: (x) => typeof x === "boolean", best: rec, warnings: Array.isArray, models: Array.isArray }),
  );
  return ok ? (v as unknown as Comparison) : null;
}

/** User-facing text for a failed forecasting request: say "not migrated" instead of blaming the connection. */
export function loadErrorText(what: string, error: string): string {
  if (error.includes("not migrated"))
    return `Forecasting is not set up in this database yet (migration 0002 has not been applied). Run python -m db.migrate, then reload.`;
  return `Unable to load ${what}. Please check the API connection.`;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------- formatting ----------

export function fmt(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? "—" : v.toFixed(digits);
}

export const METRIC_LABELS: Record<string, string> = {
  mae: "MAE", rmse: "RMSE", mase: "MASE", smape: "sMAPE (%)", bias: "Bias",
  coverage_80: "80% interval coverage", coverage_95: "95% interval coverage",
  width_80: "80% interval width", width_95: "95% interval width",
}; // prettier-ignore

export function fmtMetric(name: string, v: number | undefined): string {
  if (v === undefined) return "—";
  if (name.startsWith("coverage")) return `${(v * 100).toFixed(0)}%`;
  return v.toFixed(name === "mase" || name === "smape" ? 2 : 3);
}

export function monthLabel(iso: string, long = false): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${(long ? full : names)[Number(m[2]) - 1]} ${m[1]}`;
}

// ---------- CSV (missing stays empty) ----------

function cell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function forecastsToCsv(rows: ForecastRow[], model: string, indicator: string): string {
  const head = ["indicator", "model", "forecast_origin", "target_month", "forecast_index", "lower_80", "upper_80", "lower_95", "upper_95", "interval_method"];
  const lines = rows.map((r) =>
    [indicator, model, r.origin_date, r.target_date, r.forecast, r.lower_80, r.upper_80, r.lower_95, r.upper_95, r.interval_method].map(cell).join(","),
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}

export function runsToCsv(runs: Run[]): string {
  const head = ["run_id", "indicator", "model", "kind", "status", "horizon", "suite", "n_origins", "training_start", "training_cutoff", "mae", "rmse", "mase", "smape", "runtime_seconds", "created_at", "note"];
  const lines = runs.map((r) =>
    [r.id, r.indicator, r.model, r.kind, r.status, r.horizon, r.suite, r.n_origins, r.training_start, r.training_cutoff, r.metrics.mae ?? null, r.metrics.rmse ?? null, r.metrics.mase ?? null, r.metrics.smape ?? null, r.runtime_seconds, r.created_at, r.error]
      .map((v) => cell(v as string | number | null))
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}

export function comparisonToCsv(g: ComparisonGroup): string {
  const metrics = ["mae", "rmse", "mase", "smape", "bias", "coverage_80", "coverage_95"];
  const head = ["indicator", "horizon", "model", "is_baseline", "n_origins", ...metrics, "vs_naive_mae_pct", "runtime_seconds"];
  const lines = g.models.map((m) =>
    [g.indicator, g.horizon, m.model, m.is_baseline ? "true" : "false", m.n_origins, ...metrics.map((k) => m.metrics[k] ?? null), m.vs_baseline_mae_pct, m.runtime_seconds]
      .map((v) => cell(v as string | number | null))
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}

const METHOD_LABELS: Record<string, string> = {
  random_walk_gaussian: "random-walk Gaussian",
  seasonal_random_walk_gaussian: "seasonal random-walk Gaussian",
  drift_gaussian: "drift Gaussian",
  ets_state_space: "ETS state-space",
  sarimax_state_space: "SARIMAX state-space",
  online_conformal: "online conformal",
};

export function methodLabel(m: string | null | undefined): string {
  return m ? (METHOD_LABELS[m] ?? m.replace(/_/g, " ")) : "none";
}

/** "a CPI" / "an IIP": acronyms follow the sound of their first letter, words follow vowels. */
export function withArticle(word: string): string {
  const acronym = word === word.toUpperCase();
  const an = acronym ? "AEFHILMNORSX".includes(word[0]) : /^[aeiou]/i.test(word);
  return `${an ? "an" : "a"} ${word}`;
}

// ---------- evidence helpers used by the Intelligence page (deterministic text, no generation) ----------

export interface Statement {
  text: string;
  kind: "observed" | "derived" | "forecast";
}

/** Does `model` beat the naive baseline on MAE in the best comparable group? null if unknown/invalid. */
export function beatsBaseline(c: Comparison | null, model: string): boolean | null {
  const g = c?.groups.find((x) => x.comparable && x.models.some((m) => m.model === model) && x.models.some((m) => m.is_baseline));
  if (!g) return null;
  const m = g.models.find((x) => x.model === model);
  const b = g.models.find((x) => x.is_baseline);
  if (!m || !b || m.metrics.mae === undefined || b.metrics.mae === undefined) return null;
  return m.metrics.mae < b.metrics.mae;
}

/** Compounds a hypothetical constant monthly % change from a starting index. Pure arithmetic. */
export function hypotheticalPath(start: number, monthlyPct: number, months: number): number[] {
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < months; i++) {
    v *= 1 + monthlyPct / 100;
    out.push(v);
  }
  return out;
}
