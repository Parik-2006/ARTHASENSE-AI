# Government economic data foundation (branch `govdata/foundation`)

Branched from `c2be85e` (the merged Overview V2 + Indicators V2 tip, identical on `main`, `parik`, `parik2`).
Everything below was run against the **local Docker PostgreSQL only**. Nothing was written to Supabase.

## 1. What already existed (not rebuilt)

| Need | Already in the repo |
|---|---|
| Source identity, series + base year, release identity, linking factors | `sources`, `series`, `releases`, `linking_factors` (migration 0001) |
| Artifact metadata, checksum, retrieval time | `releases.source_url`, `content_sha256`, `retrieved_at` |
| CPI / WPI / IIP adapters, validation, retries, pagination | `pipeline/ingest/{cpi,wpi,iip}*.py`, `common.py` |
| Idempotent snapshot writes | `store_common.store_snapshot` (content-hash release keys) |
| Resumable multi-year backfill | `pipeline/ingest/history.py` |
| Read-only import preview | `pipeline/ingest/preview.py` |
| Indicator API (latest snapshot per month, base years kept apart) | `services/api/app/indicators.py` |

## 2. What this branch adds

| Addition | File |
|---|---|
| Shared **local-only host guard** for every ingestion write path (history, single-indicator CLI, monitor, report). Remote hosts are refused unless named with `--allow-host`; the URL is never printed | `pipeline/ingest/safety.py` |
| **WPI 2011-12 validator fix**: that base spells fields `majorgroup` / `subgroup` / `sub_subgroup`; the old validator rejected the live response. Non-headline rows are still rejected | `pipeline/ingest/wpi_records.py` |
| **No silent overwrite**: an observation that already exists in the same release with a different value now raises `ConflictingObservation` (the old `DO UPDATE` could in principle overwrite) | `pipeline/ingest/store_common.py` |
| Migration **0003** (additive; no existing table altered): `ingestion_runs`, `quality_checks`, `freshness_policy`, views `observation_revisions`, `current_observations` | `db/migrations/0003_data_foundation.sql` |
| **Update monitor / scheduler** CLI: dry-run by default, advisory lock, run log, quality checks, freshness, revision detection | `pipeline/ingest/monitor.py` |
| **Coverage report** (read-only JSON) | `pipeline/ingest/coverage_report.py`, `reports/data-coverage-2026-11-21.json` |
| **API** `GET /api/v1/data/{coverage,sources,freshness,ingestion,revisions}` (degrades to `available:false` on a database without 0003) | `services/api/app/data_status.py` |

Migration system: the repo uses plain SQL files run by `db/migrate.py`. I added `0003` there instead of introducing
Alembic, to avoid two migration systems. **Decision for you:** if you want Alembic, say so and 0003 can be ported.

## 3. Official-source registry (verified this session, 2026-11-21)

| Indicator | Publisher | Dataset | How it is read | Bases ingested | Bases the source lists but we do not ingest |
|---|---|---|---|---|---|
| CPI | NSO, MoSPI | CPI All India / Combined / General; series Current + Back | MoSPI eSankhyiki REST `/api/cpi/getCPIData` | 2024 (Current), 2024 (Back, 2020–2024) | 2012, 2010 (group/item level) |
| WPI | Office of the Economic Adviser, DPIIT | WPI all commodities (headline) | same API, `/api/wpi/getWpiRecords` | 2022-23, 2011-12 | 2004-05, 1993-94 |
| IIP | NSO, MoSPI | IIP General + Mining, Manufacturing, Electricity (+ Water on 2022-23) | same API, `/api/iip/getIipData` | 2022-23, 2011-12 | 2004-05, 1993-94 |

Base-year lists come from the source's own `get*BaseYear` endpoints. Reachability (HTTP 200): `esankhyiki.mospi.gov.in`,
`www.mospi.gov.in`, `api.mospi.gov.in`, `rbi.org.in`. **`eaindustry.nic.in` (OEA) failed TLS verification from this machine
(incomplete certificate chain); I did not bypass verification, so it is NOT re-verified.** WPI values reach us through
MoSPI's API, and the UI must keep saying "OEA via MoSPI eSankhyiki", not "direct from OEA".

Not established (left blank, not guessed): per-dataset page URLs, publication calendars, publication lag, revision policy.
The API provides no publication date, no provisional/final flag and no revision notes. `freshness_policy` therefore holds
**assumed** lags, labelled as assumptions. Future: GDP/GVA (MoSPI `/api/nas`) and RBI (`/api/rbi`; RBI itself is the primary
source) are listed as *planned*, not implemented.

## 4. Coverage findings (local DB, after backfill)

Full detail: `reports/data-coverage-2026-11-21.json`. Latest five-year window per indicator:

| Indicator | Window | Best single series | Months | Second series |
|---|---|---|---|---|
| CPI | 2021-11 … 2026-10 | Back (2024 base) | 38 / 60 | Current (2024 base) 22 / 60 |
| WPI | 2021-11 … 2026-10 | 2011-12 base | 54 / 60 | 2022-23 base 43 / 60 |
| IIP | 2021-10 … 2026-09 | 2011-12 base | 54 / 60 | 2022-23 base 42 / 60 |

**No single comparable series covers the latest five years for any indicator.** The union of two bases does contain every
month, but it is two series. The report records `union_is_one_comparable_index: false`, and **0 official linking factors are
stored**: I did not derive one from the overlapping months, because an overlap ratio is not an official methodology.

