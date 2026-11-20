# Progress: Phases 7-9 (forecasting, dashboard, QA, research)

Resume from this file if the session is interrupted.

## State at the end of the activation session (2026-11-20)
**Activated on the development database** with explicit user approval: migration `0002_forecasting.sql` applied;
`suite --name all --indicator all --save` stored 176 runs / 1,195 forecast rows / 718 scores; observations still
415 (fingerprint identical); 23 integrity checks pass; re-run stored nothing; ids match the test-DB run.
Final status and handover: `docs/FINAL-PROJECT-STATUS.md`. Literature to verify: `docs/research/LITERATURE-TODO.md`.

## Stages
| # | Stage | Status |
|---|---|---|
| 1 | Audit (no prior forecasting code existed) | done |
| 2 | Interfaces, registry, eligibility | done, tested |
| 3 | Baselines: naive, seasonal naive, drift | done, tested |
| 4 | Statistical: ETS, ARIMA, SARIMA | done, tested |
| 5 | XGBoost (native API, lagged changes, recursive) | done, tested |
| 6 | Chronos-2 / TimesFM 2.5 | feasibility checked (metadata only); lazy adapters; **not run, inference path untested** |
| 7 | Rolling-origin backtesting, metrics, intervals | done, tested (leakage, alignment, reproducibility) |
| 8 | Migration 0002 + persistence | done; applied to dev |
| 9 | API `services/api/app/forecasting.py` | done, tested; unmigrated DB gives an explicit 503 |
| 10 | Frontend: /forecasting, /forecasting/{cpi,wpi,iip}, comparison, experiments(+detail) | done, HTTP-verified on dev; **no browser check** |
| 11 | /intelligence (template statements, hypothetical scenario) | done, HTTP-verified |
| 12 | Research experiments (3 suites x 3 indicators + future forecasts) | done; stored in dev; tables/figures regenerated from dev |
| 13 | QA / security / performance | done (see final report) |
| 14 | Deployment docs (`docs/DEPLOYMENT.md`, requirements-ml.txt) | done; nothing deployed |
| 15 | IEEE draft (`docs/research/arthasense-ieee-draft.md`) | draft; **all references are unverified placeholders** |
| 16 | Final verification | done; see final report |

## Rules (do not weaken)
* >= 12 months training before any evaluation; >= 5 usable origins to report any metric; < 12 origins = "indicative, not rankable".
* Coverage is reported only with >= 5 intervals behind it, and n is the interval count (not origins).
* One forecast_runs row = one (model, series, horizon). Comparisons only for identical (dataset, origins, horizon).
* CPI Current (12 months) is never evaluated; the CPI Back/Current splice stays opt-in and unused.
* Forecasts are index levels, never official rates; unavailable models never produce numbers.

## Pending
* Browser visual verification of every page (no browser tool was available).
* Verified literature and citations; significance tests; CPI back-series evaluation policy; foundation-model runs (needs approval to install PyTorch + download weights).
