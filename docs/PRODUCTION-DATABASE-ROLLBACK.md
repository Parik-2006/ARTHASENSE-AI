# Production database rollback procedure (prepared; not executed)

Both migrations are additive (`CREATE TABLE/VIEW/INDEX` and one `INSERT` into `freshness_policy`); no existing table or row
is altered, so existing reads keep working at every step. Each import is keyed by release (`mospi-<indicator>-<base>-<year>-<hash>`).

## Before the release
1. Verified backup (Supabase point-in-time or `pg_dump` of the data tables); record `schema_migrations` and counts.
2. Keep the pre-release commit for the code (`origin/main` `40524b3`; Vercel keeps previous deployments for instant rollback).

## Roll back imported data (keeps the schema)
Run in one transaction, review the counts, then commit.
```sql
BEGIN;
-- releases created by the import (keys for the imported series; adjust the list to what was applied)
CREATE TEMP TABLE r AS SELECT id FROM releases WHERE release_key ~ '^mospi-(cpi2012|cpi2024-back|wpi-(2011-12|2004-05|1993-94)|iip-(2011-12|2004-05|1993-94))-';
-- CPI current 2026 months arrive in releases 'mospi-cpi2024-current-2026-2026-...'
INSERT INTO r SELECT id FROM releases WHERE release_key LIKE 'mospi-cpi2024-current-2026-2026-%';
DELETE FROM source_artifacts WHERE release_id IN (SELECT id FROM r);
DELETE FROM observations WHERE release_id IN (SELECT id FROM r);
DELETE FROM releases WHERE id IN (SELECT id FROM r);
-- only series the import CREATES (legacy/archive/back bases); an empty series that existed before the release is kept
DELETE FROM series s WHERE s.code ~ '^mospi\.(cpi\.2012\.|cpi\.2024\.back\.|wpi\.(2011-12|2004-05|1993-94)\.|iip\.(2011-12|2004-05|1993-94)\.)'
   AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.series_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM forecast_runs f WHERE f.series_id = s.id);
-- expect observations back to the pre-release count recorded in the backup notes
COMMIT;
```
Never touch `forecast_runs`, `forecasts` or `scores`: the import adds no series they depend on.

## Roll back the schema (only if required, after the data rollback)
```sql
BEGIN;
DROP VIEW IF EXISTS observation_revisions, current_observations;
DROP TABLE IF EXISTS source_artifacts, quality_checks, ingestion_runs, freshness_policy;
DELETE FROM schema_migrations WHERE version IN ('0004_source_artifacts', '0003_data_foundation');
COMMIT;
```
(Drop in dependency order as shown; verify no other object depends on them.) The migrator refuses to run if an *applied* file was
edited, so never edit 0003/0004 in place: fix forward with a new migration.

## Last resort
Restore the verified backup into a new project and repoint `ARTHASENSE_DATABASE_URL` on Render (a restart is automatic).
After any rollback: `/health`, `/api/v1/indicators/*`, the Overview and Indicators pages must show the previous (shorter)
history without errors; the web app is compatible with both schemas (proven on the old-schema rehearsal, 17/17).