Other findings:
- Zero missing months in any index series. Four IIP 2011-12 **official growth** series lack April 2021 (the source returned no value; stored as a gap).
- The legacy 2011-12 series have stopped updating at the source: WPI ends Apr 2026, IIP Mar 2026, while the 2022-23 series run to Oct / Sep 2026. Treat them as closed history.
- `published_at` is empty on every observation (not provided by the API).
- WPI 2011-12 Apr 2026 = 167.0 after Mar 2026 = 160.8 (+3.9 %). This is source data and is shown unchanged; the monitor's large-move check flags such moves for human review and never rejects or edits them.
- CPI Back series (60 months) is MoSPI's own back-cast onto the 2024 base; the UI keeps it as a separate segment, and so does this branch.

## 5. Local backfill performed (additive, idempotent)

```
python -m pipeline.ingest.history wpi --start-year 2012 --end-year 2026 --base-year 2011-12 --resume
python -m pipeline.ingest.history iip --start-year 2013 --end-year 2026 --base-year 2011-12 --resume
```
Added WPI 2011-12: 169 months (Apr 2012 – Apr 2026); IIP 2011-12: 159 months × 4 categories (Jan 2013 – Mar 2026), plus official
growth where given. Re-running inserted 0 rows and left every row unchanged. CPI was already backfilled by the earlier V2 work.

## 6. Update monitor (disabled everywhere; nothing is scheduled)

```
python -m pipeline.ingest.monitor                       # dry run: JSON report, writes nothing
python -m pipeline.ingest.monitor --apply               # local DB only; logs to ingestion_runs
python -m pipeline.ingest.monitor --only wpi:2011-12 --years-back 2
```
Behaviour (all covered by tests): dry-run opens a READ ONLY connection; `--apply` takes a PostgreSQL advisory lock so runs
cannot overlap (second run exits 3, `skipped_locked`); a source failure or changed format stores nothing for that target and
is reported while other targets continue; transient HTTP failures are retried with backoff; a revision is stored as a **new**
snapshot beside the old one (`observation_revisions` lists it, `current_observations` and the API serve the newest); a re-run
with no change adds nothing. To run it regularly, point a platform cron (or your own machine) at the dry-run first. I
deliberately did **not** add a GitHub Actions `schedule:` trigger or any credentials.

## 7. Validation (exact commands, results from this session)

| Check | Command | Result |
|---|---|---|
| Pipeline + DB migration + integration | `ARTHASENSE_TEST_DATABASE_URL=<local test db> python -m pytest pipeline/tests db/tests -q` | all pass (183 before this branch's tests; monitor, safety and report tests added after) |
| API | `cd services/api && python -m pytest tests -q` | 70 passed, 5 skipped |
| Web unit | `cd apps/web && npx vitest run` | 11 files, 198 passed |
| Types / lint / build | `npx tsc --noEmit`, `npx eslint src`, `npm run build` | clean / clean / success |
| Real-data render | local API + `next start`, fetched `/` | 200; Overview shows a "Base 2011-12" segment for WPI and IIP |

Only integration tests that need the throwaway test DB are skipped when `ARTHASENSE_TEST_DATABASE_URL` is unset.

## 8. Production import preview — NOT performed

I had no read-only production connection and did not use the Supabase tooling (it can write). Nothing was compared to or
written to production. Expected effect when you approve a preview (`pipeline.ingest.preview … --allow-host <host>` against a
read-only URL): new series `mospi.wpi.2011-12…` and `mospi.iip.2011-12…` (about 169 and 159×4 index rows plus growth rows),
CPI additions already described in `docs/INDICATORS-V2.md`, zero value changes expected on existing rows.

Downstream forecasting: `INDICATOR_SERIES` is pinned to the 2022-23 series codes, so new 2011-12 series cannot alter stored
forecasts, and no training runs. **Transfer tooling:** `db/verify_target.py` compares migration hashes and a fixed `DATA_TABLES`
list that excludes the new tables; the target must have `0003` applied before a hash comparison can match. I did not edit
those files (you have uncommitted changes in them).

## 9. Unresolved limitations

1. No five-year comparable single series exists for CPI/WPI/IIP (above). Official linking factors were not found in the API; a methodology document from MoSPI/OEA would be needed.
2. No publication dates, provisional/final flags or revision notes from the API.
3. OEA site TLS chain not verifiable here; per-dataset URLs unknown.
4. WPI commodity groups, CPI categories, 2004-05 / 1993-94 / CPI 2012 and 2010 bases not ingested.
5. WPI and IIP **detail pages** show only the current base; only Overview shows the 2011-12 segment (CPI has its own Back panel). A legacy-base panel for WPI/IIP detail pages is a frontend task.
6. `freshness_policy` lags are assumptions.

## 10. Next steps that need your approval

1. Provide a read-only production URL (or restore a copy) to run the preview; then decide on applying `0003` and the import there.
2. Decide Alembic vs. keeping the SQL-file migrations.
3. Decide whether to add the legacy-base panel to WPI/IIP detail pages.
4. Obtain official linking-factor documents if a single long series is wanted.
5. Choose where (if anywhere) the monitor should be scheduled; credentials for any production write are yours to create.
6. Review the uncommitted transfer files and the `DATA_TABLES` / migration-hash interplay noted above.
