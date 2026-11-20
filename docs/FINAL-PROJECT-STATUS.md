# ArthaSense AI: final project status

State on 2026-11-20, after the approved activation. Nothing is committed to Git or pushed, and nothing is
deployed publicly. Everything runs locally at zero cost.

## A. Architecture

```
MoSPI eSankhyiki API (official data)
   -> pipeline/ingest        validate, hash, store as retrieval snapshots (never invents publication dates)
   -> PostgreSQL 16 (Docker) sources, series, releases, observations | forecast_runs, forecasts, scores
   -> pipeline/research      loader (no interpolation, no leakage), quality checks, deterministic exports
   -> pipeline/forecasting   models -> rolling-origin backtests -> metrics + intervals -> persistence -> report
   -> services/api (FastAPI) read-only: /api/v1/indicators/*, /api/v1/forecasting/*  (never trains a model)
   -> apps/web (Next.js)     server-side fetch only; the browser never calls FastAPI or MoSPI
```

## B. Phases

| Phase | Status |
|---|---|
| 1 Infrastructure | Done |
| 2 CPI ingestion | Done |
| 3 CPI dashboard | Done (HTTP/test verified; no browser check) |
| 4 WPI | Done |
| 5 IIP | Done |
| 6 Historical data, quality, exports, research loader | Done (CPI Back series dry-run verified only; not stored; splice opt-in and unused) |
| 7 Forecasting engine | Done and tested |
| 8 Persistence + dashboards | **Done and active on the development database** (migration 0002 applied 2026-11-20) |
| 9 QA, deployment docs, research draft | Done, except browser visual checks and verified references |

## C. Economic data (development DB, unchanged by activation)

| Series | Observations | Range | Latest |
|---|---|---|---|
| CPI index (base 2024) | 12 | Jan-Dec 2025 | 104.10 |
| WPI headline (base 2022-23) | 43 | Apr 2023-Oct 2026 | 113.3 |
| IIP (base 2022-23): General + 4 sectors, index and growth | 360 | Apr 2023-Sep 2026 | General 124.3, growth +6.7% |

Total 415. A SHA-256 over every (series, period, value, release) was identical before the migration, after the
suite, and after the full test run. Publication dates are unknown (the API gives none).

## D. Forecasting

* **Implemented and evaluated:** naive, seasonal naive, drift, ETS (damped trend), ARIMA(1,1,0), SARIMA, XGBoost.
* **Unavailable (never run, never produce numbers):** Chronos-2 and TimesFM 2.5 (need PyTorch plus a 0.5-1 GB
  approved download). Their inference code is untested.
* **Future forecasts stored (6 months, WPI and IIP):** naive, drift, ETS, ARIMA.
* **CPI is not evaluated:** 12 observations leave no valid backtest origin under the rules. No forecast is stored.
* **Rules:** at least 12 months training; at least 5 origins to report any metric; fewer than 12 origins is
  "indicative"; coverage needs at least 5 intervals; comparisons only on identical data and origins; unvalidatable
  horizons are refused.
* **Honest findings:** WPI jumped in 2026, so persistence baselines (drift/naive) were hardest to beat at 1-6 months;
  ETS was most accurate for IIP at 1-6 months; XGBoost did not beat naive on WPI at 1 month; simple-model
  intervals under-cover on WPI. All results are indicative (small samples, no significance tests).

## E. Database

Migrations 0000, 0001, **0002** applied. Forecasting records: **176 runs** (82 completed backtests: arima 14, drift 8,
ets 17, naive 17, sarima 3, snaive 17, xgboost 6; 86 skipped with reasons; 8 genuine-future forecasts),
**1,195 forecast rows**, **718 scores**. 23 read-only integrity checks pass (foreign keys, uniqueness, no
NaN/Infinity, ordered intervals, origin/target/step consistency, backtest actuals equal the stored government
values, future targets after the last observation, foundation models produced nothing, CPI not evaluated).
Re-running the whole suite stored 0 new rows. The experiment ids, run metadata and all 718 scores are identical
to the earlier test-database run.
Rollback if ever needed: `DELETE FROM forecast_runs WHERE suite = '<name>'` (forecasts and scores cascade).

