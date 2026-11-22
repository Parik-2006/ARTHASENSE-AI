# GDP: data status and ingestion

**Status (2026-11-22): ingestion implemented and verified locally; NOT loaded into production.**
`pipeline/ingest/nas.py` loads quarterly real GDP (level + official YoY growth) and real GVA for MoSPI's nine industries
(level + official YoY growth), base 2022-23, from `api.mospi.gov.in/api/nas/getNASData` (indicator codes 5, 22, 1, 21; the
`constant_price` field). The API serves it at `GET /api/v1/indicators/gdp` and `/gdp/gva` (404 when not stored). It was run
twice into the isolated local database `arthasense_gdp` (300 observations, second run 0 inserted). Production has no GDP until
the database release is approved (`docs/PRODUCTION-DATABASE-RELEASE-PLAN.md`), so the live site shows "not available yet".
Details and audit: `docs/FINAL-OVERVIEW-INDICATORS.md`. The open questions below were settled as follows: the level code is
5 (₹ crore, constant prices); growth is code 22 (%), official; the series is treated as not seasonally adjusted (no QoQ);
the API gives no publication date. Coverage: levels 17 quarters, official growth 13 quarters (no 2022-23 back series yet).

## Earlier notes (kept for the record)

## What is verified (from the government-source audit, 2026-11-21)
- MoSPI's eSankhyiki API serves National Accounts (NAS): `GET https://api.mospi.gov.in/api/nas/getNASData` with required
  `base_year`, `series`, `frequency_code`, `indicator_code`, `Format` (swagger manual `swagger_user_nas.yaml`, commit `5317aa0`).
- A live call with `base_year=2022-23&series=Current&frequency_code=Quarterly&indicator_code=22&Format=JSON` returned **13 quarters**
  (FY2023-24 Q1 to FY2026-27 Q1, per `docs/m1-data-verification.md`). Fields: `base_year, series, year, indicator, frequency, revision, quarter, current_price, constant_price, unit`.
- Values arrive as strings with a `%` sign. A `revision` field exists and must be stored with every release.
- The official back series on the 2022-23 base was **not yet published** (promised by Dec 2026): history is 13 quarters only.

## What is NOT verified (must be settled before ingestion)
1. **Which `indicator_code` gives real GDP at constant prices as a LEVEL** (₹ crore). Code 22 returned growth percentages in the earlier check. Use the MCP
   `get_metadata NAS` call to list codes; do not guess.
2. Whether the series is seasonally adjusted (assumed **not**; the UI then computes no quarter-on-quarter change).
3. Official annual (fiscal-year) GDP growth: not looked up; the UI shows none.
4. A per-dataset publication URL and release date (the API gives none).

## Required work (backend, not done)
1. Adapter `pipeline/ingest/gdp.py` following `wpi.py`: validate fields and base year inside every record (the API silently
   answers an invalid `base_year` with another base), strip `%`, one snapshot per release, `revision` preserved, missing = not stored (never 0).
2. Series codes such as `mospi.nas.2022-23.india.gdp_real.level` and `...growth_yoy`; quarter stored on its first month (Apr, Jul, Oct, Jan).
3. Endpoint `GET /api/v1/indicators/gdp?limit=N` returning the contract in `apps/web/src/lib/gdp.ts` (`indicator`, `base_year`, `frequency:"quarterly"`,
   `unit`, `seasonally_adjusted`, `observations[{fiscal_year, quarter, level, growth_yoy, *_source}]`). Until it exists the API answers 404 and the page shows "not stored".
4. Tests for idempotency, revisions and a missing quarter; a local dry run and a read-only production preview before any import (approval needed).

## Frontend rules already enforced (tests in `lib/gdp.test.ts`, `lib/overview-v3.test.ts`)
- Quarterly only: no monthly GDP is drawn, filled in or interpolated. Fiscal quarters: Q1 = Apr-Jun.
- Year-on-year is computed only against the same quarter a year earlier; quarter-on-quarter is never computed for a non-seasonally-adjusted series.
- Mixed-frequency comparison: selecting GDP makes the comparison quarterly; monthly indicators enter as the average of three stored months in the fiscal quarter, only if all three exist.
  Monthly mode is replaced with an explanation. Raw levels are never plotted on one axis.
