# Forecasts V2 — implementation and audit notes (branch `parik3`)

Baseline: `c2be85e` (Overview V2 + Indicators V2, already identical on `main`, `parik`, `parik2`).

## What changed
- **Forecasts overview** ("India's Economic Outlook"): one card per indicator (latest official value, model, origin,
  horizon, target, forecast index, model-derived change, 80/95% intervals, mini chart, reliability, source),
  explicit states (available / stale / no stored forecast / history insufficient / no data / backend unavailable),
  a deterministic outlook summary, a reliability overview, a collapsed model inventory, latest experiments, a tour.
- **Forecast explorer** (CPI/WPI/IIP): history window (3M–5Y/All/Custom), model and horizon, all in the URL
  (`?range=&from=&to=&model=&horizon=`), Reset filters, reliability banner with reasons, rule-based interpretation,
  forecast table with change-from-latest, CSV with provenance, separate attribution for official history and
  model forecast, links to the matching Indicators page. Changing the history window never changes the horizon.
- **Model comparison**: indicator, horizon and evaluation set in the URL; reset; explanation of the naive baseline.
- **Experiments**: filters (indicator, model, status, type, horizon, min origins, run-id/model search), sorting,
  pagination, all in the URL; CSV of all filtered runs; skipped/failed runs stay visible.
- **Navigation**: Indicators page -> its forecast (window only); forecast -> Indicators (window only); model/horizon
  are never sent to Indicators, metric is never sent to Forecasts.
- **Shared**: tours (`FORECAST_*`, `COMPARISON_TOUR`, `EXPERIMENTS_TOUR`), 12 new ArthaGuide entries, existing
  `SourceAttribution` (class `forecast`), `FilterBar` reused for the history window.

## Reliability method (`lib/forecast-v2.ts`, not a validated score)
Categories: insufficient evidence / limited evidence / concerning performance / supported by available backtests.
- < 5 origins or no backtest -> insufficient.
- Concerning if MAE > naive-baseline MAE on identical origins (comparable group only), or 80% coverage < 50%, or
  95% coverage < 75%.
- < 12 origins can never be "supported". Supported needs >= 12 origins, MAE <= baseline, 80% coverage in
  [60%, 100%], 95% coverage >= 85%, and a non-stale forecast.
- Missing intervals are `null` (never zero) and cap the level at "limited". Narrow intervals are not rewarded.
Default selection: URL choice, else strongest evidence level at the longest stored horizon <= 6 (then lowest MAE at
that horizon, then newest). It is not a claim of best-at-every-horizon and nothing is generated.

## Quantitative audit: WPI h=6 (replayed in memory against the local DB; nothing written)
Reproduced exactly: ARIMA(1,1,0) h=6, 7 origins, MAE 13.165, MASE 33.11, 80%/95% coverage 0%.
- **Alignment/leakage: ruled out.** Origin Oct 2025 -> target Apr 2026 (+6 months); each origin sees only earlier data;
  the MASE scale is the training window only.
- **Cause 1 (data):** WPI sat at 99–102 for three years, then jumped 104.6 -> 108.9 (Mar -> Apr 2026) and kept rising.
  No model trained on the flat history anticipates that; the naive baseline also scores MAE 7.53, 0% coverage.
- **Cause 2 (intervals):** native model intervals come from the tiny flat-history variance, so they miss the shift.
- **Cause 3 (model specification, real weakness):** `SARIMA` is fitted with `enforce_stationarity=False`. At the
  Apr 2026 origin the AR coefficient is 1.201 (explosive) and the 6-month forecast is 160.4 vs actual 113.3; that one
  origin contributes ~47 of the 92 total absolute error. Scores are computed correctly; the fit is unstable.
- **Action taken:** the fit now RECORDS `explosive_ar` / `ar_min_root_modulus` (and the run summary counts
  `explosive_ar_origins`). No score, model configuration or stored run was changed. Enforcing stationarity would
  change the model and requires a deliberate local re-run; **stored WPI ARIMA/SARIMA h>=3 scores may be affected by
  the explosive origin and are candidates for recomputation (not done).**
- Tests: `pipeline/tests/test_regime_shift.py`.

## IIP
The explorer uses the NEWEST stored completed backtest per model and horizon (same policy as the existing Overview). Locally that run for IIP ETS h=6 has 6 origins (older runs of the same model have up to 19), so reliability is "limited"; which run is the right evidence is a data-governance question left open. IIP is not seasonally adjusted;
the explorer says whether the selected model has a yearly seasonal component (only SARIMA/seasonal naive do).

## CPI
Local CPI Current has 22 months (< 18 training + 5 origins), so no horizon is evaluable; the Back series is a
separate segment and is never spliced. The card and page say this; no forecast is shown. No CPI model was trained.

## Not done / remaining
- No model overlay chart or multi-model forecast overlay (only a disagreement statement).
- No actual-vs-predicted backtest chart, error-by-horizon, or runtime-vs-accuracy charts: only aggregate scores are
  stored, not per-origin points exposed by the API.
- Comparison page lacks min-origins/model-type filters and a "has stored future forecast" column.
- No paired statistical test (insufficient paired observations).
- Experiment detail page was not redesigned (existing run detail kept).
- Image export of charts, legend toggles and chart zoom were not added.
- `lib/overview.ts` and `lib/analysis.ts` still duplicate range helpers.
- Production data differs from local; nothing here touched Supabase.
