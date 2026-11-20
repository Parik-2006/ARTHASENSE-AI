/** Test-only builders for forecasting API shapes. Not real data. */
import type { ForecastRow, Run } from "@/lib/forecasting";

export const run = (over: Partial<Run> = {}): Run => ({
  id: 1, experiment_id: "abc", indicator: "wpi", model: "ets", model_name: "ETS (damped trend)", kind: "backtest",
  status: "completed", error: null, horizon: 3, suite: "core", n_origins: 23, training_start: "2023-04-01",
  training_cutoff: "2026-07-01", dataset_fingerprint: "d", origins_fingerprint: "o", snapshot_policy: "latest",
  random_seed: 0, runtime_seconds: 1.5, created_at: "2026-11-20T10:00:00Z", evaluation_start: "2024-10-01",
  evaluation_end: "2026-10-01", metrics: { mae: 2.2, rmse: 3.3, mase: 6.0, smape: 2.1 }, ...over,
}); // prettier-ignore

export const fc = (target: string, f: number, step: number, lo: number | null = null): ForecastRow => ({
  origin_date: "2026-10-01", target_date: target, step, forecast: f, actual: null,
  lower_80: lo, upper_80: lo === null ? null : f + (f - lo), lower_95: null, upper_95: null,
  interval_method: lo === null ? null : "ets_state_space",
}); // prettier-ignore

