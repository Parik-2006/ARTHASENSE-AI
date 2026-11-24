# Forecasts V4: WPI (and IIP) legacy history

Date: 2026-11-24. Data: production snapshot `arthasense-prod-20261124T085029Z.dump`, restored into isolated PostgreSQL 17.
Tool: `tools/forecasts_v4_eval.py linked` (read-only). Results: `reports/forecasts-v4/linked-wpi.json`, `linked-iip.json`.

## 1. WPI series in the database

| Series | Base | First | Last | Months | Gaps / duplicates |
|---|---|---|---|---|---|
| `mospi.wpi.1993-94.india.all_commodities.index` | 1993-94 | 1994-04 | 2010-08 | 197 | none |
| `mospi.wpi.2004-05.india.all_commodities.index` | 2004-05 | 2005-01 | 2017-03 | 147 | none |
| `mospi.wpi.2011-12.india.all_commodities.index` | 2011-12 | 2012-04 | 2026-04 | 169 | none |
| `mospi.wpi.2022-23.india.all_commodities.index` (current) | 2022-23 | 2023-04 | 2026-10 | 43 | none |

One value per month in every series (distinct months = rows). The 2011-12 series was published in parallel with the new
one for 37 months (Apr 2023 – Apr 2026).

## 2. Why the V1–V3 WPI models were weak

* **Short training history.** Until V4 every WPI model trained on the 2022-23 series alone: 18 months at the first
  backtest origin, 42 at the last. Older data was stored but never used for training (`load_indicator` reads one series).
* **The April 2026 jump is real.** WPI rose 104.6 → 108.9 (+4.1%) in April 2026. The parallel 2011-12 series rose
  160.8 → 167.0 (+3.9%) in the same month, so this is a genuine price movement measured by both baskets, not a base
  revision, a source error or a splice artefact. YoY WPI inflation reached 12.29% in October 2026 (OEA press release).
* **Short-window intervals are too narrow.** A drift or random-walk interval estimated from the calm 2023-25 months
  (monthly changes ≈ 0.4) cannot anticipate a 4% monthly jump. On the V3 test set (20 origins, h = 6) the drift model's
  80% / 95% intervals contained the actual value 40% / 55% of the time.
* **The "Weak track record" label was justified.** Drift beat Naive on MAE (3.39 vs 3.54) but under-covered far below the
  documented floors (80%: < 50%, 95%: < 75%). Coverage arithmetic was re-checked: native step-h intervals, actual
  inside [lower, upper], 20 pairs.
* **Caveat on coverage.** 20 overlapping 6-month-ahead origins share most of their errors: only about 3–4 non-overlapping
  6-month windows exist, so coverage at h = 6 is itself very uncertain.

## 3. Official linking method (evidence level L)

* OEA page *Linking Factor For WPI Series (Base Year: 2022-23)* (https://eaindustry.nic.in/linking_factor2223.asp, read
  2026-11-24 over verified TLS): All Commodities **1.53**; Primary Articles 1.71, Fuel & Power 1.65, Manufactured Products
  1.44. Method: "ratio of geometric means of the twelve-month indices of old and new series of WPI for the financial year
  2024-25". OEA "does not prescribe any specific methodology" and advises caution.
* OEA *FAQs on New Series of WPI (Base year 2022-23)*, Q20: "Back-casted new series in old periods 't-n' = Old series index
  of period 't-n' /1.53 … back casted new series would follow inflation of old series."
* Reproduction from stored data: GM(old, FY2024-25) / GM(new, FY2024-25) = **1.5327** (published to 2 d.p. as 1.53).

## 4. Transformation implemented

`pipeline/research/loader.py::load_backcast_linked("wpi")`:

```
training(t) = WPI_2011-12(t) / 1.53     for t < 2023-04   (Apr 2012 – Mar 2023, 132 months)
training(t) = WPI_2022-23(t)            for t >= 2023-04  (official, unchanged, 43 months)
```

* The published factor 1.53 is used, not ArthaSense's 1.5327.
* Old-base values from Apr 2023 onward (37 months) are **never** used.
* Stored observations are not modified; back-cast values exist only in memory. Each back-cast point keeps its 2011-12
  release key. Every run stores the transformation, factor, formula, source, join and counts in
  `configuration.training_data.link`.
