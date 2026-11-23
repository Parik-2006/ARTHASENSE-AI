# Production release: Overview logo, 2026 comparison, CPI forecasts (2026-11-23)

Executed as planned in `docs/OVERVIEW-CPI-IMPROVEMENTS-REPORT.md` §6, in this order: code first, data last.
Evidence: `reports/overview-cpi/live/`.

## 1. Code

| Step | Result |
|---|---|
| `main` fast-forwarded `fc2282a` → `153f287` (no force, no history rewrite) | adds `72efb46`, `71652a1`, `153f287` |
| GitHub Actions CI on `153f287` | **success**: Web (lint, types, tests, build) and Python (API, pipeline, migrations) |
| Render (API, auto-deploy from `main`) | live; `/series` serves `training_history`. CPI was `ready_not_run` before the import |
| Vercel (web, auto-deploy from `main`) | live; serves `/logo.png` and the new Overview and Forecasts |

**Between deploy and import**, the live API was diffed against a capture taken before the deploy:

* 21 of 22 responses were identical: WPI/IIP comparisons, runs and forecasts, GDP, models, and the CPI comparison.
* The only change was CPI's `/series` entry (`insufficient_history` → `ready_not_run`).

## 2. Production database

**Safeguards, all passed before any write:**

1. **Target and schema.** The target is Supabase PostgreSQL 17.12. Its migrations `0000`–`0004` equal the repository's,
   so **no migration was needed**.
2. **Backup.** `tools/prod/backup_and_verify.sh` produced `arthasense-prod-20261123T153520Z.dump` (479,303 bytes).
   * The sha256 verified, and a strict `pg_restore --exit-on-error` into an isolated PG17 container succeeded with 34
     constraints.
   * Backups are kept in `P:\ArthaSense-AI\backups`, outside the repository.
3. **Production equals the experiment.** Production's linked CPI fingerprint is **`e9b1f3b6f3fbf346`**, identical to the
   local experiment: Back 144 + Current 22 months, 0 gaps, 0 overlap. No linked runs were stored yet.
4. **Dry run** of the exact command on the restored copy:
   * +28 runs, +444 forecasts and +216 scores; every other table was byte-identical;
   * the 176/1,195/718 existing rows had the same md5;
   * 0 orphans and 0 duplicate ids;
   * the experiment ids were identical to the verified set;
   * reproduction gave CPI-linked 28/28, WPI 60/60 and IIP 60/60, and the integrity checks were all 0;
   * a rerun inserted 0 rows;
   * the release build against that copy passed 366/366 and 58/58.
5. **Fresh backup just before the write** (`…155037Z.dump`): its fingerprint was identical to the dry-run baseline,
   proving production had not changed in between.

**Import:** `python -m pipeline.forecasting.cli suite --name all --indicator cpi --history linked --save --allow-host
<host>`, with the pinned stack (Python 3.12.4, statsmodels 0.15.0, numpy 2.5.5, pandas 3.1.1). It stored 28 runs.

**Before / after** (`production-fingerprint-before.txt` and `-after.txt`, taken from `…155500Z.dump`):

| Table | Before | After | Notes |
|---|---|---|---|
| sources / series / releases / observations / linking_factors | 1 / 50 / 126 / 3,429 / 0 | same | byte-identical md5 |
| forecast_runs | 176 | **204** | the 176 old rows are byte-identical |
| forecasts | 1,195 | **1,639** | old rows identical; the table md5 equals the dry run's |
| scores | 718 | **934** | old rows identical |

**Checks after the write**, on the post-import snapshot. The Supabase pooler ignores the read-only startup option, so the
read-only tools ran on a restored copy instead of on the live database:

* reproduction: CPI-linked 28/28, WPI 60/60, IIP 60/60 (max difference 5.1e-13);
* integrity checks: all 0;
* experiment ids and all 24 future values are identical to the verified set.

**Rollback** (not needed): delete the 28 runs by experiment id, scores first. See the report, §6 step 8.

## 3. Live verification (https://arthasense-ai.vercel.app against https://arthasense-ai.onrender.com)

| Check | Result |
|---|---|
| `overview-cpi-e2e.mjs`: logo, 2026 comparison, tour, CPI card and explorer, Research, comparison, Indicators, 6 widths × 2 themes | **366/366** |
| `forecasts-e2e.mjs`: cross-page values, controls, CSV, tooltips, tours at 360–1440 px, deep links, dark mode, console | **58/58** |
| `forecasts-a11y.mjs` (axe, WCAG 2.1 AA) | 56 runs, **0** violations |
| Overview axe (390/1440 × light/dark) | **0** violations |
| WPI/IIP/GDP API after the import | 19/19 identical to the pre-deploy capture. `/series` WPI/IIP differ only by the new `training_history: null`; `/models` counts rise only by the 24 CPI backtests |

**Live CPI** (Drift, origin Oct 2026, latest official 110.05):

| Month | Forecast | 80 % range | 95 % range |
|---|---|---|---|
| Nov 2026 | 110.38 | 109.70–111.06 | 109.34–111.42 |
| Dec 2026 | 110.72 | 109.75–111.68 | 109.24–112.19 |
| Jan 2027 | 111.05 | 109.87–112.23 | 109.24–112.86 |
| Feb 2027 | 111.38 | 110.01–112.75 | 109.29–113.48 |
| Mar 2027 | 111.72 | 110.18–113.25 | 109.36–114.07 |
| Apr 2027 | 112.05 | 110.36–113.74 | 109.47–114.63 |

**Comparison sets:** one rankable set per horizon, on 22/20/17 identical origins.

| Horizon | Lowest MAE | Naive baseline MAE |
|---|---|---|
| h = 1 | ARIMA 0.298 | 0.469 |
| h = 3 | Drift 0.856 | 1.280 |
| h = 6 | Drift 1.081 | 2.304 |

The scientific limitations are unchanged; see the report, §5.
