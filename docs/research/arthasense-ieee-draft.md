# ArthaSense AI: A Reproducible Framework for Indian Economic Indicator Forecasting Using Statistical, Machine Learning and Foundation Models

> **STATUS: WORKING DRAFT, NOT SUBMISSION-READY.** All numbers below are copied from experiments
> that were actually run (see `generated/` and the reproduction commands). References are
> **placeholders that still have to be verified**; no citation in this file has been checked.
> Sections marked *PENDING* depend on experiments that have not been run. Nothing here has been
> peer reviewed, submitted, or accepted anywhere. Provisional title.

**Authors:** *[to be filled in]*  **Affiliation:** *[to be filled in]*

## Abstract

Official Indian price and production statistics are published monthly, but the history available on
current base years is short. We describe ArthaSense AI, an open, zero-cost pipeline that ingests
official MoSPI series (CPI, WPI, IIP), stores them with retrieval provenance, and evaluates
forecasting models by rolling-origin backtesting with leakage tests. On 43 months of headline WPI
and 42 months of headline IIP (both base 2022-23) we compare naive, seasonal-naive, drift, ETS,
ARIMA, SARIMA and XGBoost forecasters at 1, 3, 6 and 12 months ahead. Within these small samples:
for WPI, which rose sharply in 2026, trend-following baselines (drift, naive) had the lowest errors
at 1 to 6 months and no model was clearly better; for IIP, damped-trend ETS had the lowest error at 1,
3 and 6 months in the main suite (MAE 3.51, 3.92 and 4.37 index points against 5.04, 5.13 and 5.40
for the naive forecast), while at 12 months the drift baseline was lowest. Seasonal naive was worst
for WPI. Prediction intervals from simple models under-covered their nominal level on trending WPI.
CPI (12 months on the current base) is too short to evaluate. The foundation models Chronos-2 and
TimesFM 2.5 were checked for feasibility but **not evaluated**. The results are indicative because
the evaluation samples are small; we make no claim of statistical significance.

**Keywords:** economic forecasting, inflation, industrial production, rolling-origin evaluation,
reproducibility, prediction intervals, India.

## 1. Introduction

Short, revised and base-year-sensitive monthly series make it easy to overstate forecasting accuracy.
ArthaSense AI is built around the opposite stance: every forecast is tied to a stored data snapshot,
evaluated only on information available at its origin, compared against a naive baseline on identical
origins, and shown with its sample size. Contributions (all implemented and tested in the repository):

1. An ingestion pipeline with release-aware storage (content-hashed retrieval snapshots).
2. A forecasting engine with a single model interface and explicit eligibility rules.
3. Rolling-origin backtesting with mandatory leakage tests (mutation of future data, training-only
   scaling, aligned targets, reproducibility).
4. Honest uncertainty reporting: empirical coverage is measured against nominal levels.
5. A transparent dashboard that refuses to display forecasts that were not backtested.

## 2. Related Work

*PENDING: literature to be collected and verified.* Placeholders (not citations):
[REF-1: forecasting methodology textbook, naive/seasonal-naive/drift/ETS/ARIMA definitions],
[REF-2: scaled error measures (MASE)], [REF-3: conformal prediction for time series],
[REF-4: gradient-boosted trees], [REF-5: Chronos / Chronos-2 foundation models],
[REF-6: TimesFM], [REF-7: inflation-forecasting benchmarks, India-specific work], [REF-8: rolling-origin
evaluation]. Each must be located, read and cited with verified authors, year and DOI before submission.

## 3. Problem Statement

Forecast the **index level** of three monthly indicators and quantify the uncertainty, using only data
published when each forecast is made. Index levels are forecast, not official inflation or growth rates;
rates derived from forecasts are labelled as derived.

## 4. Data Sources and Dataset Construction

All data come from the public MoSPI eSankhyiki API (`api.mospi.gov.in`). WPI is compiled by the Office
of the Economic Adviser (DPIIT) and served through the same API. Table 1 is generated from the database
(`generated/table1_dataset_coverage.md`).

| Indicator | Base year | Months | Coverage | Notes |
|---|---|---|---|---|
| CPI (All India, Combined, General) | 2024 | 12 | Jan to Dec 2025 | official inflation not supplied for this series |
| WPI (all commodities, headline) | 2022-23 | 43 | Apr 2023 to Oct 2026 | index only; no inflation, no provisional/final flag |
| IIP (General) | 2022-23 | 42 | Apr 2023 to Sep 2026 | official growth is stored separately |

Retrieval timestamps are download times (2026-11-20); the API supplies no publication dates and no
revision flags, so revisions cannot be studied. Early IIP `growth_rate` values (Apr 2023 to Mar 2024)
equal index minus 100 rather than year-on-year change and were withheld from storage. Series on different
base years are never merged; the CPI back series (2013 to 2024, same 2024 base) exists officially but its
join to the current series is not verified seamless (2024 Back mean 100.56; Dec 2024 to Jan 2025 step
-1.20%) and it is not used in any result here.

