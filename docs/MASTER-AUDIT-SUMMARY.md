# Master audit summary (2026-11-21)

## 1. Executive summary

- **70 source-investigation cases were executed** (71 live requests, ≥ 0.6 s apart, no TLS bypass). 43 returned data, 14 returned documents/metadata, 10 were empty, 2 were rejected (HTTP 400, both deliberate robustness probes), 1 failed TLS verification (OEA).
- **My previous report was wrong on two points and is corrected** (`GOVERNMENT-SOURCE-DISCOVERY.md` §0): official linking factors **do** exist, and CPI has an **official 60-month linked headline** (Back Jan 2013–Dec 2024 + Current). The CPI factor was verified from MoSPI's own PDF and reproduced exactly (0.5267). The WPI and IIP factors reproduce exactly from stored data, but their primary tables could not be read (level D).
- **WPI and IIP still have no single 60-month series**; the best is 54 months on the legacy base, which the source stopped updating in Mar/Apr 2026.
- **The API can silently answer an invalid `base_year` with a different base** (case 62). Ingestion is protected because it validates the base inside each record.
- **A second session is writing to the same local database and has built parallel work** (section 7). This needs your decision before anything is pushed or merged.
- No production write, deploy, retraining, force-push, merge or credential exposure occurred.

## 2. Git

