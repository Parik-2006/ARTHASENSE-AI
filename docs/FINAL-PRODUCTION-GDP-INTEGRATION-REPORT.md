# Final production database + GDP integration report

Status legend: **DONE-LOCAL** completed locally · **VERIFIED-STAGING** proven on the isolated PostgreSQL 17 replica ·
**APPROVED** approved by the owner for production · **EXECUTED-PROD** run against production · **VERIFIED-LIVE** checked on the live site.
As of this report, **nothing has been written to production**, and no backup has been taken yet.

| Step | Status |
|---|---|
| Local database audit (50 series / 3,429 observations) | DONE-LOCAL |
| Production read-only audit (identity, migrations, exact counts, row-level conflicts) | DONE (read-only, approved access) |
| Staging replica byte-identical to production | VERIFIED-STAGING |
| Migrations 0003 + 0004, rerun safe | VERIFIED-STAGING |
| Official import (run 1: +3,014; run 2: +0) and 14 integrity checks | VERIFIED-STAGING |
| Data rollback returns exactly to the baseline fingerprint | VERIFIED-STAGING |
| API ↔ database 50/50 series; browser 56/56 on the post-import replica | VERIFIED-STAGING |
| Production backup + test restore | **BLOCKED: connection file `P:\ArthaSense-AI\.prod.env` not present yet** |
| Production migrations + import | NOT APPROVED, NOT EXECUTED |
| Live API / site with full data and GDP | NOT YET (production still has 415 observations, GDP 404) |

## 1. Initial production state (read-only, 2026-11-22)
Access: the Supabase connector, **SELECT only, every query inside `BEGIN TRANSACTION READ ONLY`** (the server confirmed
`transaction_read_only = on`). Project `ARTHASENSE_AI` (ref `yqcscbxiprinmejslilt`, region ap-northeast-1), the only
project on the account; PostgreSQL 17.12 = the version Render's `/health` reports. Role `postgres` (write-capable, hence
read-only transactions).

| Table | Rows (exact) |
|---|---:|
| schema_migrations | 3 (`0000`, `0001`, `0002`; SHA-256 equal to the repository files) |
| sources / series / releases | 1 / 12 / 9 |
| observations | 415 |
| linking_factors | 0 |
| forecast_runs / forecasts / scores | 176 / 1,195 / 718 |

Baseline content fingerprints (count + md5 of all rows, `COLLATE "C"` order) are in `reports/production-baseline-fingerprint.json`.
Baseline id maxima: releases 9, series 20, observations 415.

## 2. Exact delta (production export vs verified local database, `tools/prod_delta.py`, `reports/production-import-preview.json`)

| Indicator | Local rows | Production rows | Identical | Missing in production (to add) | Conflicts |
|---|---:|---:|---:|---:|---:|
| CPI | 606 | 12 | 12 | 594 | 0 |
| WPI | 556 | 43 | 43 | 513 | 0 |
| IIP | 1,967 | 360 | 360 | 1,607 | 0 |
| GDP/GVA | 300 | 0 | 0 | 300 | 0 |
| **Total** | **3,429** | **415** | **415** | **3,014** | **0** |

Production-only rows: 0 (nothing would be lost). Series metadata mismatches: 0. Release keys present in both: identical
content SHA-256. New series: 38 (CPI back + CPI 2012, WPI 2011-12/2004-05/1993-94, IIP 2011-12/2004-05/1993-94, 20 GDP/GVA).

## 3. Staging rehearsal (PostgreSQL 17.12, container `arthasense-staging17`)
* **Replica:** `tools/staging_replica.py` rebuilt production from a full read-only export (all 8 tables, original ids, exact
  NUMERIC scale). Fingerprints of all 8 tables equal production's (`reports/staging-replica-fingerprint.json`).
  Two traps found and fixed on the way: the connector's JSON normalises NUMERIC (`101.90`→`101.9`), so `value` is exported
  as text; and the fingerprint must sort with `COLLATE "C"`.
* **Migrations:** `python -m db.migrate` applied `0003_data_foundation`, `0004_source_artifacts`; second run "nothing (up to date)".
* **Import:** `tools/import_plan.py` (official pipelines, live MoSPI, `--resume`, host guard) — run 1 inserted **3,014**, run 2 **0**
  (`reports/staging-import-run1.json`, `-run2.json`).
* **Verification** (`tools/verify_import.py`, `reports/staging-import-verification.json`) — all 14 checks pass: forecast_runs,
  forecasts, scores, linking_factors unchanged; pre-existing sources/series/releases/observations rows byte-identical; no
  duplicates; no orphans; GDP/GVA quarterly only; zeros only the 4 published 0.0 IIP growth figures; every local series/period
  present with the same value; nothing extra. Result: 50 series, 126 releases, **3,429 observations** (CPI 606, WPI 556,
  IIP 1,967, GDP/GVA 300), migrations 0000–0004.
* **Rollback** (`tools/prod/rollback_data.sql`, run in a transaction then rolled back): counts back to 1/12/9/415/176/1,195/718 and
  the observations fingerprint back to the baseline `4353fe4f…`.
* **Website on the post-import replica:** `tools/api_db_consistency.py` 50/50 series, 3,429 observations; browser suite
  56/56 (Overview 3 sections, 4 tabs × 2 charts, all filters, year buttons, GDP 1Y = 4 quarters ending 7.8%, 6 viewports).

## 4. Production release plan (awaiting the backup, then approval)
1. **Backup** (read-only): `bash tools/prod/backup_and_verify.sh P:/ArthaSense-AI/.prod.env P:/ArthaSense-AI/backups`
   — PostgreSQL 17 `pg_dump` (custom format, whole database) into a folder outside the repo, SHA-256, test restore of the public
   schema into an isolated PostgreSQL 17 container, fingerprints compared with the baseline. Also note Supabase's own daily
   backup/PITR status in the dashboard.
2. **Fresh read-only re-check** right before writing: counts and fingerprints still equal the baseline (otherwise stop and
   recompute the delta).
3. **Write (needs explicit approval):**
   `python tools/import_plan.py --url-file P:/ArthaSense-AI/.prod.env --allow-host <production host> --log reports/production-import-run.json`
   = `db.migrate` (0003, 0004) then the 12 official ingestion steps (expected +3,014 observations, +38 series, +117 releases).
4. **Verify (read-only):** `TARGET_URL_FILE=P:/ArthaSense-AI/.prod.env python tools/verify_import.py reports/production-baseline-fingerprint.json reports/production-import-verification.json`
   and the live API: `/api/v1/indicators/{cpi,wpi,iip,gdp,gdp/gva}`; GDP must return observations instead of 404.
5. **Rollback if needed:** `tools/prod/rollback_data.sql` (data); schema rollback in `docs/PRODUCTION-DATABASE-ROLLBACK.md`;
   last resort: restore the step-1 dump.
Forecast models are not retrained. No frontend change is required for GDP to appear: the deployed code (`841ef95`) already
reads it.

## 5. Tests executed in this step
`ruff check .` / `ruff format --check .` clean; staging rehearsal and verification as above; browser suite 56/56 on the
post-import PostgreSQL 17 replica. The application test suites (346 Python, 326 frontend, lint, typecheck, build) passed on
`841ef95` in the previous step; no application code changed in this step (only `tools/`, `docs/`, `reports/`).

## 6. Remaining limitations
* Production writes require the backup and your explicit approval.
* MoSPI can publish a new month between rehearsal and the production run; step 2 catches that (new rows only; revisions
  arrive as new releases, never overwrites).
* Official GDP growth covers 13 quarters (no 2022-23 back series yet).
