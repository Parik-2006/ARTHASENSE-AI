# Overview, four Indicators tabs, GDP and filters — integration report (local, not deployed)

Worktree `ARTHASENSE-AI-final`, branch `feature/final-overview-indicators`, on top of `2fe18d0` (= `origin/main`).
Committed locally only: **no push, no deployment, no production or local database writes** (the local database was only read).

## A. Problems 1, 2 and 3 — UNVERIFIED (original description required)
Searched: all repository docs and code, the four Claude Code session transcripts for this project, and the GitHub issue
list (only #1, the "Main" PR). No text defines "Problem 1/2/3". They are therefore **not claimed as solved**. Everything
below implements the independently specified requirements. Please paste the original three descriptions to have each
mapped and verified explicitly.

## B. Root-cause / audit findings (before this change)
Traced frontend → API → SQL → database (read-only):
* **API vs database: correct.** `tools/api_db_consistency.py` compares, for every stored series, the newest snapshot per
  period in PostgreSQL with what FastAPI serves: **50/50 series, 3,429/3,429 observations identical**, no missing, extra
  or duplicate periods (`reports/api-db-consistency.json`).
* **Release selection: already deterministic.** `services/api/app/indicators.py` `_SQL` takes, per series code and period,
  the observation of the most recently retrieved release (`DISTINCT ON (code, period) … ORDER BY retrieved_at DESC, id DESC`);
  `?release_key=` pins one snapshot. All snapshots stay in the database. Now also proven for GDP (new integration test).
* **Gaps against this brief** (fixed below): the Indicators page had five tabs ("All indicators" + 4); chart order/content
  differed (CPI rate first; IIP sectors as chart 2; GDP growth + GVA lines); no 2022–2026 year selection; Overview
  Section 2 showed only year-on-year change; cards lacked retrieval information.
* **Local database (read-only check):** CPI 6 series / 606 obs, IIP 20 / 1,967, WPI 4 / 556, GDP 20 / 300 — 50 / 3,429,
  migrations 0000–0004, exactly one observation per (series, period) today. Matches the brief.

## C. What the site does now
**Overview — exactly three sections.**
1. Four cards (CPI, WPI, IIP, GDP), each a link to its tab: latest value with unit and base year, its month or fiscal
   quarter, year-on-year rate labelled *Official* or *Calculated by ArthaSense*, sparkline, source and **retrieval date**
   (never presented as a publication date). GDP card: official real growth for the latest quarter.
2. *How are things changing?*: indicator selector (CPI/WPI/IIP/GDP) and **Show: Year-on-year change % | Level**
   (`?chg=`, `?chgm=`), one chart, plain-English sentence, source, link. GDP is drawn per fiscal quarter only.
3. *Compare economic trends*: % change modes only (YoY, MoM, % from start) plus side-by-side charts on their own scales;
   raw levels are never overlaid. Selecting GDP switches to a quarterly comparison where a monthly index enters as the
   average of its three months in a fiscal quarter, only when all three are stored (`lib/overview-v3.ts`, tested); MoM is
   disabled then.

**Indicators — exactly four tabs** (`CPI | WPI | IIP | GDP`; `/indicators` opens CPI). Two charts each:

| Tab | Chart 1 | Chart 2 | Selector |
|---|---|---|---|
| CPI | CPI index history | CPI inflation history (%), official | Base year (2024 current / 2012 legacy / 2024 back series), never joined |
| WPI | WPI index history | WPI inflation, YoY (%), **calculated** from the same series and base (the source has no official rate) | Base year (2022-23 / 2011-12 / 2004-05 / 1993-94) |
| IIP | IIP index history | IIP growth history (%), official (calculated + labelled for archive bases) | Base year + **Sector** (headline, mining, manufacturing, electricity, water where stored); both charts follow |
| GDP | Real GDP quarterly level (₹ lakh crore on the axis, exact ₹ crore in table/CSV) | Official real GDP growth, YoY (%) | **Measure**: GDP or any of MoSPI's nine GVA industries; both charts follow |

Fiscal quarters: April = Q1, July = Q2, October = Q3, January = Q4 of the fiscal year that started the previous April
(e.g. Jan 2026 = Q4 FY2025-26); labels such as "Q1 FY2026-27 (Apr–Jun 2026)".

## D. Filters (same model on every chart: `lib/overview.ts`, hook `use-range.tsx`, URL `?range=&from=&to=`)
* **Anchor:** relative presets end at the selected series' own latest stored observation (works with irregular release
  schedules; never padded). 2M/3M/6M/1Y/2Y/3Y/5Y = 2/3/6/12/24/36/60 months.