| | |
|---|---|
| Worktree / branch | `P:\ArthaSense-AI\ARTHASENSE-AI-audit`, branch `audit/master-integration` |
| Base | `govdata/foundation` `bef0940` + `parik3` `41e95a0` (clean merge `9559436`) |
| Audit commit | the tip of `audit/master-integration` (`git log -1`); local only |
| Remote | **Not pushed.** The brief authorises isolated local work; it does not authorise pushing, and a parallel branch overlaps this one |
| Remote refs before/after | `main`, `master`, `parik`, `parik2` = unchanged; `parik3` `41e95a0`; `govdata/foundation` `bef0940` |
| Protected worktrees | `ARTHASENSE-AI` (parik, your 10 uncommitted changes), `-parik2`, `-parik3`, `-govdata`, **`-dataplatform` (another session's, uncommitted changes)**: none touched |

## 3. Files changed (this audit, on top of the merge)
New: `pipeline/sourceaudit/` (harness, 70 cases, runner), `pipeline/ingest/evidence.py`, `linking.py`, `pipeline/forecasting/impact.py`,
`db/migrations/0004_source_artifacts.sql`, `apps/web/.../legacy-base-panel.tsx` (+test), `tools/responsive_audit.py`,
`pipeline/tests/test_evidence_linking.py`, six docs, and reports (`government-query-matrix.csv`, `government-query-results.json`,
`forecast-data-impact.json`, `responsive-audit.json`, regenerated `data-coverage-2026-11-21.json`).
Modified: `coverage_report.py` (A–E matrix), `monitor.py` and `history.py` (raw-evidence capture), `indicators.ts`, `api.ts`,
`indicator-page.tsx`, `.gitignore`, `DATA-FOUNDATION.md` (correction).
Not modified: backend API code, migrations 0000–0003, forecasting models, `db/transfer.py` and the other transfer files.

## 4. Test results (actual commands)

| Command | Result |
|---|---|
| `python -m pytest pipeline/tests db/tests -q` (private test DB) | **213 passed** |
| `cd services/api && python -m pytest tests -q` (private test DB) | **75 passed** |
| `cd apps/web && npx vitest run` | **245 passed** (14 files) |
| `npx eslint src` | clean |
| `npx tsc --noEmit` | exit 0 (needs a prior `next build`: `LayoutProps` is generated) |
| `npm run build` with no API running | success |
| `ruff check .` | 9 findings, **none in code from this audit**: 5 in `preview.py`/`test_preview.py` (pre-existing), 4 in `test_regime_shift.py` (from `parik3`) |
| Chrome DevTools audit | 66 measurements, 0 overflow, 0 console errors; 9 interactions behaved as expected (`reports/responsive-audit.json`) |

**Failure encountered and its cause:** my first API run showed 3 failures. Another session's `pytest` was running against the same
`arthasense_test` database, which each run wipes and re-migrates. I created a private test database (`arthasense_test_audit`) and
the suites passed. **Anyone running the suites in parallel on the shared test database will see flaky failures.**

Skipped: none in the final runs (the test database is configured). Not run: browser tests of Forecasts filter combinations.

## 5. Database
Local: migrations 0000–0004 applied; 30 series, 3,129 observations, 125 releases; CPI Back backfilled 2013–2019 by this audit (156 rows: 84 index + 72 official inflation, which starts Jan 2014);
no value changed in any pre-existing series; monitor dry runs show every compared row identical to the source. Production
read-only comparison, plan and do-not-do list: `DATABASE-PRODUCTION-SAFETY.md`.

## 6. Official sources verified
`api.mospi.gov.in` (L), `mcp.mospi.gov.in` v2.3.0 (L; 4 tools; matches REST exactly), MoSPI CPI-2024 FAQ PDF (L), NSO IIP metadata
page (L, no numbers), `github.com/nso-india/esankhyiki-mcp` manuals (L). **Not verified:** `eaindustry.nic.in` (TLS), any
publication calendar, revision policy, publication dates.

Most useful discoveries: CPI Back to Jan 2013 with official factors; IIP **use-based** categories (6) in both bases;
WPI major groups; CPI-2012 `status` flag; `base_year` silent fallback; CSV unreliable; IIP April 2021 growth null at source.

## 7. Critical: a parallel session
Branch `data/official-history` (local only, `c1169e4`, 3 uncommitted changes) in worktree `ARTHASENSE-AI-dataplatform` is built **on
`govdata/foundation`** and adds a `pipeline/discovery/` suite, a CPI-2012 legacy adapter, 1993-94 / 2004-05 base support, new
API fields and web "series views". It wrote CPI 2012, WPI 2004-05/1993-94 and IIP 2004-05/1993-94 into the shared local database
during this audit, one observation status value (`source_status_F*`) I cannot explain, and it runs tests on the shared test DB.
It overlaps 22 of this branch's files (same topics: monitor, coverage report, data_status API, indicator pages). I renamed
my harness to `pipeline/sourceaudit/` to avoid a path clash, did not touch that worktree, and **did not verify its data or code**.
**Decision needed:** which line is canonical, and in what order to reconcile. Until then the shared local DB must be treated as
containing unverified rows, and `db.transfer` must not be run.

## 8. Outstanding issues
| Sev | Issue |
|---|---|
| Critical | Two sessions writing the same local DB and overlapping code (section 7) |
| High | Production lacks CPI Back, both 2011-12 series and the `/data/*` API; new panels show empty states there |
| High | WPI/IIP/CPI-2012 linking tables not readable in primary form (OEA TLS; NSO page lacks numbers) |
| Medium | DB does not enforce first-of-month/positive-index rules; `linking_factors` cannot store a factor without an old-series row; raw evidence only for new snapshots; no per-run model-library versions; all runs use `policy=latest` (not point-in-time) |
| Medium | Forecast filter combinations only unit-tested; stored WPI ARIMA/SARIMA h ≥ 3 scores may be affected by an explosive AR fit (recorded in `FORECASTS-V2.md`) |
| Low | Duplicate range helpers; CSV `release_key` blank; `tsc` needs a build first |

## 9. Approval requests (nothing below was done)
1. Push `audit/master-integration` (and in what order relative to `data/official-history`). 2. Production migrations 0003/0004. 3. Production data import (needs a read-only URL for the preview first). 4. Production retraining (none proposed). 5. Any scheduling. 6. Merge into `main` / deploy. 7. Storing linking factors (needs a metadata-only old-series row). 8. Training on a linked CPI. 9. Installing Chronos-2/TimesFM (~0.5–1 GB).

## 10. Recommended next phase
1. Reconcile the two parallel branches (one owner, one DB). 2. Obtain the OEA and NSO linking documents in primary form. 3. Add CHECK constraints (additive migration 0005). 4. Add use-based IIP and WPI major groups as new series. 5. Approved read-only production preview, then staged import. 6. Browser-level tests for Forecasts filters.