## F. API (all verified on the dev server)

`GET /api/v1/forecasting/` models, series, runs, runs/{id}, forecasts, forecasts/latest, scores, comparison; plus
`/api/v1/indicators/` cpi, wpi, iip, iip/sectors. Validation gives 422, unknown run 404, an unmigrated database 503 with
a clear message. Slowest endpoint 0.42 s (`/runs?limit=200`, 120 KB). Page size is capped at 200.

## G. Website

HTTP 200 with real content and no error state on: `/`, `/indicators`, `/indicators/{cpi,wpi,iip}`, `/forecasting`,
`/forecasting/{cpi,wpi,iip}`, `/forecasting/comparison`, `/forecasting/experiments`, experiment detail, `/intelligence`;
`/forecasts` redirects. **Not verified in a browser** (no browser automation was available): chart rendering and
hover, model/horizon switching, sorting, CSV downloads, 400 px layout, console errors. Manual checklist below.

## H. Testing (final run)

* Python with the test database: **206 passed**, 0 failed, 0 skipped (26 are database-backed).
* Python without it: 180 passed, 26 skipped (the database-backed ones).
* Forecasting, leakage, research and API subset: 102 passed.
* Frontend: **80 passed**. TypeScript, ESLint, `ruff check`, `ruff format --check`, `compileall`: clean.
* Production build: passes (23 pages).

## I. Research

`docs/research/arthasense-ieee-draft.md` is a working draft. Tables 1-6 and 7 figures in
`docs/research/generated/` were regenerated from the development database and are byte-identical to the verified
test-database versions. 71 numbers quoted in the paper were machine-checked against the generated CSVs: 0
mismatches. The paper makes no claim of publication, evaluates no foundation model, and does not backtest CPI.
**All references are unverified placeholders**: see `docs/research/LITERATURE-TODO.md`.

## J. Remaining tasks (genuine)

1. Look at every page in a real browser (checklist: charts and hover, model/horizon selects, comparison filters,
   sorting, CSV downloads, 400 px width, console errors).
2. Find, read and verify the literature (8 placeholders).
3. Significance tests for model comparisons; more history (or an approved CPI back-series policy) for CPI.
4. Optional: install PyTorch and approve the Chronos-2 / TimesFM 2.5 download, then evaluate them.
5. Optional: commit the work to Git (nothing is committed) and decide on any deployment (`docs/DEPLOYMENT.md`).

## K. Production deployment state (probed 2026-11-20, before the fixes in this commit)

| Layer | Observed | Cause / action |
|---|---|---|
| Vercel `https://arthasense-ai.vercel.app` | pages served (HTTP 200) but every data section said "Unable to load"; `/status` showed `http://127.0.0.1:8000` | `ARTHASENSE_API_URL` is not set on Vercel: set it to `https://arthasense-ai.onrender.com` and redeploy |
| Render `https://arthasense-ai.onrender.com` | process up (`/docs` 200, `/health` 200 degraded); all data endpoints 503 | database unreachable: `Network is unreachable` to an IPv6 address on port 5432 = Supabase *direct* host; use the **Session pooler** URL |
| Supabase | **not verified**: connection never succeeded from Render; contents unknown | run `db.verify_target`, `db.migrate`, then `db.transfer` (dry run first) as in `docs/DEPLOYMENT.md` |

The code now: reads `ARTHASENSE_API_URL` with retries for a sleeping backend, enables TLS and pooler-safe settings for remote databases, hides
host/IP/port from `/health`, adds `/healthz`, adds an env-driven CORS allow-list, and ships `db.verify_target` / `db.transfer`.
Nothing was written to Supabase. The deployment is **not** complete until the three layers are verified together.
