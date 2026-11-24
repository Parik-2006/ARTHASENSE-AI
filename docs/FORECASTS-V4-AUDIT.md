# Forecasts V4: audit (before implementation)

Date: 2026-11-24. Repository `main` = `873d704`. Production verified read-only, then backed up
(`arthasense-prod-20261124T085029Z.dump`, sha256 recorded alongside) and test-restored into isolated PostgreSQL 17: all
table fingerprints identical to the 2026-11-23 backup.

## 1. Production baseline

| Table | Rows |
|---|---|
| observations | 3,429 |
| series | 50 |
| releases | 126 |
| forecast_runs | 204 |
| forecasts | 1,639 |
| scores | 934 |
| linking_factors | 0 |

Migrations applied: 0000–0004. No migration is needed for V4 (all new provenance fits in `forecast_runs.configuration`
JSONB; `series.frequency` already allows `quarterly`; `forecast_runs.status` already allows `failed`).

## 2. Historical coverage per indicator

| Indicator | Current series | Older official data stored | Used for V1–V3 training |
|---|---|---|---|
| CPI | 2024=100, Jan 2025 – Oct 2026 (22) | MoSPI Back series on 2024=100, Jan 2013 – Dec 2024 (144); 2012-base series (156) | Back + Current (166 months, since 2026-11-23) |
| WPI | 2022-23, Apr 2023 – Oct 2026 (43) | 2011-12 (169, to Apr 2026), 2004-05 (147), 1993-94 (197) | current only (43) |
| IIP | 2022-23, Apr 2023 – Sep 2026 (42) | 2011-12 General (159, to Mar 2026), 2004-05 (144), 1993-94 (207) | current only (42) |
| GDP | real level 2022-23, Q1 FY22-23 – Q1 FY26-27 (17 quarters); official YoY (13) | none on a compatible base | not forecast |

No gaps or duplicate periods in any of these series.

## 3. Models (before V4)

| Model | Implemented | Stored runs (prod) | Future forecast stored | Visible in Forecasts UI |
|---|---|---|---|---|
| Naive, Drift, ETS (damped, fixed), ARIMA(1,1,0) | yes | yes | yes (h = 6) | yes |
| Seasonal naive | yes (m = 12 only) | backtests | no | comparison only |
| SARIMA(1,1,0)(0,1,0)12 (fixed) | yes | backtests (≤ 7 origins) | no | comparison only |
| XGBoost (recursive, lags 1,2,3,6) | yes, no intervals | backtests | no | comparison only |
| **Random Forest** | **missing** | — | — | — |
| Chronos-2, TimesFM 2.5 | optional, not installed | skipped | no | inventory only |

* Every model, loader and validator was **monthly-only** (`validate_history` rejected quarterly steps; the loader read
  quarterly data as two missing months per quarter).
* Fixed model orders; no automated selection. The catalogue hard-coded "ARIMA(1,1,0)" etc.; runs carried no label.
* The Outlook cards showed the estimate without naming the model.
* Selector: only models with a stored future forecast (4 of 8) were offered; the other four were silently absent.

## 4. Evaluation methodology found (kept)

Rolling-origin, expanding-window backtests; a fresh model per origin; native intervals or leakage-free online conformal
intervals; MAE, RMSE, MASE, sMAPE, bias, 80/95% coverage and width; ≥ 5 origins to report, ≥ 12 to rank; comparisons only
within identical (data fingerprint, origins fingerprint) groups; reliability from one evaluation set (V3).

Two integrity gaps fixed in V4:
1. A model that raised at some origins got a different `origins_fingerprint` and silently left the comparison group.
   V4 records it as `failed` (UI: "Training failed").
2. Future-forecast horizons could be justified with an origin set that no stored backtest used. V4 validates each
   future horizon against the suite that actually evaluated the model.

## 5. Findings that shaped V4

* WPI: weak reliability came from a 43-month history and intervals too narrow for the genuine April 2026 shock; an
  official OEA back-casting method exists (`docs/FORECASTS-V4-WPI-HISTORY.md`). IIP: the NSO publishes the same kind of
  factor.
* GDP: 17 quarters support only baselines and (at 1 quarter) ETS/ARIMA; ML and SARIMA are honestly unavailable
  (`docs/FORECASTS-V4-GDP.md`).
