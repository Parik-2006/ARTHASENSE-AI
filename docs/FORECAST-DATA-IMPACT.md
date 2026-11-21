# Forecast data-impact report

Read-only analysis of the local database: `python -m pipeline.forecasting.impact` → `reports/forecast-data-impact.json`.
**No model was trained, no stored run was changed, no heavyweight model was installed, nothing touched production.**

## 1. What is stored (local database)

176 `forecast_runs`, all with `snapshot_policy = latest`, training cutoffs from 2025-09 to 2026-10, 1,195 forecast rows, 718 scores.
Models represented: naive, snaive (seasonal naive), drift, ets, arima, sarima, xgboost, chronos2, timesfm25.

| Series (all current base) | Runs | Completed | Skipped | Why skipped (recorded in the run) |
|---|---|---|---|---|
| CPI Current (22 months) | 56 | **0** | 56 | 48 × "only 0 usable forecast origin(s); at least 5 needed"; 4 × TimesFM and 4 × Chronos-2 "python packages not installed" |
| WPI 2022-23 (43 months) | 60 | 47 (43 backtests + 4 forecasts) | 13 | 5 × "only 1 usable origin"; 4 × Chronos-2 and 4 × TimesFM unavailable |
| IIP 2022-23 (42 months) | 60 | 43 (39 backtests + 4 forecasts) | 17 | 5 × "only 0 usable origins"; 4 × "only 4 usable origins"; 4 × Chronos-2 and 4 × TimesFM unavailable |

(Exact completed/skipped splits come from `reports/forecast-data-impact.json`; the reproducibility classes below use the completed runs.)

**Unavailable models produce no predictions.** Every Chronos-2 and TimesFM 2.5 run is `skipped` with 0 origins and its reason
(the packages are not installed). This matches test scenario 23: the system records the absence; it never invents a forecast.

## 2. Reproducibility of the stored runs

Method: each run stores `dataset_fingerprint` = hash(series code, snapshot policy, every (period, value, release_key)).
I recomputed the fingerprint from the **current** data under the same policy, and, where it differed, from the data as it stood
when the run was created (`as_of = created_at`).

| Class | WPI | IIP | CPI |
|---|---|---|---|
| Still reproducible on current data (fingerprint matches today) | **47** | **43** | 0 |
| Older vintage, reproducible as of creation | 0 | 0 | 0 |
| Not reproducible (data changed, vintage unrecoverable) | 0 | 0 | 0 |
| No action: skipped/failed (no data to reproduce) | 13 | 17 | 56 |

Reading it: **no existing experiment has been invalidated by the new history**, because (a) the forecast registry trains only
on CPI **Current**, WPI **2022-23** and IIP **2022-23**; (b) this audit added *other* series (CPI Back, WPI/IIP 2011-12) and
did not change any value in the trained ones. The monitor's live comparison confirmed zero value changes in those series.

## 3. What would make a run stale

| Event | Effect on stored runs | Action |
|---|---|---|
| A **new month** is ingested for a trained series | The *current* fingerprint changes; old runs stay valid as an **older vintage** (reproducible only with `as_of`); their "forecast" rows become partly historical | Keep immutable; run a new experiment under a new id (ids are deterministic from inputs) |
| A **revised value** arrives (new release snapshot) | Same, plus `policy=latest` runs can no longer be reproduced from today's data; only `as_of = created_at` can | Prefer `policy=first` or recorded `as_of` for future reproducibility; never edit old runs |
| A **new base year** becomes the target | A different series code, so a separate experiment family | Do not mix; no training across bases |
| A model library changes (e.g. statsmodels) | Fingerprints still match but results may not | Record library versions per run (**not recorded today**: gap) |

`snapshot_policy = latest` for every run means these are **not point-in-time (pseudo-real-time) backtests**: a backtest
origin saw the final revised history. This is a standing limitation of all stored scores (flagged in `docs/m1-data-verification.md`).

## 4. Base-year risks
- Training on CPI Back + Current as one series would cross the Dec 2024 → Jan 2025 join (−1.20 %, an artifact of the linking
  method, not a price move). A model would learn a level break. **Not done; needs your approval and a documented treatment.**
- WPI/IIP legacy bases (2011-12) must never be concatenated with the new base for training; they are separate series.
- Index **levels** are forecast, never official rates, so a rebasing shifts the level scale entirely: forecasts are not comparable across bases.

## 5. Would more history help?
- **More origins:** yes for evaluation. Upper-bound arithmetic (`n − 12 − h + 1`): CPI Current today 10 / 8 / 5 / 0 origins for h = 1 / 3 / 6 / 12; a 166-month CPI would allow up to 154 / 152 / 149 / 143.
  **These are upper bounds, not promises:** the real models need more initial training than 12 months (the stored CPI runs recorded 0 usable origins).
- **Accuracy:** not demonstrated. A longer series can include structural breaks (the 2020–21 shock, the base join) and make
  results worse. No claim of improved accuracy is made.
- **Models:** Chronos-2 and TimesFM 2.5 stay disabled (packages not installed; a ~0.5–1 GB download needs your approval).

## 6. Known weaknesses recorded elsewhere
`docs/FORECASTS-V2.md` documents a real specification issue: SARIMA is fitted with `enforce_stationarity=False`; at the
Apr 2026 WPI origin the AR coefficient is explosive (1.201), so some stored WPI ARIMA/SARIMA h ≥ 3 scores may be affected.
That branch now **records** `explosive_ar` for new runs; stored runs are untouched. Recomputation is a candidate, not done.
The WPI move behind it (+4.11 % on 2022-23, +3.86 % on 2011-12 in Mar → Apr 2026) is present in **both** official bases.

## 7. Future retraining plan (not executed, needs approval)
1. Freeze the current runs (they are immutable by design). 2. Decide the CPI policy (Current only vs. an official-linked 166-month series with a documented break treatment). 3. Add per-run library versions and `as_of` capture. 4. Re-run locally only, under new experiment ids, with `policy=first`. 5. Compare to the frozen scores; publish both. 6. Production import of results only after the data import is approved.
