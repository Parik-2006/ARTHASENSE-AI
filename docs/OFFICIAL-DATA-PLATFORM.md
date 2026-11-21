# Official data platform milestone (branch `data/official-history`)

Based on `origin/govdata/foundation` (`bef0940`, itself `c2be85e` + 2 commits). Forecasting work (`parik3`) is untouched.
Everything was run against the **local Docker PostgreSQL only**; nothing was written to Supabase and nothing was deployed.

## 1. What was delivered

| Requirement | Result |
|---|---|
| 60+ official-source tests | **96** content-validated tests (`python -m pipeline.discovery`): 92 verified, 3 empty, 1 failed. Report: `docs/GOVDATA-DISCOVERY.md`, `reports/discovery-2026-11-21.json` |
| Fullest official history for CPI/WPI/IIP | 11 stored series (table below), CPI 2012 legacy added, WPI/IIP archive bases added |
| Provenance, release ids, timestamps, revisions | `releases` (content-hash key, retrieved_at), per-observation source flag, `observation_revisions` view (migration 0003) |
| Separate bases, no splicing | Registry `lib/series-options.ts`; every base is its own series, view and CSV |
| Overview V2 + Indicators V2 on one source of truth | Both use `loadAllSeries()` / `SERIES_OPTIONS` and the same API |
| Filters 3M/6M/1Y/2Y/3Y/5Y/All/Custom | Work per series, anchored to that series' own latest month; URL-persistent (`range, from, to, metric, base`) |
| Charts | line/area, MoM and YoY bars, official rate, 3-month average, heatmap, year-by-year overlay, cross-indicator comparison, IIP sectors |
| ArthaGuide, tooltips, citations, downloads | shared help/tour/source components; publisher and access URLs are real links; CSV carries series id, base year, release key, retrieval time, source flag |
| Audit | `docs/DATA-QUALITY.md` (missing months, base transitions, revisions, freshness, calculation check) |
| End-to-end test | 69 real-browser checks against local API + production build, plus a failure-state run |

## 2. Official sources verified (content, not just HTTP 200)

All data comes from the MoSPI eSankhyiki REST API (`api.mospi.gov.in`), read-only. WPI is compiled by the Office of the
Economic Adviser and served through that API (the UI says "OEA via MoSPI"). The base-year catalogues were read from the
source's own endpoints (CPI: 2024, 2012, 2010; WPI/IIP: 2022-23, 2011-12, 2004-05, 1993-94).

Findings from the 96 tests that changed the implementation:
- CPI 2024 endpoint caps page size at **100** (WPI/IIP: 200); CPI 2012 returns 10 rows by default although 12 exist, so pagination is mandatory.
- WPI 2011-12 spells a field `majorgroup`; the archive WPI bases use headline `major_group_code=1` (the newer bases `1000000000`).
- CPI 2012 rows carry a per-month finality `status`; April and May 2020 carry `F*` (meaning not documented), and 2020-04/05 have no inflation value. Stored verbatim, shown as "Flag F* (meaning not documented)".
- CPI base **2010** returned no all-India general index for any year probed (empty, not failed) and is not ingested.
- `eaindustry.nic.in` fails TLS verification from this machine (incomplete chain). Verification was **not** bypassed; it is recorded as failed. The OEA site is therefore cited as the publisher's site only.
- Repeated identical requests return byte-identical data (no intra-day drift); all 12 live-vs-database cross-checks match exactly.

## 3. Stored history (local DB; see `docs/DATA-QUALITY.md` for per-series detail)

| Indicator | Series (base) | Months | Span | Official rate stored |
|---|---|---:|---|---|
| CPI | 2024 Current | 22 | Jan 2025 – Oct 2026 | YoY from Jan 2026 (10) |
| CPI | **2012 Legacy** (new) | 156 | Jan 2013 – Dec 2025 | YoY 142 (none for 2013, Apr–May 2020 not published) |
| CPI | 2024 Official back series | 144 | Jan 2013 – Dec 2024 | YoY 132 |
| WPI | 2022-23 | 43 | Apr 2023 – Oct 2026 | none exists |
| WPI | 2011-12 | 169 | Apr 2012 – Apr 2026 | none exists |
| WPI | **2004-05 archive** (new) | 147 | Jan 2005 – Mar 2017 | none exists |
| WPI | **1993-94 archive** (new) | 197 | Apr 1994 – Aug 2010 | none exists |
| IIP | 2022-23 (General + 4 sectors) | 42 | Apr 2023 – Sep 2026 | growth from Apr 2024 |
| IIP | 2011-12 (General + 3 sectors) | 159 | Jan 2013 – Mar 2026 | growth 155 (Apr 2021 missing at source) |
| IIP | **2004-05 archive** (General only, new) | 144 | Apr 2005 – Mar 2017 | not stored |
| IIP | **1993-94 archive** (General only, new) | 207 | Apr 1994 – Jun 2011 | not stored |

