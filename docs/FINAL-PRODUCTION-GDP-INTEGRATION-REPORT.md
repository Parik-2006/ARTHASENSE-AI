# Final production database + GDP integration report

Status legend: **DONE-LOCAL** completed locally · **VERIFIED-STAGING** proven on the isolated PostgreSQL 17 replica ·
**APPROVED** approved by the owner for production · **EXECUTED-PROD** run against production · **VERIFIED-LIVE** checked on the live site.
**Final state (2026-11-22, 22:30 IST): the approved migrations and import were executed in production and verified on the live API and website.**

| Step | Status |
|---|---|
| Local database audit (50 series / 3,429 observations) | DONE-LOCAL |
| Production read-only audit (identity, migrations, exact counts, row-level conflicts) | DONE (read-only, approved access) |
| Staging replica byte-identical to production | VERIFIED-STAGING |
| Migrations 0003 + 0004, rerun safe | VERIFIED-STAGING |
| Official import (run 1: +3,014; run 2: +0) and 14 integrity checks | VERIFIED-STAGING |
| Data rollback returns exactly to the baseline fingerprint | VERIFIED-STAGING |
| API ↔ database 50/50 series; browser 56/56 on the post-import replica | VERIFIED-STAGING |
| Production backup + test restore | **DONE (read-only): checksum OK, restore matches the baseline on all 8 tables** |
| Fresh pre-import read-only audit | DONE: production unchanged (all 8 fingerprints = baseline); staging re-run inserts 0 (no new MoSPI data) |
| Production migrations 0003 + 0004 and import | **APPROVED** by the owner → **EXECUTED-PROD**: +3,014 observations, all steps exit 0 |
| 14 post-import integrity checks on production | **EXECUTED-PROD: 14/14 pass** |
| Live API (CPI, WPI, IIP, GDP, GVA) | **VERIFIED-LIVE**: GDP HTTP 200, 17 quarters; API = database for 50/50 series |
| Live website browser suite | **VERIFIED-LIVE: 56/56** on https://arthasense-ai.vercel.app |

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

## 3a. Production backup (2026-11-22 16:24 UTC) — verified
* Connection: `P:\ArthaSense-AI\.prod.env` (outside the repo, never printed), Supabase **session pooler**
  `aws-1-ap-northeast-1.pooler.supabase.com:5432`, user `postgres.yqcscbxiprinmejslilt`, SSL, read-only session
  (`default_transaction_read_only=on`). Identity: PostgreSQL 17.12, migrations 0000–0002 with the repository hashes, counts
  1 / 12 / 9 / 415 / 176 / 1,195 / 718 = the baseline.
* Backup: PostgreSQL 17 `pg_dump --format=custom --no-owner --no-privileges` of the whole database →
  `P:\ArthaSense-AIackupsrthasense-prod-20261122T162405Z.dump` (411,835 bytes), SHA-256 file alongside,
  `sha256sum -c` **OK**; `pg_restore --list` shows all 9 public tables' data.
