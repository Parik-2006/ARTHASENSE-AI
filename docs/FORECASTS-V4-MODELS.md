# Forecasts V4: the eight models

Numbers below are the stored V4 backtests on the isolated restore of the 2026-11-24 production snapshot (identical code
and data to the production import; see `docs/FORECASTS-V4-RELEASE.md` for the reproducibility check). Extracted with
`tools/e2e/forecasts-v4-results.mjs` (API metrics + the UI's own reliability levels and default). MAE/RMSE are in index
points (GDP: ₹ crore), sMAPE in %, coverage = share of actual values inside the interval.

## 1. Implementations

| # | Model | Configuration (V4) | Selection / training | Intervals |
|---|---|---|---|---|
| 1 | Naive | last value carried forward | — | random-walk Gaussian, σ from training changes |
| 2 | Seasonal naive | same period last year; m = 12 (monthly), 4 (quarterly) | — | seasonal random-walk Gaussian |
| 3 | ARIMA | ARIMA(p,1,q), p ∈ {0,1,2}, q ∈ {0,1}, with/without drift (12 candidates) | AICc **inside each training window**; stationarity and invertibility enforced | state-space Gaussian |
| 4 | SARIMA | SARIMA(p,1,q)(P,1,Q)m, p,q ∈ {0,1}, (P,Q) ∈ {(0,1),(1,0)} | AICc inside each window | state-space Gaussian |
| 5 | Random Forest | scikit-learn 1.8.0, 300 trees, min leaf 3, max features 0.5, seed 0, 1 job | fixed in advance, never tuned on backtests | split/online conformal from its own past errors |
| 6 | XGBoost | xgboost 3.4.1, 100 rounds, depth 2, eta 0.05, seed 0, 1 thread | fixed in advance | split/online conformal |
| 7 | Drift | straight line first → last training value | — | drift Gaussian |
| 8 | ETS | additive-error ETS: A,Ad,N / A,A,N / A,N,N / A,Ad,A (seasonal only with ≥ 3 cycles) | AICc inside each window | state-space Gaussian |

Tree models forecast **changes**, not levels. Features at time j use only changes up to j − 1: lags (monthly 1,2,3,6,12;
quarterly 1–4), mean and standard deviation of the last three changes, and the target period's position in the year
(sin/cos; a calendar fact, never a value). Splits are by time; nothing is fitted on the whole series.

Every run stores the exact configuration it used (`configuration.diagnostics.label`, e.g. `SARIMA(1,1,1)(0,1,1)12`, the
AICc candidate table and, for backtests, the configuration chosen at each origin), the model config, the training data
provenance and the library versions (Python 3.12.4, numpy 2.5.5, pandas 3.1.1, scipy 1.18.1, statsmodels 0.15.0,
xgboost 3.4.1, scikit-learn 1.8.0). The V1–V3 fixed configurations are kept as config set `v3`, so the 204 stored runs still
reproduce bit for bit and keep their experiment ids.

## 2. Recursive vs direct multi-step (Random Forest, XGBoost)

Research suite on the linked histories, identical origins (`reports/forecasts-v4/strategy-*.json`). MAE:

| Indicator | Model | h=3 rec / dir | h=6 rec / dir | h=12 rec / dir |
|---|---|---|---|---|
| CPI (22 → 11 origins) | RF | 0.780 / 0.716 | 1.132 / 1.127 | 1.266 / 1.241 |
| | XGBoost | 0.712 / 0.662 | 1.019 / 1.027 | 1.192 / 1.081 |
| WPI (41 → 32) | RF | 1.160 / 1.205 | 1.852 / 1.978 | 2.932 / 2.902 |
| | XGBoost | 1.184 / 1.255 | 1.988 / 2.042 | 3.066 / 2.896 |
| IIP (40 → 31) | RF | 3.331 / 3.158 | 5.127 / 3.852 | 8.685 / 4.019 |
| | XGBoost | 3.380 / 3.664 | 5.265 / 3.749 | 6.917 / 3.919 |

h = 1 is identical by construction. **Decision: direct.** It wins or ties at h = 12 everywhere, avoids feeding predictions
back (error compounding is severe on IIP: RF h = 12 8.69 → 4.02), and its worst losses (WPI h = 3–6) are small. Recursive
results are reported, not hidden.

## 3. Evaluation design

Rolling-origin expanding windows; a fresh model per origin; every model of a suite uses the same origins (enforced: a model
that errors at any origin is recorded `failed`, not silently moved to another comparison group). Linked suites start at the
join, so **every scored target is an official current-base month**. MAE, RMSE, sMAPE, MASE, bias, 80/95% coverage and
width; ≥ 5 origins to report, ≥ 12 to rank. No significance tests: differences are described, never claimed as superiority.

## 4. Results (default horizon; all horizons in the stored comparison and `reports/forecasts-v4/results.json`)

### CPI, h = 6 (17 origins, Jun 2025 – Oct 2026; training on the official back + current history)

| Model | MAE | RMSE | sMAPE | 80% / 95% cov. | vs Naive | Track record |
|---|---|---|---|---|---|---|
| XGBoost | 1.027 | 1.200 | 0.97 | 63% / — | −55% | limited (no validated 95% interval) |
| **Drift (default)** | 1.081 | 1.435 | 1.02 | 76% / 88% | −53% | **stronger** |
| SARIMA | 1.099 | 1.224 | 1.04 | 88% / 94% | −52% | stronger |
| Random Forest | 1.127 | 1.305 | 1.06 | 63% / — | −51% | limited |
| ETS | 1.232 | 1.458 | 1.17 | 59% / 88% | −47% | limited |
| ARIMA | 1.324 | 1.565 | 1.25 | 94% / 94% | −43% | stronger |
| Naive | 2.304 | 2.641 | 2.19 | 41% / 71% | — | weak |
| Seasonal naive | 3.081 | 3.548 | 2.95 | 29% / 41% | +34% | weak |

### WPI, h = 6 (38 origins, Sep 2023 – Oct 2026; training on the OEA-linked history)

| Model | MAE | RMSE | sMAPE | 80% / 95% cov. | vs Naive | Track record |
|---|---|---|---|---|---|---|
| Random Forest | 1.978 | 3.234 | 1.89 | 48% / 43% | −14% | weak (intervals far too narrow) |
| **SARIMA(1,1,1)(0,1,1)12 (default)** | 1.992 | 2.853 | 1.91 | 82% / 87% | −14% | **stronger** |
| XGBoost | 2.042 | 3.296 | 1.96 | 48% / 43% | −12% | weak |
| Drift | 2.051 | 3.027 | 1.96 | 68% / 82% | −11% | limited |
| ETS | 2.224 | 3.146 | 2.13 | 84% / 92% | −4% | stronger |
| Naive | 2.311 | 3.515 | 2.22 | 71% / 79% | — | limited |
| ARIMA | 2.335 | 2.962 | 2.24 | 71% / 84% | +1% | weak |
| Seasonal naive | 2.856 | 4.636 | 2.75 | 82% / 82% | +24% | weak |

WPI's label moves from "Weak" (V3: Drift on the 43-month current series, coverage 40% / 55%) to "Stronger" for
SARIMA on the linked history. This comes from the stored evidence under the unchanged rules, not from an override. It
must be read with caution: the 38 six-month-ahead origins overlap, so they contain only about six independent six-month
errors; RF has a slightly lower MAE but badly under-covers; at h = 12 SARIMA is no better than Naive and is rated weak.

### IIP, h = 6 (37 origins, Sep 2023 – Sep 2026; NSO-linked history)

| Model | MAE | RMSE | sMAPE | 80% / 95% cov. | vs Naive | Track record |
|---|---|---|---|---|---|---|
| **ARIMA(2,1,1) with drift (default)** | 3.434 | 4.566 | 2.99 | 92% / 100% | −36% | **stronger** |
| XGBoost | 3.749 | 4.586 | 3.31 | 75% / 100% | −30% | stronger |
| Random Forest | 3.852 | 4.619 | 3.37 | 71% / 92% | −28% | stronger |
| ETS | 4.297 | 5.259 | 3.79 | 100% / 100% | −20% | stronger |
| SARIMA | 4.886 | 5.587 | 4.35 | 92% / 100% | −9% | stronger |
| Drift | 5.061 | 6.326 | 4.41 | 100% / 100% | −5% | stronger |
| Naive | 5.353 | 6.704 | 4.69 | 100% / 100% | — | limited |
| Seasonal naive | 6.175 | 6.657 | 5.52 | 97% / 100% | +15% | weak |

Over-coverage is a known caveat: the 2020 collapse inflates every variance estimate, so intervals are wider than needed.
The rules accept coverage up to 100%; the UI and this document say the intervals are conservative.

### GDP, h = 4 (6 origins) — see `docs/FORECASTS-V4-GDP.md`

Drift (MAE ₹1,41,178 crore, −75% vs Naive) is the default, rated **limited**: six origins cannot support a stronger claim.

## 5. Model availability

| | CPI | WPI | IIP | GDP |
|---|---|---|---|---|
| Naive, Seasonal naive, Drift | ✔ | ✔ | ✔ | ✔ (to 4 quarters) |
| ETS, ARIMA | ✔ | ✔ | ✔ | ✔ (1 quarter) |
| SARIMA | ✔ | ✔ | ✔ | insufficient history (needs 16 quarters + 5 origins) |
| Random Forest, XGBoost | ✔ | ✔ | ✔ | insufficient history (needs 29 quarters) |

No model failed to train. Statuses come from `/api/v1/forecasting/model-status`, derived from stored runs only.

## 6. Default-model rule

`pickDefaultV4` (`apps/web/src/lib/forecast-evidence.ts`), shared by the Outlook cards, the explorers and the comparison
page: (1) the reader's choice in the URL; (2) the longest stored horizon ≤ 6 months / 4 quarters; (3) the strongest
reliability level on ONE evaluation set (identical origins for every candidate); (4) the lowest MAE, where models within
2% of the best are tied and the simpler model wins (Naive < Seasonal naive < Drift < ETS < ARIMA < SARIMA < Random Forest
< XGBoost). Reliability (rules unchanged from V3) is separate from accuracy: a model with the lowest error can still be
"weak" if its uncertainty intervals are mis-calibrated, and the UI shows both.

## 7. Prediction intervals

Native intervals for the statistical and baseline models. Random Forest and XGBoost have none: in backtests they get online
conformal intervals built only from errors already observable at each origin; their future forecasts get split-conformal
intervals from their own backtest errors at each step (95% needs ≥ 19 errors). Where there are too few, the interval is
stored as missing and the UI says "Uncertainty interval unavailable"; nothing is invented.
