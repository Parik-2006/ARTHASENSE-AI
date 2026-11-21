/** Forecasts V2 pure logic: reliability assessment, deterministic interpretation, default selection,
 *  and the URL/filter contract shared with Overview and Indicators. No I/O, no generated numbers. */

import { DEFAULT_FILTERS, type FilterState, parseFilters, serializeFilters } from "@/lib/analysis";
import type { Comparison, ForecastRow, IndicatorId, Run } from "@/lib/forecasting";
import { monthLabel } from "@/lib/forecasting";

// ---------- reliability ----------

export type ReliabilityLevel = "insufficient" | "limited" | "concerning" | "supported";

/** Documented thresholds. They are conservative rules of thumb for a short-history research tool,
 *  not statistically validated cut-offs, and the UI says so. */
export const RELIABILITY_RULES = {
  minOrigins: 5, // below this the backend reports no metrics at all
  rankableOrigins: 12, // below this results are "indicative only" (matches the backtest engine)
  coverage80Floor: 0.5, // nominal 0.80: below half is badly under-covering
  coverage95Floor: 0.75, // nominal 0.95
  supportedCoverage80: [0.6, 1.0] as const,
  supportedCoverage95: 0.85,
} as const;

export interface ReliabilityInput {
  nOrigins: number | null;
  mae: number | null;
  /** MAE of the naive baseline on the SAME evaluation set (identical origins), or null if unknown. */
  baselineMae: number | null;
  /** Interval coverage as a fraction 0..1, or null when the model has no intervals (NOT zero). */
  coverage80: number | null;
  coverage95: number | null;
  /** Forecast origin is older than the latest official observation. */
  stale?: boolean;
}

export interface Reliability {
  level: ReliabilityLevel;
  label: string;
  /** Plain-language reasons, each traceable to an input. Never empty. */
  reasons: string[];
}

