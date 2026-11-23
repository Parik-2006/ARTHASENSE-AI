# Forecasting verification report (Forecasts V3, Phase 1)

Date: 2026-11-23 · Branch `feature/forecasts-v3` (from `7fa0b92`) · Audit is read-only.

Method: I read the code, ran SQL against the **local** PostgreSQL (`arthasense`) and refit **every stored run in
memory** with the pinned stack (Python 3.12.4, statsmodels 0.15.0, numpy 2.5.5, pandas 3.1.1). The DB session was
forced read-only (`default_transaction_read_only=on`). I did not retrain or store anything, did not install packages,
and did not touch production. Per `reports/production-import-verification.json`, production holds the same
176 `forecast_runs` (marked "unchanged" by the data import).

## Verdicts

| # | Question | Verdict | Evidence |
|---|---|---|---|
| 1 | Are Naive, Drift, ETS, ARIMA (and the others) really fitted on real observations? | **VERIFIED** | `pipeline/forecasting/baselines.py` (closed-form Naive / SNaive / Drift); `statistical.py` (`ETSModel(error="add", trend="add", damped_trend=True)`, `SARIMAX` for ARIMA(1,1,0) and SARIMA(1,1,0)(0,1,0)12); `ml.py` (XGBoost on lagged changes). Inputs come from `experiments.load_indicator` → `research.loader.load_series(require_complete=True)`, which reads `observations` and refuses gaps. |
| 2 | Where does fitting happen? | **VERIFIED** | Offline only: `python -m pipeline.forecasting.cli suite …` → `experiments.suite_records` → `backtesting.run_backtest` (a fresh `registry.build()` per origin; `model.fit(train_y).predict(max_h)`) and `experiments.forecast_record` (one fit on the full history). Storage: `persistence.store_run`. The API (`services/api/app/forecasting.py`) is read-only and never trains. |
| 3 | Are any displayed values hardcoded, mocked or placeholders? | **VERIFIED genuine** | All **120/120** WPI and IIP runs (90 completed, 30 skipped) re-derived to the same deterministic `experiment_id`. Every stored forecast value and interval bound was reproduced, max abs difference **5.1e-13**, and every stored metric was reproduced exactly (max diff **0.0**). Fixtures (`lib/forecasting-fixtures.ts`) are used only in tests. Chronos-2 and TimesFM rows are `skipped` with 0 origins and no numbers. |
| 4 | How are runs, forecasts, windows and metrics stored? | **VERIFIED** | Migration `0002_forecasting.sql`: `forecast_runs` (model, config JSON, seed, horizon, `training_start`, `training_cutoff`, `dataset_fingerprint`, `origins_fingerprint`, `snapshot_policy`, suite, status/error), `forecasts` (origin, target, step, point, actual, 80/95 bounds, interval method), `scores` (metric, value, n, evaluation window, note). Runs are idempotent by `experiment_id` and never overwritten. |
| 5 | Are rolling-origin backtests free of future-data leakage? | **VERIFIED** | Code: the model sees only `y[lo:i]` and a new instance is built per origin (`backtesting.py`). The MASE scale uses the training window only. Conformal intervals calibrate only on errors whose target is before the origin (`intervals.online_conformal`). SQL over all 1,147 backtest rows: **0** with target ≤ origin, **0** where target ≠ origin + step months, **0** future rows with target ≤ training cutoff. All 1,147 stored `actual_value`s equal the stored official observation. |
| 6 | Are prediction intervals model-specific and valid? | **VERIFIED (with minor notes)** | Naive / SNaive / Drift use the textbook Gaussian formulas with σ from the training window. ETS and ARIMA use statsmodels state-space intervals. XGBoost uses leakage-free online conformal intervals (95% is unavailable until there are 19 calibration errors, and it is reported as missing, not zero). All stored 80% intervals sit inside the 95% intervals and contain the point. *Minor:* Naive σ is the demeaned SD of first differences (`np.std(ddof=1)`). FPP uses the RMS of the naive residuals. On a trending series the demeaned SD is a little smaller, so intervals are slightly narrower. Drift uses `h/(T-1)` where FPP writes `h/T`. Neither was changed. |
| 7 | Can a stored forecast be reproduced from config, data and cutoff? | **VERIFIED for WPI/IIP; PARTIALLY for CPI** | WPI/IIP: the fingerprints still match today's data, and the refit reproduces every number (see #3). CPI: the 56 stored runs have fingerprint `2441fca38375ad66` (cutoff 2025-12, 12 months). Ten more months were stored on 2026-11-21, so they reproduce only with `as_of` = creation time. They were all `skipped`, so no CPI number is affected. Gaps: library versions are not stored per run, and `snapshot_policy=latest` means backtests use final revised data (not real-time vintages). |
| 8 | Are official values and forecasts clearly separated? | **VERIFIED** | Separate tables (`observations` vs `forecasts`). The API labels forecast rows as genuine future or backtest. The UI uses separate source attribution classes (`official` vs `forecast`). CSV rows are tagged `model_forecast_not_official`. |
| 9 | Why is CPI unavailable? | **VERIFIED** | The CPI 2024-base Current series has **22** months locally (Jan 2025–Oct 2026; 12 in the prod-like replica). Evaluating a horizon needs 18 training months + 5 origins + (h−1): **23 for h=1**, 25 for h=3, 28 for h=6. `forecast_record` correctly refuses (largest evaluable horizon = 0). Back / 2012 series are never spliced (`experiments.INDICATORS` trains only on the Current code). |
| 10 | Is the default model selection defensible? | **ISSUE FOUND (fixed in the UI, see below)** | The backend comparison is sound: it groups runs only by identical `dataset_fingerprint` + `origins_fingerprint`. The **frontend** mixed evaluation sets, though. |

