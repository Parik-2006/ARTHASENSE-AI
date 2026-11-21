# Database and production safety audit

Local checks: Docker PostgreSQL, 2026-11-21, read-only queries unless stated. Production: **public API GET requests only** (no
database connection, no credentials, no Supabase tooling). Nothing was written to production.

## 1. Local schema (migrations applied: 0000–0004)

| Table | Rows | Role | Key constraints (verified from the catalogue) |
|---|---|---|---|
| `sources` | 1 | one publisher row: `mospi` | UNIQUE(code) |
| `series` | 30 | series identity + base year in `code` | PK, UNIQUE(code), FK source, CHECK(frequency) |
| `releases` | 125 | one row per retrieved snapshot | UNIQUE(source_id, release_key), `retrieved_at` NOT NULL, `published_at` nullable |
| `observations` | 3,129 | values | UNIQUE(series_id, release_id, period_date), FKs series + release; index `(series_id, period_date DESC)` |
| `linking_factors` | 0 | designed for factors | FK old/new series, CHECK(factor > 0) |
| `forecast_runs / forecasts / scores` | 176 / 1,195 / 718 | forecasting | unique experiment id, finite-number CHECKs, UNIQUE(run, metric) |
| `ingestion_runs`, `quality_checks`, `freshness_policy` (0003) | 0 / 0 / 3 | monitor logs and policy | status CHECKs |
| `source_artifacts` (0004) | 0 | raw-response evidence per release | UNIQUE(release, raw_sha256, url), `raw_sha256` format CHECK |

Views: `current_observations` (newest snapshot per series-month), `observation_revisions`.

### Integrity probes (all passed)
Non-first-of-month periods 0 · non-positive index values 0 · releases without observations 0 · series without observations 0 ·
releases without checksum 0 · `published_at` set on any release 0 (the API supplies none) · every series has a base year.
Timestamps are `timestamptz`; values are unrounded `numeric`; a missing value is **not stored** (never 0).

### Gaps in the design (findings)
| # | Finding | Severity |
|---|---|---|
| 1 | **First-of-month and positive-index rules are enforced only in code**, not by CHECK constraints | Medium |
| 2 | A single `sources` row: WPI (publisher OEA, DPIIT) is recorded under source `mospi`. The distinction lives in the registry and UI text only | Low |
| 3 | `linking_factors` needs an `old_series_id`; the old CPI series is not stored by this branch, so no factor could be stored without creating a metadata-only series row (needs your approval) | Medium |
| 4 | `content_sha256` is the hash of the **validated records**, not the raw bytes. Migration 0004 adds raw hashes; **wiring covers `monitor --apply` and `history` only**, not the single-indicator CLIs. No pre-existing release has artifacts (`source_artifacts` is empty until new snapshots are fetched) | Medium |
| 5 | No release has `published_at`; there is no source for it | Info (source limit) |
| 6 | `observations.status` holds `retrieved` (2,831), `source_final` (296) and `source_status_F*` (2). The last two come from **another worktree's** CPI-2012 loader; the `*` value is unexplained and I did not investigate or change it | Low, needs owner |
| 7 | Query plan for the API's main read is an index scan, 0.5 ms for 169 rows; larger histories were not load-tested | Info |

## 2. Migrations 0003 and 0004: compatibility

Both are additive: `CREATE TABLE`, `CREATE VIEW`, one `INSERT` into `freshness_policy`. No existing table, column or row
is altered, so existing API reads keep working. Applied locally and covered by tests (203 pipeline/db tests passed before this
audit's additions; the new evidence/linking/monitor tests pass).

**Production status (read-only evidence):** `GET /api/v1/data/coverage` → **404** on `arthasense-ai.onrender.com`, so this
code is **not deployed** there. Whether production's database has 0003/0004 could **not** be checked without a connection;
it is presumed not applied. The migration runner refuses to run if an applied file is edited, so **never edit 0003/0004
in place**.

## 3. Production vs local (public API, 2026-11-21)

| Series | Production | Local | Values on shared months |
|---|---|---|---|
| CPI Current index | 12 (Jan–Dec 2025) | 22 (to Oct 2026) | 12 of 12 identical |
| CPI Back | 0 | 144 | n/a |
| WPI 2022-23 | 43 | 43 | 43 of 43 identical |
| WPI 2011-12 | 0 | 169 | n/a |
| IIP 2022-23 (general) | 42 | 42 | 42 of 42 identical |
| IIP 2011-12 | 0 | 159 (+3 sectors) | n/a |

Only **index levels** were compared (official rates were not). Row/series/source counts in the production *database* are
unknown (no connection).

**Expected import (additive), from this branch's own series:** CPI Back ≈ 144 index + 132 inflation rows; CPI Current +10 index
months and +10 inflation; WPI 2011-12 +169; IIP 2011-12 ≈ 4 × 159 index + 4 × 155 growth. About **1,721 new observation rows**
plus roughly one release per fetched year. **Expected revisions: none** (all shared months identical). Duplicate handling:
re-running is a no-op (keys embed a content hash). Rows from the other worktree's series are **not** counted.

**Do-not-do list:** do not run `db.transfer` from the local database. It copies the *whole* source database, which now
includes this audit's rows **and the other worktree's unverified series**. `db/verify_target.py` hashes migrations and
uses a fixed `DATA_TABLES` list that excludes the 0003/0004 tables, so the target needs both migrations before a hash comparison can match.

## 4. Forecast dependencies in production
`INDICATOR_SERIES` / forecast registry is pinned to CPI Current, WPI 2022-23, IIP 2022-23. The import adds only *other*
series, so stored forecast runs cannot change. Nothing here triggers training.

## 5. Backups and rollback

Before any production import (not performed): take a managed Supabase backup (point-in-time or `pg_dump` of the data tables
via an approved read path) and record the production `schema_migrations` and counts.
Rollback is by **release**: each import is keyed `mospi-<indicator>-<base>-<year>-<hash>`; delete that release's
observations, then the release row, then unused series rows. The local-only recipe for undoing this audit's local writes:
1. Delete `observations`/`releases` whose key starts `mospi-wpi-2011-12-`, `mospi-iip-2011-12-` and the CPI Back releases for 2013–2019 (`mospi-cpi2024-back-2013-…` to `-2019-…`).
2. Delete the empty series rows. 3. `DROP TABLE source_artifacts; … 0004` then 0003 objects, and remove their `schema_migrations` rows.
**Do not run it without checking what the other worktree has written** to the same database.

## 6. Raw-evidence retention
Raw bytes live in `data/evidence/raw/<sha256>` (git-ignored; about 1.2 MB for the 70 discovery cases). Recommended: keep at least the
latest and the first snapshot per release for 2 years; archive to private object storage, never Git. Hash columns are in
`source_artifacts`.

## 7. Import dry-run plan (needs your approval and a read-only production URL)
1. Provide a read-only connection (or a restored copy). 2. `python -m pipeline.ingest.preview <ind> --start-year Y --end-year Y --allow-host <host>` per series.
3. Review: additions only, zero revisions. 4. Approve migrations 0003/0004 on production. 5. Apply with `history … --resume --allow-host <host>` one series at a time.
6. Confirm counts equal the plan. No step above has been run against production.

## 8. Unresolved risks
Critical: two sessions are writing the same local database (section 3, do-not-do). High: transfer tooling would copy
unverified data. Medium: findings 1, 3, 4 above. Low: 2, 6.
