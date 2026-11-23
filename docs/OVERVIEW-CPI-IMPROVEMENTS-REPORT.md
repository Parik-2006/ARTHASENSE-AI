# Overview logo, 2026 comparison and CPI forecasting (report, 2026-11-23)

Branch `feature/overview-cpi-improvements`, from `fc2282a` (= `origin/main`, production Forecasts V3). **Nothing was pushed,
deployed or written to production.** All forecasting experiments were stored only in an isolated local clone database
(`arthasense_cpi_exp`, created with `CREATE DATABASE … TEMPLATE arthasense` on the local Docker PostgreSQL). The shared local
dev database `arthasense` was only read. Production Supabase was not queried; the "before" screenshots come from the public site.

| Task | Result |
|---|---|
| 1. Logo in the Overview hero | **PASS** |
| 2. "Compare economic trends" simplified to 2026 | **PASS** |
| 3. CPI forecasting | **PASS (scientifically justified: Option A)**, implemented and verified locally. Production needs a data step (section 6) |

## 1. Logo (Task 1)

* **Root cause:** the hero had no image, and the app had no `public/` directory.
* `logo.png` (repository parent folder) is 1254 × 1254 RGBA with transparent corners (48 % transparent pixels). Its lettering
  has dark outlines and an opaque navy panel, so it reads on both themes (checked by compositing it on `#f6f5f1` and `#0e1116`).
* It is copied **byte-identical** (sha256 `0ae23040…a30189`) to `apps/web/public/logo.png`. It is rendered with `next/image`
  (`width`/`height` 1254, `object-contain`, `preload`, which replaces Next 16's deprecated `priority`, `sizes`, alt
  "ArthaSense AI logo").
* **Layout:** the hero is a flex row (`src/app/page.tsx`). At ≥ 640 px the text is on the left and the logo on the right,
  vertically centred, at 136 px (tablet) or 176 px (≥ 1024 px). Below 640 px it stacks: a 96 px logo above the text.
* Heading, subtitle, "Take a tour" and "Explore the indicators" are unchanged. The hero `data-tour="hero"` wrapper is
  unchanged, so the tour spotlight still covers the whole hero, logo included.
* **Browser-verified at 360/390/768/1024/1440/1920 × light/dark:**
  * the image is loaded, 1 : 1 and at the expected size;
  * it overlaps nothing: not the heading, button, link, navigation or GDP card;
  * it is right of the heading on wider screens and above it on mobile;
  * there is no horizontal overflow and no console error.

## 2. 2026-only comparison (Task 2)

**Root cause:** Section 3 shared Section 2's URL range state (`useRange`) and offered indicator checkboxes, 4 modes,
8 rolling windows, Custom, 5 year buttons and date pickers. GDP was off by default, so the default view was monthly
CPI/WPI/IIP only.

**Now** (`components/overview/overview-final.tsx` › `Compare`, `lib/overview-v3.ts` › `buildYearComparison`):

* **Controls:** a single non-interactive "Year 2026" indicator. There are no inputs or buttons. The section reads no URL
  parameters, so stale `?ci=` / `?cmp=` links are ignored, and Section 2's filters stay exactly as they were.
* **Comparison:** CPI, WPI, IIP and GDP, year-on-year by quarter.
* **Policy unchanged from the existing quarterly mode:**
  * a monthly index enters as the average of a quarter's three months, only when all three are stored;
  * GDP keeps its own quarterly levels, and no monthly GDP is created;
  * YoY is computed on each current-base series' **full** history and then cut to 2026, so the 2025 lookback is not lost.
* **The year** is the latest calendar year in which any indicator has a value (2026 today).
* **One deliberate difference from the shared-window mode:** an indicator keeps quarters that GDP has not reached yet. The
  missing GDP point is a gap with a note, never an estimate.
* **Labels:** quarters are labelled by calendar ("Jan–Mar 2026"), with the fiscal mapping below the chart
  ("Jan–Mar = Q4 FY25-26 · Apr–Jun = Q1 FY26-27 · Jul–Sep = Q2 FY26-27").
* **Notes** state incomplete quarters and unpublished GDP; the actual notes are listed below the values table.

Values shown (local data, which matches production for these series), checked independently against the database:

| Quarter of 2026 | CPI | WPI | IIP | GDP (calc.) | GDP official growth |
|---|---|---|---|---|---|
| Jan–Mar (Q4 FY25-26) | 3.11 % | 2.45 % | 3.84 % | 8.56 % | 8.6 % |
| Apr–Jun (Q1 FY26-27) | 3.93 % | 9.40 % | 6.22 % | 7.82 % | 7.8 % |
| Jul–Sep (Q2 FY26-27) | 4.94 % | 10.36 % | 7.28 % | not published | — |