* Test restore: public schema into an isolated PostgreSQL 17 container (`arthasense-restoretest17`). Fingerprints of all 8
  data tables **equal the production baseline**, migrations 0000–0002 with matching hashes, 0 orphan forecasts/scores
  (`…dump.restore-check.txt`). Note: fingerprints must be taken with `extra_float_digits=0` (Supabase's setting);
  under PostgreSQL's default the same doubles render with more digits.
* Recovery: `pg_restore --clean --if-exists --no-owner --schema=public -d <restored project or new database> <dump>` (data
  tables), or Supabase dashboard backups/PITR; then point `ARTHASENSE_DATABASE_URL` on Render at it.

## 4. Production release plan (backup verified; awaiting approval)
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

## 7. Production execution (approved 2026-11-22) — actual results
**Pre-write reconfirmation (read-only):** host `aws-1-ap-northeast-1.pooler.supabase.com`, user of project `yqcscbxiprinmejslilt`,
PostgreSQL 17.12, migrations 0000–0002 with repository hashes, all 8 table fingerprints = baseline.

**Executed** (`tools/import_plan.py`, log `reports/production-import-run.json`; every step exit 0):

| Step | Inserted |
|---|---:|
| `db.migrate` | applied `0003_data_foundation`, `0004_source_artifacts` |
| CPI current 2025–2026 | 20 |
| CPI back series 2013–2024 | 276 |
| CPI 2012 base 2013–2025 | 298 |
| WPI 2022-23 | 0 (already present) |
| WPI 2011-12 / 2004-05 / 1993-94 | 169 / 147 / 197 |
| IIP 2022-23 | 0 (already present) |
| IIP 2011-12 / 2004-05 / 1993-94 | 1,256 / 144 / 207 |
| NAS GDP/GVA (base 2022-23) | 300 |
| **Total** | **3,014** (= the approved delta: CPI 594, WPI 513, IIP 1,607, GDP/GVA 300) |

**Post-import verification on production** (`tools/verify_import.py`, `reports/production-import-verification.json`): 14/14 checks pass —
forecast_runs, forecasts, scores, linking_factors unchanged; the pre-existing 1 source / 12 series / 9 releases / 415 observations
byte-identical to the backup baseline; no duplicates; no orphans; GDP/GVA quarterly only; zeros only the 4 published 0.0 IIP
figures; every verified local series/period present with the same value; nothing extra.

**Final production database:** 50 series · 126 releases · **3,429 observations** (CPI 6 series / 606, WPI 4 / 556, IIP 20 / 1,967,
GDP/GVA 20 / 300) · forecast_runs 176 · forecasts 1,195 · scores 718 · migrations 0000–0004.

**Live API** (`https://arthasense-ai.onrender.com`): `/health` ok. CPI current Jan 2025–Oct 2026 (22), back 2013–2024 (144),
2012 base 2013–2025 (156); WPI 2022-23 (43), 2011-12 (169), 1993-94 (197); IIP 2022-23 (42), 2011-12 manufacturing (159),
2004-05 (144). **`/gdp`: HTTP 200**, 17 quarters Q1 FY2022-23 … Q1 FY2026-27 (periods Jan/Apr/Jul/Oct only), 17 levels, 13 official
growth values, latest ₹81,36,153 crore and 7.8%, base 2022-23, ₹ crore, not seasonally adjusted, MoSPI NAS source URL, release key,
retrieval time (publication date null: not provided by the API). **`/gdp/gva`: HTTP 200**, 9 official industries × 17 quarters
(e.g. Q1 FY2026-27 growth: agriculture 3.6, mining −2.4, manufacturing 9.2, financial 12.1, total GVA 8.2).
`tools/api_db_consistency.py` live API vs production database: **50/50 series, 3,429 observations identical**
(`reports/production-api-db-consistency.json`).

**Live website** (`https://arthasense-ai.vercel.app`, deployed code `841ef95`, no redeploy needed): browser suite **56/56**
(`reports/live/final-e2e-full.json`, screenshots `reports/live/ui/`): Overview 3 sections, GDP card 7.8% Q1 FY2026-27, Section 2 GDP
growth and **Level** view, comparison switching to quarterly with GDP; four tabs × two charts all drawn with live data; CPI 2012
2M…All = 2/3/6/12/24/36/60/156 months; custom range; year buttons 2022–2026; F* flags; WPI 2011-12 5Y; IIP sector selector
(manufacturing); GDP 1Y = 4 quarters; GDP calendar year 2025; GDP 2M message; GVA measure selector (agriculture); rapid switching;
keyboard; 8 pages × 360/390/768/1024/1440/1920 px with no overflow; no console errors.

**Clean-up:** the two local containers holding copies of production data (staging replica and restore test) were removed; the
verified dump stays at `P:\ArthaSense-AIackups\` (outside the repository).

**Git / deployment:** no application code changed; nothing pushed or deployed in this step. Local commits on
`feature/final-overview-indicators` beyond `origin/main` (`841ef95`): tooling, reports and this document only.

**Rollback (if ever needed):** `tools/prod/rollback_data.sql` (removes everything with id above the baseline maxima: release 9,
series 20, observation 415; tested on staging), schema rollback in `docs/PRODUCTION-DATABASE-ROLLBACK.md`, or restore
`arthasense-prod-20261122T162405Z.dump`.

**Remaining limitations:** official GDP growth covers 13 quarters (no 2022-23 back series yet); WPI inflation is calculated
(the source publishes the index only); new MoSPI releases are not loaded automatically (run the same import plan after approval).
