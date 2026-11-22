# Release integration (branch `release/integration`)

Base `data/official-history` (`20c6691`) + merge of `audit/master-integration` (`ff495a7`, which already contains
`parik3` Forecasts V2 and `govdata/foundation`). Overview V2 and Indicators V2 were already in `c2be85e`.

## Conflicts and decisions
All five conflicts were in the Indicators UI. The series workspace (`?base=`) was kept; it replaces the audit branch's
separate Back/Legacy panels (removed with their fetch helpers and tests) and shows the same segments plus the archive
bases, always separate. The dashboard keeps both sides (series options and the Indicators -> Forecasts link). Two
discovery/audit packages coexist without overlap: `pipeline/discovery` (96 content-validated tests) and
`pipeline/sourceaudit` (70-case investigation with raw-evidence hashes).
Migrations 0000-0004 are unmodified; the committed files hash (newline-normalised, as `db.migrate` does) to exactly the
values recorded when they were applied, and each has a single commit.

## Government data
| Series | Verification |
|---|---|
| CPI 2012, WPI 2004-05, WPI 1993-94, IIP 2004-05, IIP 1993-94 | **Every stored month compared with the live source** (read-only preview): 156/142, 147, 197, 144, 207 rows unchanged, 0 revisions, 0 additions |
| CPI 2024 Current + Back, WPI 2022-23 and 2011-12, IIP 2022-23 and 2011-12 | Source-audit monitor dry runs (all compared rows identical) plus the 96-test suite's live-vs-database cross-checks |
`reports/import-manifest.json` hashes every stored series deterministically; nothing is `unverified`.

**F\*.** CPI 2012 rows for April and May 2020 carry `F*`; the API defines no such flag. MoSPI's own press releases and its
technical note on imputation state that CPI indices for those two months were imputed because the lockdown halted price
collection (imputed values are marked `@` in its tables). The match is noted as context only: ArthaSense stores `F*`
verbatim and does not claim it means the same thing.

**Linking factors.** CPI (0.5267 combined) is documented in MoSPI's own PDF and reproduces from stored data. WPI (1.53)
and IIP factors reproduce from stored data but their primary tables were not readable (OEA TLS failure; NSO page has no
numbers). **No factor is applied anywhere; every base stays a separate series.**

## Compatibility with the current production schema (proven, not assumed)
A database shaped like production (migrations 0000-0002 only, primary series only, CPI Jan-Dec 2025) was built locally and
served by the merged API. `/api/v1/data/*` degrades to `available: false`, extra series answer empty, and the web app shows
only the primary series with explicit notices. The merged frontend was also run against the **live production API**
(old backend): 17/17 browser checks. So deploy order (Vercel before Render) does not matter. Nothing in the workflows
ingests, migrates or trains (`ci.yml` runs tests on push to main; `verify-sources.yml` is manual).

## Production database release (NOT done; needs your approval)
No read-only production connection or restored snapshot was available, so no production schema/data comparison was
possible. Required before any production write: (1) a read-only URL or restored copy; (2) compare `schema_migrations`;
(3) `pipeline.ingest.preview ... --allow-host <host>` per series and diff against `reports/import-manifest.json`;
(4) verified backup; (5) apply 0003 then 0004 to a restored copy first; (6) approval for the real run.
Never run `db.transfer` against the shared local database as-is.

## Migration 0005 assessment (not created)
Candidate additive CHECKs: `period_date = date_trunc('month', period_date)::date` on observations, and `value > 0` for
`.index` series. Local probes show 0 violations today, but a positive-index CHECK is series-specific (rates may be zero or
negative), so it would need to be a trigger or a per-series check. Recommend the first-of-month check only, applied
`NOT VALID` then validated; not added in this release.

## Known limits
Overview's base selector is local state (not in the URL); Overview insights and forecast previews use the primary series.