The notes shown under the chart:

* "Oct–Dec 2026 is not shown for CPI and WPI: the quarter is not complete yet (CPI 1 of 3 months, WPI 1 of 3 months)."
* "GDP for Jul–Sep 2026 is not published yet, so it is not drawn."

The help text `gdp-quarterly` and the Overview tour's "Comparing trends" step were updated to describe the fixed view.
Indicators pages, Section 2, Forecasts and Research keep all their filters. `buildComparison` is unchanged and still
tested. It is no longer used by the Overview.

## 3. CPI data inventory and compatibility (Task 3, step 1)

Local read-only audit (`tools/cpi_linked_evidence.py` → `reports/cpi-linked/evidence.json`):

| Series (id) | Base | Span | Obs | Gaps / dups | Releases | Notes |
|---|---|---|---|---|---|---|
| `mospi.cpi.2024.current…index` (1) | 2024 | Jan 2025 – Oct 2026 | 22 | 0 / 0 | 2 | official inflation Jan–Oct 2026 |
| `mospi.cpi.2024.back…index` (44) | 2024 | Jan 2013 – Dec 2024 | 144 | 0 / 0 | 12 | MoSPI back series, released 12 Feb 2026 |
| `mospi.cpi.2012.current…index` (209) | 2012 | Jan 2013 – Dec 2025 | 156 | 0 / 0 | 13 | discontinued; Apr–May 2020 flagged `F*` at source |

**What the official source says.** MoSPI, *FAQs on CPI 2024 series*, Annexure V (PDF sha256 `7720b640…`, read here):

* Q36: "Back Series for Base 2024=100" covers Jan 2013 – Dec 2024 and is "calculated on the basis of linking factor".
* Q37: the linking factor "is calculated to connect the two series over a common overlapping period" (2025):
  LF = GM(new 2025) / GM(old 2025), and linked = old × LF.
* Q38: the Combined factor is 0.5267.

**Verified from the data:**

* Back ÷ CPI-2012 lies between 0.52627 and 0.52709 over all 144 months. The largest gap between Back and
  CPI-2012 × 0.5267 is 0.050 points, which is publication rounding.
* LF recomputed from the stored 2025 data is 0.52673.
* Back-series official inflation equals CPI-2012 inflation exactly (max difference 0.0).
* The Back and Current series share **0** months, so nothing is double-counted.

**The join.** The linked series steps −1.195 % from Dec 2024 to Jan 2025. CPI-2012 itself fell −1.024 % that month, so
only about **−0.17 pp** comes from the method: the factor matches annual means, and the Current/2012 ratio moves within
0.5256–0.5281 across 2025. That is a quarter of one standard deviation of monthly change (0.68 pp). This **corrects**
`docs/FORECAST-DATA-IMPACT.md` §4, which described the whole −1.20 % as an artifact. No adjustment is applied: a
correction factor would be invented.

**Limitations kept in view:**

* Before 2025 the linked series moves like the **2012 basket**, whose food weight is 45.9 % against 40.1 % in 2024.
* The back series did not exist before 12 Feb 2026, so backtests are pseudo-out-of-sample (`snapshot_policy=latest`), not
  real-time.
* Apr–May 2020 are MoSPI lockdown imputations: flagged `F*` in the 2012 series, unflagged in the Back series. They are kept,
  not dropped.

**Why the 56 stored CPI runs were skipped.**

* All 56 were created on 2026-11-20 on the Current series alone, when it had 12 months (fingerprint `2441fca38375ad66`,
  cutoff Dec 2025).
* 48 recorded "only 0 usable forecast origin(s); at least 5 needed".
* 8 are Chronos-2 or TimesFM runs, unavailable because their packages are not installed.
* They are untouched and remain in history.

## 4. Decision: Option A, the official compatible back series

The back series is MoSPI's own series on the **same 2024 = 100 base**, published to connect the two series, with no
overlap. So it is used as published. No ArthaSense linking factor and no rebasing are applied, and the 2012 series is never
joined (the loader raises `MixedBaseError` for a different base). Options B–D were therefore not needed. A legacy-base
forecast (C) would also have been stale, because that series ends in Dec 2025.

**Implementation** (existing pipeline, opt-in, WPI/IIP code paths unchanged):