## ISSUE FOUND: reliability and default choice compared different evaluation sets

`lib/forecast-v2.ts › reliabilityFor` and the candidate builder in `forecast-explorer.tsx` / `forecast-pages.tsx › summarize`:

- **Model MAE and coverage** came from `runs.find(...)`, the *newest* completed backtest. Because suites run in the
  order core → ml → seasonal, that is the `ml` suite (6–7 origins).
- **Baseline MAE** came from the first comparison group, the `core` suite (19–20 origins).
- The banner text said "…than the naive baseline's … **on the same origins**", which was false. Example: WPI ETS
  h=6 showed MAE 7.871 (7 origins) against naive 3.540 (20 origins). On identical origins the figures are
  3.744 vs 3.540 (core) or 7.871 vs 7.529 (ml).
- `pickDefault`'s MAE tie-break also compared models scored on different origins.

**Fix (display logic only, no stored number changed):** `lib/forecast-evidence.ts` takes the model's MAE, coverage
and origin count **and** the baseline from **one** comparison group. That group has identical data and origins, and is the
largest group that contains the naive baseline. All candidates at a horizon are ranked on that same group. If any
*other* matched group shows concerning performance, that result is never hidden: it is listed as a caveat and caps
the level below "supported". The old helpers in `forecast-v2.ts` stay unchanged because Indicators imports that file.

Before/after for the stored 6-month future forecasts (local DB):

| Indicator · model | Before (mixed sets) | After (core set, identical origins) |
|---|---|---|
| WPI · Naive | Concerning (7 origins) | Concerning (20 origins; 80% coverage 35%) |
| WPI · Drift | Concerning | Concerning (MAE 3.39 ≤ 3.54, but 80% coverage 40%) |
| WPI · ETS | Concerning (7.87 vs 3.54) | Concerning (3.74 vs 3.54) |
| WPI · ARIMA | Concerning (13.17 vs 3.54) | Concerning (5.52 vs 3.54) |
| **WPI default** | Drift | Drift (unchanged) |
| IIP · Naive | Limited (6 origins) | Limited (baseline itself, 19 origins) |
| IIP · Drift | Concerning | Concerning (5.76 vs 5.40) |
| IIP · ETS | Limited (6 origins) | Limited (80% coverage 58% < 60%) |
| IIP · ARIMA | Limited (6 origins) | **Supported** (19 origins, 5.05 vs 5.40, coverage 84%/89%) |
| **IIP default** | ETS | **ARIMA** |

"Supported" means only that ARIMA passed the documented rules of thumb on 19 backtest origins. It is not a
significance test and not a guarantee.

## Other findings (not changed)

- **WPI regime shift:** WPI jumped 104.6 → 108.9 (Mar → Apr 2026). Every WPI model under-covers at h ≥ 3, and that
  stays visible. Stored ARIMA/SARIMA runs predate the `explosive_ar` diagnostic (documented in `FORECASTS-V2.md`). A
  recompute is a candidate, not done.
- **MASE at h > 1** is scaled by *one-step* naive changes, so values far above 1 at h = 6 do not by themselves mean
  "worse than naive". The UI compares against the naive baseline directly.
- **Future horizons:** only 6-step future runs are stored. For these one-shot fits, steps 1..k of that run are
  exactly the k-step forecast (the API's `/forecasts/latest` already serves them this way). The UI now offers 1, 3 and
  6 months, labels them "steps 1–k of stored run #N", and uses evidence from the matching-horizon backtest.
- `comparison-view.tsx` hardcoded "CPI Current has only 12 monthly observations". The count now comes from the API.
- No paired significance test (e.g. Diebold–Mariano) exists, so no winner is ever claimed as significant.

## Reproduction

`tools/forecast_reproduce.py` (read-only): loads each indicator, recomputes all suites and the future forecasts,
and matches each by `experiment_id`. Result: WPI 60/60 and IIP 60/60 matched with 0 metric or row differences. CPI 0/56
matched, explained by the vintage change above.
