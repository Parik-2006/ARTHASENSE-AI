# Production database release plan (APPROVAL REQUIRED; nothing here has been executed)

**Status: BLOCKED on production evidence.** No read-only production connection or restored snapshot exists in this
environment, and the Supabase variables available are of unknown privilege, so they were not used. The rehearsal below ran on a
*simulated* production profile (local database built from migrations 0000-0002 plus the primary series). Public API
responses were treated as hints only; they do not prove database state.

## What was rehearsed (`reports/production-staging-rehearsal.json`)
1. Clone of the production-shaped profile: 415 observations, 176 forecast runs, 1,195 forecasts, 718 scores.
2. `python -m db.migrate`: applies `0003_data_foundation` and `0004_source_artifacts`; the migrator re-verifies the 0000-0002
   hashes; a second run applies nothing. Row counts unchanged. New objects: `current_observations`, `observation_revisions`,
   `source_artifacts`, `ingestion_runs`, `quality_checks`, `freshness_policy` (+ indexes), see `reports/production-schema-diff.json`.
3. Import with the real pipeline (`pipeline.ingest.history`, live MoSPI source, local-host guard): **2,714 observations inserted**.
4. Import repeated without `--resume` (full re-fetch): **0 inserted**. Idempotent.
5. Staged database vs `reports/import-manifest.json`: 30/30 series, 3,129/3,129 rows, every hash identical; 0 orphans,
   0 duplicates, 0 revisions, 0 non-first-of-month; `F*` preserved on exactly 2 months; the 415 pre-existing rows unchanged
   (415 identical, 0 conflicts).
6. API on the staged database answers all 30 series; browser suites passed (Overview V3 31/31, Indicators 65/65, Forecasts 56/56).

## Exact delta (against the simulated baseline only)
| Class | Rows |
|---|---:|
| Already present and identical | 415 |
| New and verified | **2,714** |
| Conflicting | 0 |
| Unverified (excluded) | 0 series |
| Missing dependencies / revisions | 0 / 0 |
The true production delta must be recomputed against a real snapshot: any shared month that differs is a *conflict* to
review, never overwritten. Linking factors applied: 0 (none are stored).

## Approval request (answer "approved" to the numbered steps you accept)
Prerequisite you provide: a read-only production connection string (SELECT-only role) **or** a restored copy of a
production backup, for step 1-3. No privileged credential is needed for the preview.
1. Compare production `schema_migrations` (versions and hashes) with the repository; confirm 0000-0002 only.
2. Run `python -m pipeline.ingest.preview <cpi|cpi2012|wpi|iip> ... --allow-host <host>` per series and diff against the manifest; expect
   additions only and 0 conflicts. Any conflict stops the release.
3. Take and verify a Supabase backup (point-in-time or `pg_dump`); record row counts of `observations`, `releases`, `series`.
4. Apply 0003 then 0004 to a **restored copy** first; run steps of the rehearsal; confirm the same numbers.
5. Approve: apply `0003` and `0004` to production, then run the import (`pipeline.ingest.history ... --resume --allow-host <host>`,
   one series at a time, additive, one release per year).
6. Post-release checks: `/api/v1/data/coverage` lists 30 series; the site's series switcher shows every base; spot-check CSVs.
Expected website change: Overview V3 and Indicators show CPI 2012 (156 months), CPI back 2013-2024, CPI current to Oct 2026,
WPI and IIP 2011-12 / 2004-05 / 1993-94, each as a separate series.
**Do not** run `db.transfer` against the shared local database as-is, and do not use production as a test environment.