export const RELIABILITY_LABEL: Record<ReliabilityLevel, string> = {
  insufficient: "Insufficient evidence",
  limited: "Limited evidence",
  concerning: "Concerning historical performance",
  supported: "Supported by available backtests",
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Deterministic, rule-based. Not a probability and not a validated score. */
export function assessReliability(i: ReliabilityInput): Reliability {
  const R = RELIABILITY_RULES;
  const reasons: string[] = [];
  const done = (level: ReliabilityLevel): Reliability => ({ level, label: RELIABILITY_LABEL[level], reasons });

  if (i.nOrigins === null || i.nOrigins < R.minOrigins) {
    reasons.push(
      i.nOrigins === null
        ? "No backtest was stored for this model and horizon."
        : `Only ${i.nOrigins} backtest origin${i.nOrigins === 1 ? "" : "s"}; at least ${R.minOrigins} are needed before any accuracy is reported.`,
    );
    return done("insufficient");
  }

  let concerning = false;
  if (i.baselineMae !== null && i.mae !== null) {
    if (i.mae > i.baselineMae) {
      concerning = true;
      reasons.push(`Its average error (MAE ${i.mae.toFixed(2)}) was larger than the naive baseline's (${i.baselineMae.toFixed(2)}) on the same origins.`);
    } else reasons.push(`Its average error (MAE ${i.mae.toFixed(2)}) was no larger than the naive baseline's (${i.baselineMae.toFixed(2)}).`);
  } else reasons.push("No naive baseline on identical origins is stored, so it cannot be judged against the baseline.");

  if (i.coverage80 === null || i.coverage95 === null) {
    reasons.push("This model supplied no usable prediction intervals, so interval calibration cannot be assessed (this is not zero coverage).");
  } else {
    if (i.coverage80 < R.coverage80Floor) {
      concerning = true;
      reasons.push(`Its 80% intervals contained the actual value only ${pct(i.coverage80)} of the time (nominal 80%).`);
    }
    if (i.coverage95 < R.coverage95Floor) {
      concerning = true;
      reasons.push(`Its 95% intervals contained the actual value only ${pct(i.coverage95)} of the time (nominal 95%).`);
    }
  }
  if (concerning) {
    if (i.nOrigins < R.rankableOrigins) reasons.push(`Based on only ${i.nOrigins} origins, so the result is indicative.`);
    if (i.stale) reasons.push("The stored forecast was issued before the latest official observation.");
    return done("concerning");
  }

  if (i.nOrigins < R.rankableOrigins) {
    reasons.push(`Only ${i.nOrigins} origins (fewer than ${R.rankableOrigins}): results are indicative, not a reliable ranking.`);
    if (i.stale) reasons.push("The stored forecast was issued before the latest official observation.");
    return done("limited");
  }
  const [lo80, hi80] = R.supportedCoverage80;
  const calibrated =
    i.coverage80 !== null && i.coverage95 !== null && i.coverage80 >= lo80 && i.coverage80 <= hi80 && i.coverage95 >= R.supportedCoverage95;
  const beats = i.baselineMae !== null && i.mae !== null && i.mae <= i.baselineMae;
  if (calibrated && beats && !i.stale) {
    reasons.push("Enough origins, no worse than the baseline, and intervals roughly as wide as claimed. Historical performance does not guarantee future accuracy.");
    return done("supported");
  }
  if (i.stale) reasons.push("The stored forecast was issued before the latest official observation.");
  if (!calibrated && i.coverage80 !== null) reasons.push("Interval coverage is not close enough to nominal to call the model well calibrated.");
  return done("limited");
}

/** Reliability for one stored forecast, from its backtest run and the comparison endpoint. The baseline
 *  MAE is taken only from a comparable group that contains BOTH the model and the naive baseline, so
 *  both were scored on identical origins. Missing coverage stays null (never zero). */
export function reliabilityFor(
  backtest: Run | null | undefined,
  comparison: Comparison | null | undefined,
  model: string,
  stale = false,
): Reliability {
  if (!backtest || backtest.status !== "completed" || backtest.kind !== "backtest") {
    return assessReliability({ nOrigins: null, mae: null, baselineMae: null, coverage80: null, coverage95: null, stale });
  }
  const g = comparison?.groups.find((x) => x.comparable && x.models.some((m) => m.model === model) && x.models.some((m) => m.is_baseline));
  const baseline = g?.models.find((m) => m.is_baseline);
  const m = backtest.metrics;
  return assessReliability({
    nOrigins: backtest.n_origins,
    mae: m.mae ?? null,
    baselineMae: baseline && model !== baseline.model ? (baseline.metrics.mae ?? null) : null,
    coverage80: m.coverage_80 ?? null,
    coverage95: m.coverage_95 ?? null,
    stale,
  });
}

// ---------- model-derived changes and interpretation ----------

export interface Change {
  abs: number;
  pct: number | null;
}

/** Change of a forecast index from a reference observation. Null reference or zero => pct unavailable. */
export function changeFrom(reference: number | null, value: number): Change | null {
  if (reference === null || !Number.isFinite(reference)) return null;
  return { abs: value - reference, pct: reference === 0 ? null : (value / reference - 1) * 100 };
}

export const FLAT_THRESHOLD_PCT = 0.25;

export type Direction = "up" | "down" | "flat";
export function directionOf(c: Change | null): Direction | null {
  if (!c || c.pct === null) return null;
  return c.pct > FLAT_THRESHOLD_PCT ? "up" : c.pct < -FLAT_THRESHOLD_PCT ? "down" : "flat";
}

export interface InterpretInput {
  indicator: string; // "WPI"
  modelName: string;
  horizon: number;
  latest: { period: string; value: number } | null;
  /** Stored future forecast rows, steps 1..horizon. */
  rows: ForecastRow[];
  reliability: Reliability;
  /** Final-step point forecast of other stored models for the same origin/horizon (for disagreement). */
  others?: { modelName: string; finalForecast: number; origin: string | null }[];
}

/** Templated statements from stored numbers only. Possibilities, never certainties; no causes. */
export function interpretForecast(i: InterpretInput): string[] {
  const out: string[] = [];
  const last = i.rows[i.rows.length - 1];
  if (!last) return ["No stored forecast rows, so nothing is interpreted."];
  const origin = i.rows[0]?.origin_date ?? null;
  const c = i.latest ? changeFrom(i.latest.value, last.forecast) : null;
  const dir = directionOf(c);
  const where = i.latest ? `the latest observed ${i.latest.value.toFixed(2)} (${monthLabel(i.latest.period, true)})` : "the latest observation";
  if (c && dir) {
    const move =
      dir === "flat"
        ? `broadly unchanged (within ±${FLAT_THRESHOLD_PCT}%)`
        : `${dir === "up" ? "higher" : "lower"} by ${Math.abs(c.abs).toFixed(2)} points (${c.pct!.toFixed(2)}%)`;
    out.push(`${i.modelName} projects the ${i.indicator} index at ${last.forecast.toFixed(2)} in ${monthLabel(last.target_date, true)}, ${move} compared with ${where}. This is a model estimate of the index level, not official inflation or growth.`);
  } else out.push(`${i.modelName} projects the ${i.indicator} index at ${last.forecast.toFixed(2)} in ${monthLabel(last.target_date, true)}; the change cannot be computed without a valid latest observation.`);

  if (origin && i.latest && origin.slice(0, 7) < i.latest.period.slice(0, 7))
    out.push(`This forecast was issued from ${monthLabel(origin, true)}, before the latest observation (${monthLabel(i.latest.period, true)}), so newer official data are not reflected in it.`);

  const first = i.rows[0];
  if (first.lower_80 !== null && last.lower_80 !== null && first.upper_80 !== null && last.upper_80 !== null && i.rows.length > 1) {
    const w1 = first.upper_80 - first.lower_80;
    const wh = last.upper_80 - last.lower_80;
    out.push(`The 80% interval for ${monthLabel(last.target_date, true)} spans ${last.lower_80.toFixed(2)} to ${last.upper_80.toFixed(2)} (width ${wh.toFixed(2)}), ${w1 > 0 ? `${(wh / w1).toFixed(1)}× the one-month width` : "wider than the first month"}; uncertainty grows with the horizon. The actual value can fall outside it.`);
  } else if (first.lower_80 === null) out.push("This model gives no prediction interval here, so the range of possible outcomes is not quantified.");

  out.push(`Reliability: ${i.reliability.label}. ${i.reliability.reasons[0] ?? ""}`.trim());

  const others = (i.others ?? []).filter((o) => o.origin === origin);
  if (others.length && i.latest && i.latest.value !== 0) {
    const all = [last.forecast, ...others.map((o) => o.finalForecast)];
    const spread = ((Math.max(...all) - Math.min(...all)) / Math.abs(i.latest.value)) * 100;
    if (spread > 2) out.push(`Stored models disagree: their ${monthLabel(last.target_date)} forecasts span ${(Math.max(...all) - Math.min(...all)).toFixed(2)} points (${spread.toFixed(1)}% of the latest index), so the direction and size of the move are uncertain.`);
  }
  return out;
}

// ---------- default selection policy ----------

export interface Candidate {
  model: string;
  horizon: number;
  level: ReliabilityLevel;
  mae: number | null;
  createdAt: string;
}

const RANK: Record<ReliabilityLevel, number> = { supported: 3, limited: 2, insufficient: 1, concerning: 0 };

export interface Selection {
  model: string;
  horizon: number;
  reason: string;
}

/** Policy: (1) the user's explicit URL choice if it is a stored forecast; (2) else the longest stored
 *  horizon up to 6 months and, within it, the model with the strongest evidence level, then lowest
 *  backtest MAE at THAT horizon, then newest; (3) else the newest stored forecast. Nothing is generated. */
export function pickDefault(c: Candidate[], want: { model?: string | null; horizon?: number | null } = {}): Selection | null {
  if (!c.length) return null;
  if (want.model) {
    const exact = c.filter((x) => x.model === want.model && (want.horizon ? x.horizon === want.horizon : true));
    const pick = exact[0] ?? c.filter((x) => x.model === want.model).sort((a, b) => b.horizon - a.horizon)[0];
    if (pick) return { model: pick.model, horizon: pick.horizon, reason: "Chosen in the page link." };
  }
  const horizons = [...new Set(c.map((x) => x.horizon))].sort((a, b) => a - b);
  const preferred = want.horizon && horizons.includes(want.horizon) ? want.horizon : (horizons.filter((h) => h <= 6).pop() ?? horizons[0]);
  const pool = c
    .filter((x) => x.horizon === preferred)
    .sort((a, b) => RANK[b.level] - RANK[a.level] || (a.mae ?? Infinity) - (b.mae ?? Infinity) || b.createdAt.localeCompare(a.createdAt));
  const top = pool[0];
  if (!top) {
    const newest = [...c].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return { model: newest.model, horizon: newest.horizon, reason: "Newest stored forecast." };
  }
  return {
    model: top.model,
    horizon: top.horizon,
    reason: `Strongest backtest evidence level (${RELIABILITY_LABEL[top.level].toLowerCase()}), then lowest backtest MAE at the ${top.horizon}-month horizon. This is not a claim that it is best at every horizon.`,
  };
}

// ---------- filters / URL contract ----------

export interface ForecastFilters extends FilterState {
  model: string | null;
  horizon: number | null;
}

export const DEFAULT_FORECAST_FILTERS: ForecastFilters = { ...DEFAULT_FILTERS, model: null, horizon: null };

export interface Availability {
  models: string[]; // ids with a stored future forecast
  horizons: number[]; // horizons with a stored future forecast
  /** Horizons stored per model, to test combinations. */
  byModel?: Record<string, number[]>;
}

/** Reads ?range=&from=&to=&model=&horizon= . Invalid or unavailable values are dropped and REPORTED. */
export function parseForecastFilters(get: (k: string) => string | null, avail: Availability): { filters: ForecastFilters; notices: string[] } {
  const base = parseFilters(get, ["index"]);
  const notices: string[] = [];
  const rawRange = get("range");
  if (rawRange === "Custom" && base.range !== "Custom") notices.push("The custom date range in the link was incomplete, so all available history is shown.");
  const rawModel = get("model");
  const rawH = get("horizon");
  let model: string | null = null;
  let horizon: number | null = null;
  if (rawModel) {
    if (avail.models.includes(rawModel)) model = rawModel;
    else notices.push(`No stored forecast exists for model "${rawModel}", so the default model is shown.`);
  }
  if (rawH) {
    const h = Number(rawH);
    const allowed = model && avail.byModel?.[model] ? avail.byModel[model] : avail.horizons;
    if (Number.isInteger(h) && allowed.includes(h)) horizon = h;
    else
      notices.push(
        model && Number.isInteger(h) && avail.horizons.includes(h)
          ? `Model "${model}" has no stored ${h}-month forecast; showing the horizons it has.`
          : `No stored forecast exists for a ${rawH}-month horizon, so the default horizon is shown.`,
      );
  }
  return { filters: { ...base, model, horizon }, notices };
}

export function serializeForecastFilters(f: ForecastFilters): URLSearchParams {
  const p = serializeFilters(f);
  p.delete("metric"); // the forecast explorer plots index levels; metric is not interpreted here
  if (f.model) p.set("model", f.model);
  if (f.horizon) p.set("horizon", String(f.horizon));
  return p;
}

/** Only the historical-window parts that Indicators pages interpret (never model/horizon). */
export function toIndicatorQuery(f: Pick<FilterState, "range" | "custom" | "metric">): string {
  const q = serializeFilters({ range: f.range, custom: f.custom, metric: f.metric }).toString();
  return q ? `?${q}` : "";
}

/** Only the historical-window parts that Forecast pages interpret (never metric). */
export function toForecastQuery(f: Pick<FilterState, "range" | "custom"> & Partial<Pick<ForecastFilters, "model" | "horizon">>): string {
  const p = serializeForecastFilters({ ...DEFAULT_FORECAST_FILTERS, range: f.range, custom: f.custom, model: f.model ?? null, horizon: f.horizon ?? null });
  const q = p.toString();
  return q ? `?${q}` : "";
}

export const indicatorPath = (id: IndicatorId) => `/indicators/${id}`;
export const forecastPath = (id: IndicatorId) => `/forecasting/${id}`;

// ---------- CSV with provenance ----------

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ""; // not recorded / missing stays empty, never 0
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ForecastCsvMeta {
  indicator: string;
  baseYear: string | null;
  seriesId: string | null;
  publisher: string | null;
  modelId: string;
  modelName: string;
  run: Run;
  latest: { period: string; value: number } | null;
  reliability: string;
}

export function forecastsToCsvV2(rows: ForecastRow[], m: ForecastCsvMeta): string {
  const head = [
    "indicator", "classification", "target_month", "forecast_index", "change_from_latest_observed", "change_from_latest_observed_pct_model_derived",
    "lower_80", "upper_80", "lower_95", "upper_95", "interval_method", "forecast_origin", "latest_observed_month", "latest_observed_index",
    "horizon_months", "model_id", "model_name", "run_id", "training_start", "training_cutoff", "dataset_fingerprint", "stored_at",
    "base_year", "training_series_id", "training_data_publisher", "reliability_assessment",
  ]; // prettier-ignore
  const lines = rows.map((r) => {
    const c = m.latest ? changeFrom(m.latest.value, r.forecast) : null;
    return [
      m.indicator, "model_forecast_not_official", r.target_date, r.forecast, c ? c.abs.toFixed(4) : null, c?.pct == null ? null : c.pct.toFixed(4),
      r.lower_80, r.upper_80, r.lower_95, r.upper_95, r.interval_method, r.origin_date, m.latest?.period ?? null, m.latest?.value ?? null,
      m.run.horizon, m.modelId, m.modelName, m.run.id, m.run.training_start, m.run.training_cutoff, m.run.dataset_fingerprint, m.run.created_at,
      m.baseYear, m.seriesId, m.publisher, m.reliability,
    ]
      .map(csvCell)
      .join(",");
  }); // prettier-ignore
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