## 5. System Architecture

PostgreSQL stores sources, series, releases (content-hashed retrieval snapshots) and observations; a
forecasting layer stores runs, per-origin forecasts and scores (migration `0002_forecasting.sql`); a read-only
FastAPI service exposes stored results; a Next.js dashboard displays them. Forecasting runs offline and
the API never trains a model. A run is one (model, series, horizon) with a deterministic experiment id
derived from the data fingerprint and configuration, so re-running never overwrites a result.

## 6. Forecasting Methodology

Models (all implemented; configuration in `generated/table2_model_configurations.md`):

* **Naive**: f(T+h) = y(T). **Seasonal naive**: value from the same month a year earlier. **Drift**: line
  between the first and last training observation. Intervals: Gaussian random-walk / drift formulas with the
  spread estimated on the training window.
* **ETS(A,Ad,N)**: additive error, damped additive trend, state-space intervals (statsmodels 0.15.0).
* **ARIMA(1,1,0)** and **SARIMA(1,1,0)(0,1,0)12** via SARIMAX; fixed orders, no search; optimiser warnings are
  recorded. SARIMA needs at least 36 training months.
* **XGBoost** (3.4.1, native API): target is the next monthly *change*; features are lags 1, 2, 3, 6 of the
  changes and the mean and standard deviation of the last three changes; recursive multi-step forecasting
  from predicted changes only; 100 trees, depth 2, learning rate 0.05, fixed seed, one thread. Needs at
  least 31 training months (24 training rows). No hyperparameter search was run.
* **Chronos-2 and TimesFM 2.5**: lazy adapters that report "unavailable". Verified metadata only
  (Hugging Face API): both Apache-2.0; about 120 million and 231 million parameters; both need PyTorch and a
  download of roughly 0.5 to 1 GB. **Not downloaded, not run, not evaluated.** The inference code in the
  adapters follows the published quick-starts but is untested.

Eligibility is rule-based (documented in `pipeline/forecasting/`): a global minimum of 12 months of training;
per-model minimum history; at least 5 usable origins to report any metric; fewer than 12 origins is flagged
"indicative, not rankable".

## 7. Experimental Setup

Expanding-window rolling-origin backtests, step 1. At origin i a fresh model instance sees only the first i
observations and predicts steps 1 to 12; each h-step prediction is compared with the observation h months
later. Three suites per indicator, each with one shared initial window so that all its models are evaluated
on identical origins: **core** (naive, seasonal naive, drift, ETS, ARIMA; 18 months), **ml** (adds XGBoost;
31 months) and **seasonal** (adds SARIMA; 36 months). Metrics: MAE, RMSE, bias (index points), sMAPE (%),
and MASE scaled by the training-window mean absolute one-step change. Intervals at 80% and 95%: the model's
own where it has one, otherwise online split-conformal built only from errors already realised at the origin
(95% needs at least 19 such errors). Empirical coverage is reported only when at least 5 intervals exist; the number of intervals behind each coverage figure is given separately from the number of origins (Table 5), because early conformal origins have no calibration errors. Leakage tests (all passing): rewriting every observation from the origin
onward leaves earlier forecasts bit-identical for naive, seasonal naive, drift, ETS, ARIMA and XGBoost;
rolling features never read future changes; training-only MASE scale; target alignment; seeded
reproducibility. The full set of 176 runs (including skipped ones) took about 13 seconds on a laptop CPU.

## 8. Results

All values below are quoted from `generated/table3_forecast_errors.md`, `table4_mase_by_horizon.md` and
`table5_interval_coverage.md`. MAE is in index points. n is the number of forecast origins.

**WPI, core suite (initial window 18 months).**

| h | n | Naive | Seasonal naive | Drift | ETS | ARIMA |
|---|---|---|---|---|---|---|
| 1 | 25 | 0.676 | 3.780 | **0.637** | 1.136 | 0.691 |
| 3 | 23 | 1.800 | 3.935 | **1.636** | 2.206 | 2.370 |
| 6 | 20 | 3.540 | 4.245 | **3.387** | 3.744 | 5.523 |
| 12 | 14 | 5.836 | 5.836 | 5.739 | **5.381** | 5.943 |

**IIP, core suite (initial window 18 months).**

| h | n | Naive | Seasonal naive | Drift | ETS | ARIMA |
|---|---|---|---|---|---|---|
| 1 | 24 | 5.037 | 5.908 | 5.033 | **3.514** | 4.138 |
| 3 | 22 | 5.132 | 5.900 | 4.956 | **3.915** | 4.410 |
| 6 | 19 | 5.395 | 5.942 | 5.755 | **4.366** | 5.050 |
| 12 | 13 | 6.415 | 6.415 | **3.223** | 4.542 | 6.479 |

Bold marks the lowest MAE in the row. Seasonal naive equals naive at h = 12 by construction.