* **Training history.** `experiments.load_training(conn, "cpi", "linked")` uses the existing
  `loader.load_cpi_2024_linked` (it requires a gap-free series and records `join_period`).
* **Storage.**
  * Runs are stored against the **Current** series (`RunRecord.target_series_code`), because that is the forecast target.
  * The configuration records `training_data` (the components, join, span, n), and the fingerprint is of the composite.
  * Single-series runs keep exactly their previous configuration keys, so WPI/IIP experiment ids do not change.
* **New suite `linked_current`** (naive, snaive, drift, ETS, ARIMA(1,1,0), SARIMA; h = 1/3/6/12):
  * The first origin is Dec 2024 and the training window expands from Jan 2013.
  * So **every scored target is a genuine Current-series month** (Jan 2025 – Oct 2026), while training uses only official
    data before each origin.
  * All models at a horizon share identical origins.
* **Why long-history suites are not stored.** The existing long-history suites (`core` etc.) are deliberately **not**
  stored for CPI. Their targets are 85 % back-series months, and the UI picks the evaluation set with the most origins,
  which would let 2012-basket accuracy stand in for current CPI. They are reported below as a sensitivity check instead.
* CLI: `python -m pipeline.forecasting.cli suite --name all --indicator cpi --history linked [--save]`.

## 5. Training, backtests and forecasts (Task 3, step 3)

**Integrity of the 28 stored runs** (24 backtests + 4 six-month future forecasts; local run ids 177–204; fingerprint
`e9b1f3b6f3fbf346`):

* **0** rows with the target at or before the origin.
* **0** with the target ≠ origin + step.
* **0** backtest targets before Jan 2025.
* **0** actuals that differ from the stored official value, and 0 missing actuals.
* **0** 80 % intervals outside the 95 % interval, and 0 points outside the 80 % interval.
* **0** future rows at or before Oct 2026.
* Re-running the suite stores 0 new runs (the deterministic ids already exist).
* `tools/forecast_reproduce.py` (extended with `cpi_linked`) refits **28/28**: max forecast difference 5.0e-13, metric
  difference 0.0.

**Rolling-origin backtest, current-series targets only** (identical origins per horizon; metrics as stored):

| h (origins, targets) | Naive MAE | Drift | ETS | ARIMA | SARIMA | sNaive | Drift cov. 80/95 |
|---|---|---|---|---|---|---|---|
| 1 (22, Jan 25–Oct 26) | 0.469 | 0.351 | 0.305 | **0.298** | 0.512 | 3.161 | 91 % / 95 % |
| 3 (20, Mar 25–Oct 26) | 1.280 | **0.856** | 1.026 | 1.056 | 1.233 | 3.107 | 75 % / 85 % |
| 6 (17, Jun 25–Oct 26) | 2.304 | **1.081** | 2.140 | 2.159 | 2.226 | 3.081 | 76 % / 88 % |

sMAPE at h = 6: Naive 2.19 %, Drift 1.02 %, ETS 2.04 %. RMSE at h = 6: Naive 2.64, Drift 1.43. h = 12 has 11 origins and
is flagged "indicative only".

**Sensitivity checks** (computed in memory, not stored):

* **Long history (`core` settings, 143–148 origins from mid-2014).** The ordering is the same: Drift and ETS/ARIMA beat naive.
  * At h = 6, MAE is Naive 2.01, Drift 1.30 and ETS 1.88.
  * Drift's 80 % coverage falls to 60 % there (ETS 79 %), so its intervals are a little narrow over the long run.
* **60-month rolling window instead of expanding.** The errors are almost identical (Drift h = 6 MAE 1.06, ARIMA h = 1
  0.30), so the pre-2020 data is not what drives the results.
* **Applying the UI's reliability rules to the long-history numbers.** Drift h = 6 (143 origins, MAE 1.30 < 2.01, coverage
  60.1 % / 88.8 %) would still be rated "supported", right at the 60 % floor. So leaving that suite unstored hid no
  "concerning" result that the caveat path would have shown.