**Five-year comparable history.** A single base now covers a full five-year window ending at that base's last month for:
CPI 2012 (Jan 2021 – Dec 2025), WPI 2011-12 (May 2021 – Apr 2026) and IIP 2011-12 (Apr 2021 – Mar 2026). The newest
bases do not yet have five years (CPI 2024: 22 months; WPI/IIP 2022-23: 42-43 months). The UI therefore offers 5Y on
each base's own span and says when a preset exceeds the stored months. **No single official series spans the latest five
calendar years** for any indicator; the separate base-year views are the honest answer.

## 4. Base-year decisions

- No series is ever joined, rebased or converted. Each is a separate view (`?base=`), chart, table and CSV.
- The earlier docs record official linking factors (CPI 2012→2024 0.5267; IIP and WPI 2011-12→2022-23). They were **not applied**: not re-verified against the primary documents in this session (OEA site unreachable over verified TLS), and your rule is to keep bases separate.
- Audit evidence (`docs/DATA-QUALITY.md` §3, reported only): CPI 2012 vs the 2024 back series overlap on 144 months with a ratio spread of 0.15 % (about 1.899 = 1/0.5267, consistent with the documented factor). Every WPI and IIP base transition drifts (spreads of 1.8 % to 18.8 %), so none behaves like a constant factor.
- Calculation check: the site's YoY formula agrees with the publisher's own rate to at most 0.005 pp for CPI 2012 and 0.05 pp for IIP; one CPI 2024-back month differs by 0.156 pp (rounding of the one-decimal index).

## 5. Bugs found and fixed while testing

- **Hub crash with the API down** (from Indicators V2): `commonWindow([])` returned an infinite window and the page threw a client error. Fixed with a regression test; verified in a browser.
- **Back button left the page** instead of undoing a filter (filters used `replace`); filters now push history entries and keep `?base=`.
- **Page-wide horizontal overflow** from visually hidden text inside scroll wrappers (CSS fix).
- CSV order followed the table's sort; it is now always chronological.
- A `store_snapshot` extension lets each observation keep the source's own flag; behaviour is unchanged when none is supplied.

## 6. Validation (exact commands and results)

| Check | Command | Result |
|---|---|---|
| Official-source suite | `python -m pipeline.discovery` | 96 tests: 92 verified, 3 empty, 1 failed (OEA TLS, expected) |
| Data-quality audit | `python -m pipeline.audit` | 30 series, 12 calculation checks, 11 base transitions |
| Backend + pipeline + DB | `ARTHASENSE_TEST_DATABASE_URL=<local arthasense_test> python -m pytest pipeline/tests db/tests services/api/tests -q` | **307 passed, 0 skipped**. One earlier combined run on a brand-new test database showed 3 failures that did not reproduce (isolated runs, the foundation tip and a repeat all passed) |
| Without a test database | `python -m pytest -q` | 265 passed, 42 skipped (integration tests need the test DB) |
| Frontend | `npm run lint`, `npm run typecheck`, `npm test` | clean, clean, 215 tests in 12 files |
| Build | `npm run build` | success (also with the API unreachable) |
| Browser (real Chrome) | `dp_e2e.mjs` against local API + `next start` | 69/69: all 11 series render, per-series CSVs, 6M/1Y/2Y/3Y/5Y/Custom exact row counts, MoM/official/moving-average/heatmap/seasonal, source links, tour, Overview parity, overflow at 360/390/768/1024/1440 px, invalid URLs |
| Failure state | same build with an unreachable API | every page renders an explanatory message, no invented numbers, no overflow, 0 page errors |

## 7. What is not done

1. Publication dates, provisional/final flags (other than CPI 2012 `status`) and revision notes are not provided by the API; none are shown.
2. Per-dataset publisher page URLs were not established; only portal-level links.
3. WPI commodity groups, CPI categories/states and IIP use-based categories are not ingested.
4. IIP archive bases store the index only (growth semantics for their first served year were not verified).
5. The OEA site cannot be verified over TLS from this machine.
6. Original API responses are not archived (the release hash covers the validated records, not the raw bytes).
7. Overview V2's base selector is local state, not a URL parameter, so a chosen base is not carried by Overview links.
8. The Overview V2 insights and forecast sections still use the primary series only.

## 8. Local database side effects and rollback

Added locally on top of the foundation's changes: CPI 2012 legacy (2 series), WPI/IIP 2004-05 and 1993-94 (4 series), plus a
throwaway `arthasense_test` database for the integration tests. Rollback for the new series (not executed): delete observations
for releases whose key starts with `mospi-cpi2012-`, `mospi-wpi-2004-05-`, `mospi-wpi-1993-94-`, `mospi-iip-2004-05-`,
`mospi-iip-1993-94-`, then the matching `releases` and `series` rows; `DROP DATABASE arthasense_test`.

## 9. Production import (needs your approval; nothing was done)

Run `python -m pipeline.ingest.preview <cpi2012|wpi|iip> ... --allow-host <read-only host>` against a restored copy first.
Expected additions versus the live site: CPI Current Jan–Oct 2026, CPI back 2013–2024, CPI 2012 (156 + 142 rows), WPI/IIP 2011-12,
2004-05 and 1993-94 series; expected revisions: none. Apply with `pipeline.ingest.history` (additive, one release per year,
local-host guard) only after approval and migration 0003 on the target.