**ml suite (initial window 31 months).** WPI h = 1 (12 origins): naive 1.083, ARIMA 1.133, XGBoost 1.254,
ETS 1.556, seasonal naive 6.692. IIP h = 1 (11 origins, indicative): ETS 3.582, XGBoost 4.120, ARIMA 4.336,
naive 4.718, seasonal naive 6.882. XGBoost therefore did not beat the naive forecast on WPI at one month,
beat it on IIP at one month but not ETS, and was worse than naive at six months on IIP (7.199 against 4.833,
6 origins). **seasonal suite (36 months, 5 to 7 origins, all indicative):** SARIMA had the lowest IIP MAE at
h = 1 (1.455 against ETS 2.191 and naive 3.767, 6 origins) and was close to naive on WPI (1.357 against
1.329, 7 origins). We do not draw conclusions from 6 to 7 origins.

**Interval coverage (nominal 80%, h = 1, core suite).** WPI: naive 0.68, drift 0.64, ARIMA 0.64, ETS 0.32,
seasonal naive 0.36. IIP: naive 0.75, ARIMA 0.75, drift 0.75, ETS 0.67, seasonal naive 0.04. Under-coverage
on WPI is consistent with a series that trended and then jumped during the evaluation window. At h = 3 the IIP
naive intervals covered every case (1.00), i.e. they were wide. XGBoost uses conformal intervals only: its 80% coverage is reported at h = 1 on 7 (IIP, 1.00) and 8 (WPI, 0.75) intervals, and is unavailable at
h = 3 and 6 (fewer than 5 calibrated intervals); no 95% conformal coverage could be computed.

**CPI.** Not evaluated: 12 observations leave no valid evaluation origin under the stated rules.
**Foundation models.** Not evaluated.

## 9. Discussion

The main empirical pattern is cautionary rather than a model ranking. WPI rose about 12% year on year to
October 2026, a regime that no simple model anticipated, so persistence-type baselines were hard to beat and
ETS, which damps its trend, lagged. IIP has strong month-to-month noise and a recurring pattern; smoothing
(ETS) and ARIMA helped at 1 to 6 months in the main suite, while the 12-month result favouring drift rests on
13 origins and a single regime. Seasonal naive performs badly when growth is non-zero, since it repeats last
year's level. With 3 to 4 years of data a model's "win" can be an artefact of the few months evaluated, so
differences are reported without significance tests. The XGBoost result illustrates the data-size problem:
31 months give about 24 training rows.

## 10. Limitations

* Very short histories (12, 43 and 42 months); base-year transitions prevent longer series.
* No publication dates, no vintages: revisions and real-time evaluation are not studied.
* Small evaluation samples; no Diebold-Mariano or other significance tests (PENDING).
* Simple fixed model orders; no tuned hyperparameters; no exogenous variables.
* Intervals under-cover for several models; conformal calibration needs more history.
* Chronos-2 and TimesFM 2.5 not evaluated; their adapters' inference path is untested.
* CPI back-series evaluation under a documented linking policy is PENDING.
* Dashboard checked through HTTP and automated tests; browser visual checks are PENDING.

## 11. Conclusion

A leakage-tested, reproducible framework for short official economic series is implemented and a first
bounded experiment set has been run. Within it, simple baselines are hard to beat on WPI, ETS is the
most accurate of the tested models for IIP up to six months ahead, and all conclusions are indicative. Longer
history, significance testing and the foundation-model comparison remain future work.

## 12. Reproducibility

Data retrieved 2026-11-20. Python 3.12.4; numpy 2.5.5, pandas 3.1.1, scipy 1.18.1, statsmodels 0.15.0,
xgboost 3.4.1, matplotlib 3.11.2. Seeds: 0 for all runs. Commands (from the repository root, PowerShell):

```powershell
.\.venv\Scripts\python.exe -m db.migrate
.\.venv\Scripts\python.exe -m pipeline.forecasting.cli suite --name all --indicator all --save
.\.venv\Scripts\python.exe -m pipeline.forecasting.report --out docs/research/generated
```

Activation record: the same 176 runs (1,195 forecast rows, 718 scores) are stored in the development database; the tables and figures regenerated from it are byte-identical to those produced from the verified test-database copy, and a second run stored nothing new. Each run stores a dataset fingerprint and origins fingerprint; the same data and configuration give the same
experiment id and (within floating-point tolerance) the same metrics.

## References

*All entries are placeholders and **unverified**. Do not cite until each is located and checked.*

* [REF-1] *(forecasting textbook, to be identified)*
* [REF-2] *(MASE paper, to be identified)*
* [REF-3] *(conformal prediction for time series, to be identified)*
* [REF-4] *(gradient boosting, to be identified)*
* [REF-5] *(Chronos-2, to be identified)*
* [REF-6] *(TimesFM, to be identified)*
* [REF-7] *(Indian inflation/IIP forecasting literature, to be identified)*
* [REF-8] *(rolling-origin evaluation, to be identified)*
* [DATA-1] MoSPI eSankhyiki API, `https://api.mospi.gov.in` (retrieved 2026-11-20).