* Continuity: the back-cast Mar 2023 value is 98.69; the official Apr 2023 value is 99.0 (+0.31%). The old series itself
  moved +0.07% that month, so the join adds a step of about 0.25%, which is recorded.
* Overlap stability: old/new ratio 1.515–1.543 over 37 months (s.d. 0.43% of the mean). It drifts slowly downward:
  the two baskets' price movements differ a little, as OEA warns.

## 5. Fair test: linked history vs current series alone

Same five models (the only ones eligible on an 18-month current window), same horizons, and the **same scored target
months**: linked origins are aligned by date to the current backtest's origins (both expanding windows). Only the length
of the training history differs. MAE (index points), 80% / 95% coverage:

| Model | h | Origins | MAE current | MAE linked | cov80 cur → lnk | cov95 cur → lnk |
|---|---|---|---|---|---|---|
| Naive | 6 | 20 | 3.540 | 3.540 | 0.35 → 0.50 | 0.50 → 0.60 |
| Drift | 1 | 25 | 0.637 | 0.642 | 0.64 → 0.84 | 0.92 → 0.88 |
| Drift | 6 | 20 | 3.387 | 3.231 | 0.40 → 0.40 | 0.55 → 0.65 |
| Drift | 12 | 14 | 5.739 | 5.040 | 0.29 → 0.36 | 0.50 → 0.50 |
| ETS | 1 | 25 | 0.704 | 0.684 | 0.60 → 0.68 | 0.76 → 0.84 |
| ETS | 6 | 20 | 3.210 | 3.341 | 0.35 → 0.70 | 0.55 → 0.85 |
| ETS | 12 | 14 | 5.836 | 6.530 | 0.36 → 0.50 | 0.43 → 0.93 |
| ARIMA | 1 | 25 | 0.675 | 0.597 | 0.68 → 0.76 | 0.80 → 0.92 |
| ARIMA | 6 | 20 | 4.037 | 3.108 | 0.45 → 0.55 | 0.60 → 0.70 |
| ARIMA | 12 | 14 | 5.877 | 5.017 | 0.43 → 0.36 | 0.43 → 0.79 |

(All 20 model × horizon cells are in `linked-wpi.json`.) Naive point forecasts are identical by construction; their
intervals widen because the residual spread is estimated on more history. The linked history lowers MAE for ARIMA at every
horizon and for Drift at h ≥ 3, and brings coverage closer to nominal in most cells. It is **worse** for ETS at h = 6 and
h = 12. Differences are not tested for significance.

**Decision.** The link is official, documented, reproducible and continuous, and on balance it improves out-of-sample
accuracy and calibration. It is also the only way SARIMA (36 months), Random Forest and XGBoost (37 months) can be
evaluated at all. V4 therefore trains WPI on the linked history (suite `v4_linked`: 132 back-cast months before the first
origin, scored only on official 2022-23 months). The V1–V3 current-series runs stay stored and unchanged.

## 6. IIP (same method)

NSO technical note *Linking Factor for IIP* (microdata.gov.in catalogue 299, document 6676, read 2026-11-24): General
**1.3834** (Mining 1.1890, Manufacturing 1.3700, Electricity 1.8495), geometric-mean method over FY 2022-23, "the linked
series is obtained by dividing the indices of old series". Reproduced exactly from stored data. Caveat: the 2022-23 General
index adds water supply, sewerage and waste management, which the old series did not cover. The join (Mar → Apr 2023,
−8.4%) is IIP's usual seasonal March→April fall (−7% to −13% every year in both series). The overlap ratio is less stable
than WPI's (1.32–1.40, s.d. 1.66%), largely seasonal.

Fair test (same design): ARIMA MAE falls sharply (h = 6: 6.34 → 3.38; h = 12: 8.03 → 3.06) and ETS improves at h ≤ 3
(h = 1: 3.72 → 2.33), but ETS is worse at h = 12 (2.77 → 6.16). Linked intervals **over-cover** (≈ 100% at 80% nominal),
because the 2020 COVID collapse (−54% in April 2020, a genuine official value that is kept) inflates the variance. IIP is
also trained on its linked history in V4, with this caveat shown in Research view.

## 7. Reliability is not forced

The reliability rules (`lib/forecast-v2.ts`, unchanged) are applied to the new evidence exactly as before. Any change in
WPI's label comes from the stored V4 backtests (see `docs/FORECASTS-V4-MODELS.md`), never from an override.