**Model diagnostics** (stored in each run's configuration):

* No origin has an explosive AR part.
* ARIMA did not converge at 4 of 22 backtest origins (h = 1) and SARIMA at 1. Both are recorded and those origins are
  still scored.
* The stored future ARIMA fit converged and is stationary (smallest AR root modulus 1.84).

**Default view and future forecasts** (origin Oct 2026, latest official **110.05**):

* The existing rules apply unchanged: strongest evidence at the longest horizon ≤ 6, then the lowest MAE on the same origins.
  They select **Drift at 6 months**, rated "Stronger track record" on 17 origins. That is a rule of thumb, **not a
  significance test**: the h = 6 origins overlap, so the effective sample is smaller than 17.

| Model | Nov 2026 | Jan 2027 | Apr 2027 (80 % / 95 %) |
|---|---|---|---|
| Drift | 110.38 | 111.05 | **112.05** (110.36–113.74 / 109.47–114.63) |
| ETS | 110.49 | 111.13 | 111.68 (108.41–114.95 / 106.68–116.68) |
| ARIMA(1,1,0) | 110.35 | 110.61 | 110.70 (107.72–113.67 / 106.14–115.25) |
| Naive | 110.05 | 110.05 | 110.05 (108.39–111.71 / 107.51–112.59) |

The models disagree on the size of the rise (+0.6 % to +1.8 % by April 2027). The UI shows each model's range, and
Research shows every metric. Drift extends the 2013–2026 average monthly change (0.44 %), which is below the recent pace
(0.5–1.0 % a month in mid-2026). Read it as a statistical baseline, not a projection of current momentum.

**Freshness.** These runs become *stale* when the Nov 2026 CPI is stored. The existing staleness notice then appears, and
a new deterministic run (a new fingerprint and ids, with old runs kept) is created by re-running the same command.

## 6. UI and API (Task 3, step 4), and production rollout

**API** (`services/api/app/forecasting.py`):

* `/series` gains an optional `training_history`. It is reported only when every component is stored, has no gaps and
  joins exactly.
  * CPI's `evaluable_horizons` and status use that history.
  * With no stored runs, the status is `ready_not_run` ("…no tested forecast is stored yet"), so no forecast is claimed.
* `/comparison` no longer lists models as "excluded" because of runs on a superseded data vintage (the 56 old CPI runs).
  Where all runs share one fingerprint (WPI, IIP) the output is identical.
* **Byte-identical check:** every WPI/IIP response (`/series` rows, `/runs`, `/comparison` h = 1/3/6/12,
  `/forecasts/latest` × 4 models) was diffed between `fc2282a` and this branch on both local databases, with no difference.

**Web:**

* The CPI card and explorer reuse the WPI/IIP components and are driven entirely by stored runs.
* New text:
  * the card and the chart footer say "Trained on 166 months of official data (Jan 2013 – Oct 2026): MoSPI's back series on
    the same base until Dec 2024, then the current series.";
  * Research › Provenance adds a "Training data" row listing both series codes;
  * the unavailable state explains that older official CPI exists, why it is not used yet, and that 2012-base levels are
    never mixed in.
* The Forecasts tour anchors on the first available card, which is now CPI. Missing targets are skipped as before.

**A code-only deploy is safe; importing data first is not.** I verified the code-only case with this branch's web build
against the `fc2282a` API on a database without linked runs:

* the CPI card stays "Not enough comparable history" with the new explanation;
* WPI/IIP are unchanged (115.34 and 123.87);
* 322/322 browser checks and 58/58 Forecasts V3 checks pass.

The new backend without runs reports `ready_not_run`, which is also honest. **The reverse is not safe.** If the runs were
imported while the old code is live, the old frontend would show a CPI forecast with no training-data line, and the old
API would contradict it: `/series` would still say "insufficient_history", and `/comparison` would list models as
excluded for "0 usable origins". So the **data import goes last**.

**Production rollout plan (not performed; needs your approval). Order: code first, data last.**

1. **Deploy the backend to Render** (this branch's `services/api`).
   * Check that `/series` CPI shows `ready_not_run` with `training_history.n_observations` 166, and that WPI/IIP responses
     equal captures taken just before the deploy.
2. **Deploy the frontend to Vercel.**
   * The CPI card stays unavailable with the new explanation. Run `overview-cpi-e2e.mjs` with `EXPECT_CPI=unavailable`,
     `forecasts-e2e.mjs` and `forecasts-a11y.mjs` against production.
   * Tasks 1 and 2 are complete at this point.
3. **Back up production** with `tools/prod/backup_and_verify.sh`: a verified dump plus a test restore, as in the previous
   release.
4. **Pre-check, read-only.** Run `tools/cpi_linked_evidence.py` with the production URL. Its session is forced read-only,
   and the stored-run section is empty before the import.
   * Require: Back 144 and Current 22 months, 0 gaps, 0 overlap, and linked fingerprint **`e9b1f3b6f3fbf346`**.
   * If CPI data has changed (for example the Nov 2026 release), stop and review the new numbers: the runs will get new ids.
5. **No schema migration is needed.** The existing tables and columns are used.
6. **Import.**
   * **Tooling.** `db/transfer.py` copies only into an *empty* target, so it cannot add rows to production. The forecasting
     CLI is the additive path. This branch gives its `--save` the same remote-host guard as ingestion: it refuses
     non-local hosts unless `--allow-host` is given.
   * **Command,** with the pinned stack (Python 3.12.4, statsmodels 0.15.0, numpy 2.5.5, pandas 3.1.1):
     `python -m pipeline.forecasting.cli suite --name all --indicator cpi --history linked --save --allow-host <production host>`.
   * **Why refit rather than copy?** The refit is deterministic. With fingerprint `e9b1f3b6f3fbf346`, it produces exactly the
     **28 experiment ids** listed in `reports/cpi-linked/evidence.json` › `stored_runs`, which is checked in step 7.
   * **Rows:** exactly **28 `forecast_runs`, 444 `forecasts` and 216 `scores`**. Nothing else is written: no observations
     and no WPI/IIP runs.
   * **Atomicity.** Each run is stored in its own transaction. If the import is interrupted, re-running it inserts only the
     missing runs.
7. **Post-import checks:**
   * the stored experiment ids equal the 28 listed (any other id: run the rollback);
   * `tools/forecast_reproduce.py` returns `cpi_linked` 28/28, WPI 60/60 and IIP 60/60;
   * the integrity section of `tools/cpi_linked_evidence.py` is all zeros;
   * `/series` CPI shows `has_experiments`, and `/comparison?indicator=cpi&horizon=6` returns one rankable group of
     6 models on 17 origins;
   * then run `overview-cpi-e2e.mjs` (default mode) and `forecasts-e2e.mjs` against production.
8. **Rollback, data first** (there is no FK cascade):
   `DELETE FROM scores WHERE run_id IN (SELECT id FROM forecast_runs WHERE experiment_id = ANY(:ids)); DELETE FROM forecasts WHERE run_id IN (…); DELETE FROM forecast_runs WHERE experiment_id = ANY(:ids);`
   with the 28 ids. This returns the site to the honest unavailable state. Revert the code to `fc2282a` only if needed.

## 7. Tests

| Check | Result |
|---|---|
| Vitest | **407 passed** (was 394). 13 new or replacement tests: `buildYearComparison` ×6, 2026 compare section ×4 + 1 rewritten, CPI card/explorer states ×6 (`cpi-history.test.tsx`). |
| Pytest (local test DB) | **357 passed** (was 349): `pipeline/tests/test_forecasting_linked.py` ×8 (remote `--save` guard, compatibility and base separation, overlap refusal, chronology and no look-ahead, identical origins, determinism, storage target, API states incl. a gap) |
| Ruff check + format, ESLint, `tsc`, `next build` | clean |
| `tools/e2e/overview-cpi-e2e.mjs` (new) | 366/366 with the CPI runs; 322/322 in fallback mode. Covers 6 widths × 2 themes: logo, 2026 comparison, Overview tour (Escape), Forecasts cards and the CPI explorer, Research, Comparison, Indicators CPI/WPI/IIP/GDP |
| `tools/e2e/forecasts-e2e.mjs` | 58/58 in both modes |
| `forecasts-a11y.mjs` (axe, WCAG 2.1 AA) | 56 runs, **0** violations |
| axe on the Overview (390/1440 × light/dark) | **0** violations |
| WPI/IIP reproduction | 60/60 each, max difference 5.1e-13 (unchanged) |

**Tests changed on purpose:**

* 4 Overview tests asserted the removed controls (checkboxes, modes, GDP toggle). They were replaced by tests of the new
  behaviour.
* 3 checks in `forecasts-e2e.mjs` hard-coded "CPI unavailable". They now follow the API state and test both states.

No pre-existing failures were found.

Evidence:

* `reports/overview-cpi/` holds the before (production) and after screenshots, the fallback screenshots and the e2e/a11y JSON.
* `reports/cpi-linked/evidence.json` holds the data audit, integrity checks, sensitivity results and forecasts.

## 8. Not changed

* **Data:** no production DB, Render or Vercel action. No observation was written anywhere. The shared local DB was not
  written.
* **Stored runs:** WPI/IIP runs, scores and model selection are unchanged, and so are the 56 old CPI runs.
* **Rules and logic:** evidence and reliability rules, comparison grouping, chart components, the Indicators pages,
  Section 2 of the Overview, Overview cards and GDP logic.
* **Scope:** no new model family and no new dependency.
