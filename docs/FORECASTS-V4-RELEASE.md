# Forecasts V4: production release record

Release: 2026-11-24/25. Branch `feature/forecasts-v4`, fast-forwarded into `main` (`873d704` → `41a53ae` → `b98a366` →
the UI polish and release-record commit). Frontend https://arthasense-ai.vercel.app · API https://arthasense-ai.onrender.com · Supabase
PostgreSQL 17.

## 1. Sequence

| Step | Result |
|---|---|
| Audit (read-only) and first backup `arthasense-prod-20261124T085029Z.dump` | counts 3,429 / 204 / 1,639 / 934; restore fingerprints identical to 2026-11-23 |
| Implementation, local validation on an isolated PG17 restore (`v4dev`) | see §3 |
| Rehearsal on a **fresh** PG17 restore of the same dump, using the release tool (`tools/prod/forecasts_v4_import.py`) | 161 new runs; 15/15 integrity checks; **identical, value for value, to the independently trained dev runs** (reproducibility) |
| Push `feature/forecasts-v4`; fast-forward `main` (`origin/main` was `873d704`, verified ancestor) | no force push, no history rewrite |
| GitHub CI on `41a53ae` | **success** (run 45430281862: ruff, ruff format, pytest with PostgreSQL, ESLint, typecheck, vitest, next build) |
| Render (API) and Vercel (web) auto-deploy from `main` | both live: `/api/v1/forecasting/model-status` 200, `/forecasting/gdp` 200; legacy runs served with correct labels |
| Fresh backup immediately before the import `arthasense-prod-20261124T155122Z.dump` | readable, restored into isolated PG17, fingerprints identical to the baseline |
| Production baseline (`forecasts_v4_verify.py baseline`) | max run id 204; observations md5 `99136c7c…` |
| Production import, attempt 1 | CPI stored (28 new + 12 existing). WPI's batch was **rolled back, nothing written**: the CLI held one connection in one implicit transaction across ~25 min of training and the Supabase pooler closed it. The process was then stopped by the machine's low-memory guard. Production was checked read-only: only CPI's 28 runs present (232 runs) |
| Fix `b98a366` | data read on one short connection; each batch stored on a fresh autocommit connection, every run committing on its own; tested on a fresh restore (GDP 53 runs persisted); CI success (run 45521075814) |
| Production import, attempt 2 (`--only wpi,iip,gdp`, idempotent) | WPI 40, IIP 40, GDP 53 stored; exit 0 |
| Production verification (`forecasts_v4_verify.py check --reference` = rehearsal) | **15/15**: official data and the 204 pre-existing runs/forecasts/scores byte-identical; 161 new runs **identical value for value to the rehearsal** (same experiment ids, statuses, forecasts and scores) |
| Live browser verification (Vercel + Render, production data) | V4 suite **113/113**; V3 Forecasts **58/58**; Overview/CPI **366/366**; accessibility **0 violations** (56 runs); same numbers as the rehearsal on every card (CPI Drift 112.05, WPI SARIMA 115.12, IIP ARIMA 127.35, GDP Drift ₹86.29 lakh cr) |
| Polish after live review | GDP figures kept on one line in the four-column Outlook (unit no longer wraps); browser tours wait for the card to settle before clicking (automation could otherwise click the spotlighted link while the card re-measured) |

No migration was needed or applied (0000–0004 unchanged). The CI workflow runs only on `main` and pull requests and no
`gh` CLI was available to open a PR, so CI ran on `main` after the fast-forward; every CI command had passed locally
first, and the production **data** import was gated on CI success and both deployments being verified.

## 2. Database counts

| Table | Before | After | Change |
|---|---|---|---|
| observations | 3,429 | 3,429 | 0 (official data untouched; fingerprint identical) |
| forecast_runs | 204 | 365 | +161 |
| forecasts | 1,639 | 4,673 | +3,034 |
| scores | 934 | 1,788 | +854 |

The 204 pre-existing runs, their 1,639 forecasts and 934 scores are byte-identical after the import (fingerprints compared).
New runs: 127 completed, 34 skipped with a stated reason (models or horizons without enough history, mainly GDP), 0 failed.

Rollback (not needed): delete the new runs by id > 204 (`DELETE FROM forecast_runs WHERE id > 204`; forecasts and scores
cascade). The backups above restore everything else.

## 3. Tests

| Suite | Result |
|---|---|
| Python: ruff check + ruff format | clean |
| Python: pytest (API contract, pipeline, DB migration/transfer, 33 new V4 scientific tests, integration on PostgreSQL) | 394 passed |
| Web: ESLint, `tsc` typecheck | clean |
| Web: vitest | 421 passed (13 new V4 tests) |
| Web: `next build` | success |
| Browser, V4 (`tools/e2e/forecasts-v4-e2e.mjs`, local build on the rehearsal-equivalent data) | 133/133: eight-model contract, four cards naming their model, selectors, quarterly GDP, Research view, CSVs, comparison, tours (keyboard, Escape, focus), 360–1920 px light/dark without overflow, API-down states, no console errors |
| Overview and Indicators unchanged | 12/12 full-page screenshots **pixel-identical** to a build of the previous `main` (6 pages × 1440 light / 390 dark) |
| Browser, V3 regression (`forecasts-e2e.mjs`) | 58/58 (tour step counts updated for the two new steps) |
| Overview/CPI regression (`overview-cpi-e2e.mjs`) | 366/366 |
| Accessibility (`forecasts-a11y.mjs`, axe-core WCAG 2.1 A/AA, 56 page/view/theme/width runs) | 0 violations |

Scientific validation covered by the tests: no look-ahead for all eight models (future values perturbed after an origin
never change that origin's forecast), identical origin sets within a suite, failures recorded as `failed`, AICc selection
inside the training window, deterministic RF/XGBoost for both strategies, seasonal period 4 for quarterly data,
quarterly gap detection, year-on-year growth against the same quarter a year earlier, interval ordering, the official
back-cast (factor, direction, join, provenance) and reproduction of the V1–V3 runs.

## 4. Known scientific limitations

* Backtests use the latest stored vintage, not real-time vintages (no revision history is stored for GDP; CPI/WPI/IIP
  final indices replace provisional ones).
* Multi-step origins overlap: 38 six-month WPI origins hold only about six independent six-month errors. Reliability
  labels are rule-based summaries, not significance tests.
* WPI/IIP training before April 2023 uses back-cast values that follow the old baskets' price movements (OEA, NSO caution).
  IIP's new General index also covers water supply, absent from the old one.
* IIP intervals over-cover (the 2020 collapse inflates variance): they are conservative, not tight.
* GDP: 17 quarters. Only baselines are evaluated beyond one quarter; SARIMA, Random Forest and XGBoost cannot be
  evaluated until much more 2022-23-base history (or an official back series) exists. Every GDP result is "limited".
* Random Forest and XGBoost 95% intervals need ≥ 19 calibration errors; at h = 12 and for short histories they are
  unavailable and the UI says so.
