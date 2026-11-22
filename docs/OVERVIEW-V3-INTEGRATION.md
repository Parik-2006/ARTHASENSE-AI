# Overview V3 integration (branch `release/overview-v3`)

Base: `origin/main` `40524b3` (data platform + Forecasts V2 + audit/foundation). Merged: `overview/v3` `265a15b`
(built on the older `c2be85e`, pushed to `origin/overview/v3` unchanged).

## What was done
- One conflict, in `apps/web/src/lib/api.ts`: kept V3's `getGdp()`; dropped the obsolete `getBackSeries` (series switching now
  lives in the shared registry `lib/series-options.ts` + `loadAllSeries`). Nothing from the newer data platform was reverted.
- V3 reads the same loader as the Indicators pages, so its base selector (`?base=`), segments (CPI current / 2012 legacy /
  back series; WPI and IIP legacy and archive bases) and source metadata come from the same API and database.
- **Defect found and fixed:** V3's CSV and source panel used the *primary* series' identifier even when a legacy base was
  selected. They now use that series' own ids (CPI 2012 exports `mospi.cpi.2012…`, base 2012). 2 regression tests added.
- Lint: `tools/overview_v3_audit.py` made ruff-clean.

## Requirement check (browser, staged expanded database; 31/31)
| Requirement | Result |
|---|---|
| Exactly three main sections (`indicators`, `changes`, `compare`) | verified |
| Four cards CPI, WPI, IIP, GDP with API values | verified (WPI 113.30, IIP 124.30 equal Indicators) |
| Click-to-expand, one at a time, `?open=` URL, Back/Forward | verified |
| 6M/1Y/2Y/3Y/5Y on CPI base 2012 | exactly 6/12/24/36/60 months, ending Dec 2025 |
| WPI 2011-12 5Y | 60 months, May 2021 – Apr 2026 (anchored to that series' last month) |
| Custom range (IIP 2011-12, Apr 2019 – Mar 2020) | 12 months |
| Short history never padded | CPI current 5Y shows the 22 stored months and says so |
| Base-year selection + warning that bases are never joined | verified |
| CSV provenance | own series id, base year, release key, retrieval time |
| Source citation with series id and official links | verified (details open on demand) |
| Section 2 official vs calculated; GDP honest | verified |
| GDP unavailable state | card, expanded view and Compare section say GDP is not ingested; no figure, no CSV |
| Overflow 360/390/768/1024/1440/1920, console errors | none |

## GDP
`lib/gdp.ts` (parser, quarterly handling), `lib/gdp.test.ts`, `docs/GDP-INGESTION.md` and `getGdp()` were verified. The API has
no GDP endpoint, so `getGdp()` maps the 404 to "not stored"; nothing supplies a value of its own. **GDP is not ingested and
the site says so.** Nothing here treats GDP as available.

## Also verified on the final build
Indicators (11 series) 65/65 · Forecasts V2 56/56 (stored forecasts, experiments and filters untouched) · production-shaped
old schema 17/17 · live production API (old backend) 17/17 · backend-down state clean on every page including `/?open=gdp`.
Unit/lint: 296 frontend tests, ESLint, `tsc`, 319 Python tests (isolated test DB), `ruff check` and `ruff format --check`.

## Limits
Overview insights and forecast previews use the primary series. Production still has only its primary history until the
database release is approved, so the live Overview shows that shorter history.