* **Quarterly GDP:** a preset of M months covers ⌊M/3⌋ quarters (3M = 1, 1Y = 4, 5Y = 20); **2M shows an explicit
  "shorter than one quarter" state**; no monthly GDP is ever created.
* **Custom:** month inputs (`YYYY-MM`, no time zone involved), start ≤ end validated, both bounds inclusive, ranges outside
  the data give a truthful empty state; typing replaces history, presets push (Back/Forward work).
* **Year 2022–2026 = calendar year (January–December)**, labelled "Year (Jan–Dec)". It is a Custom range `YYYY-01..YYYY-12`
  (shares the URL and code path). For GDP it includes the quarters that *start* in that calendar year
  (2025 → Q4 FY2024-25 … Q3 FY2025-26), stated on the page.
* **No stale data:** all observations are loaded server-side per page; switching filters or indicators is a pure
  client-side recomputation (no request races). Browser test: six rapid preset clicks end on the last choice.
* Loading: route-level Suspense skeletons; error: alert with no numbers; empty: explicit message per chart.

Browser results on the real local database: CPI 2012 2M…All = 2/3/6/12/24/36/60/156 CSV rows ending Dec 2025; year
buttons 2022–2026 on CPI 2012 = 12/12/12/12/0 months; custom Apr 2019–Mar 2020 = 12; WPI 2011-12 5Y = 60 (May 2021–Apr
2026); IIP manufacturing 2Y = 24; GDP 1Y = 4 quarters, ending Q1 FY2026-27 level 8,136,153 and growth 7.8; GDP calendar
year 2025 = Q4 FY24-25…Q3 FY25-26; GDP 5Y states 13 of 20 quarters of growth.

## E. Backend
No endpoint changed in this step (the GDP endpoints `/api/v1/indicators/gdp` and `/gdp/gva` from the previous step already
served the data). Responses carry indicator, base year, frequency, unit/measure, source, per-value release key and
retrieval time; the available range is the span of the returned observations. Added: integration test for GDP revisions
(two snapshots → one row per quarter from the newest, old snapshot pinnable, ordered, start/end filters, empty range =
404, start > end = 400) and the read-only `tools/api_db_consistency.py`.
Integrity: missing values are not stored (never 0); bases are separate series; no linking factor is applied; calculated
values are labelled; retrieval time is never shown as publication time.

## F. Tests executed (all passing)
* `python -m pytest -q` (isolated `arthasense_test_final`): **346 passed**. `ruff check .`, `ruff format --check .`: clean.
* `npm run lint`, `npm run typecheck`: clean. `npx vitest run`: **326 passed**. `npm run build`: success.
* `python tools/api_db_consistency.py` against the API on the local database: **50/50 series, 3,429 observations**.
* Browser (production build, Chrome, 8 pages × 360/390/768/1024/1440/1920 px each): local database **56/56**;
  production-shaped old schema **32/32**; backend down **20/20**; new frontend on the live production API (read-only) **32/32**.
* Not verified: Vercel/Render deployment of this step (not authorized).

## G. Changed files (this step)
* `apps/web/src/components/indicators/detail/indicator-detail.tsx` — chart order index→rate; IIP sector selector; GDP
  level + growth with GVA measure selector; lakh-crore axis; calendar-year note; mobile-safe selects.
* `apps/web/src/components/indicators/detail/use-range.tsx`, `components/overview/v3/ui.tsx` — 2022–2026 year buttons.
* `apps/web/src/components/overview/overview-final.tsx` — Section 2 Level/YoY toggle; retrieval date on cards.
* `apps/web/src/components/indicators/subnav.tsx`, `app/indicators/page.tsx`, `app/page.tsx`, `lib/nav.ts` — four tabs;
  `/indicators` opens CPI.
* `apps/web/src/lib/gdp.ts` (GVA levels kept), `lib/indicator-view.ts` (measure-aware GDP explanation).
* Tests: `detail.test.tsx`, `overview-final.test.tsx`, `indicators.test.tsx`, `services/api/tests/test_indicators_gdp.py`.
* `tools/api_db_consistency.py`, `reports/api-db-consistency.json`, `reports/final-e2e-*.json`, `reports/final-ui/*.png`.

## H. Remaining work / approvals
1. **Problems 1–3:** original descriptions needed.
2. **Push and deploy** this commit (not authorized here).
3. **Production database:** still no GDP and only the short primary history. Needs the approvals in
   `docs/PRODUCTION-DATABASE-RELEASE-PLAN.md` (read-only production access, backup, 0003/0004, history import, NAS import of
   300 rows). Until then the live GDP tab shows the honest unavailable state.
4. The unused `IndicatorsOverview` hub component remains in the codebase (still unit-tested); `/indicators` no longer
   renders it.
