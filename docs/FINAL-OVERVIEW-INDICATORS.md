# Final Overview + Indicators experience — implementation, audit and release record

Branch `feature/final-overview-indicators`, created from `origin/main` `b238e53` (which already contains Overview V3 `265a15b`).
Supabase (production database) was **not** touched: no migration, import, backfill, deletion or retraining.

## 1. Architecture

```
MoSPI eSankhyiki API ──(pipeline/ingest/*, local-host guard)──▶ PostgreSQL ──▶ FastAPI /api/v1/indicators/* ──▶ Next.js (server components)
```

| Layer | What changed |
|---|---|
| Ingestion | **New** `pipeline/ingest/nas.py`: quarterly GDP and GVA (National Accounts, base 2022-23). `SeriesSpec` gained `frequency` (default `monthly`, so every existing series and hash is unchanged; the `quarterly` value was already allowed by the 0001 CHECK). **No new migration.** |
| API | **New** `GET /api/v1/indicators/gdp` and `GET /api/v1/indicators/gdp/gva`. They read the base tables (`series`/`observations`/`releases`), so they work on the production schema (0000-0002). Nothing stored → `404 "not stored"`; nothing is ever estimated. |
| Shared logic | `lib/overview.ts` is the one range model (`2M 3M 6M 1Y 2Y 3Y 5Y All Custom`) plus `quarterWindowFor` for GDP. `lib/indicator-view.ts` holds windows, shortfall notes, filter-aware explanations and CSV. Overview and Indicators use the same functions and the same `useRange` hook (`components/indicators/detail/use-range.tsx`). |
| Indicators | `components/indicators/detail/indicator-detail.tsx`: `MonthlyDetail` (CPI/WPI/IIP) and `GdpDetail`, exactly **two charts** each. Routes: `/indicators/{cpi,wpi,iip}` (existing) and **new** `/indicators/gdp`. |
| Overview | `components/overview/overview-final.tsx`: exactly **three** sections. Cards are links to `/indicators/<key>`; the expanded-chart panel is gone. Old `/?open=<key>&base=…` links redirect to the Indicators view, keeping `base`/`range`. |
| Removed | `overview/v3/overview-v3.tsx` (replaced), `indicators/indicator-workspace.tsx` (replaced) and their tests (behaviour re-tested in the new suites). The older `IndicatorDashboard`/explorer/heatmap modules are no longer reached from any route; they are left in place (still unit-tested) because the forecasting explorer and the indicators hub reuse parts of them. |

## 2. What each page shows

**Overview** (`/`), three sections:
1. *Key economic indicators*: four cards (CPI teal, WPI blue, IIP violet, GDP orange) with the latest stored value, its month or fiscal quarter, base year, year-on-year rate with an **Official** or **Calculated by ArthaSense** badge, a 24-month sparkline, a one-line explanation and a compact source line. The whole card links to the Indicators view.
2. *How are things changing?*: one panel, indicator selector `CPI | WPI | IIP | GDP` (`?chg=`), one bar chart of year-on-year change, a generated sentence, source and link. GDP uses official quarterly growth only.
3. *Compare economic trends*: one chart; indicators selectable; modes YoY %, MoM %, % from start, side by side. Raw levels are never put on one axis. Adding GDP switches to a quarterly comparison (monthly indices averaged over complete fiscal quarters) and disables MoM; no monthly GDP exists anywhere.

**Indicators** (two charts each):

| Indicator | Chart 1 | Chart 2 |
|---|---|---|
| CPI | Consumer inflation rate (%): official `inflation_yoy` (calculated + labelled only if a series has none) | CPI general index, base shown |
| WPI | Wholesale inflation rate (%): **Calculated by ArthaSense** (the source publishes the index only) | WPI overall index |
| IIP | Industrial production growth (%): official `growth_yoy` (calculated + labelled for archive bases) | Mining / Manufacturing / Electricity official indices where stored (2022-23, 2011-12); otherwise the general index, labelled as the alternative |
| GDP | Real GDP growth (%) by fiscal quarter: official | Sectoral GVA growth (%): official, per MoSPI industry |

Each view also has the definition sentence from the brief, base-year selector (`?base=`, bases never joined), shared range bar, a range summary (period, observation count, in-range value, in-range rate, period change), a separate note when the overall latest observation differs from the in-range one, the generated explanation, CSV of exactly the displayed rows, official links, an accessible data table, the source attribution, and an optional "Learn how to read these charts" tutorial.

**GVA labels.** MoSPI's API publishes nine industries, not an agriculture / industry / services split. The chart shows the official industries verbatim (default: Agriculture, Manufacturing, Construction, Financial & real estate; all nine selectable) and says that no three-sector split is calculated.

## 3. GDP status

* Verified live (2026-11-22), `api.mospi.gov.in/api/nas/getNASData`, `base_year=2022-23&series=Current&frequency_code=Quarterly`:
  indicator 5 "Gross Domestic Product" (₹ crore), 22 "GDP Growth Rate" (%), 1 "Gross Value Added" (9 industries, ₹ crore), 21 "GVA Growth Rate" (%). `constant_price` (real, 2022-23 prices) is stored.
* Every record is checked for base year, series, frequency, indicator label, unit, industry and duplicate quarters; a missing value is not stored; quarters are stored on their first month.
* Cross-check: Q1 FY2026-27 level 8,136,153 ÷ Q1 FY2025-26 7,546,230 = +7.82%, matching the official 7.8%.
* Coverage: levels Q1 FY2022-23 – Q1 FY2026-27 (17 quarters); official growth Q1 FY2023-24 – Q1 FY2026-27 (**13 quarters, not 20**: the 2022-23 back series is not yet published). The UI states the 5Y shortfall; the older 2011-12 GDP base is not spliced in.
* Loaded into the **isolated local** database `arthasense_gdp` only: 20 series, 300 observations, 1 release; a second run inserted 0 (idempotent). The shared dev database and `reports/import-manifest.json` (30 series / 3,129 rows) are unchanged (regenerated byte-identically).
* **Production: GDP is not stored**, so the live site shows the honest "not available yet" state on the Overview card, Section 2, the comparison and `/indicators/gdp`. Loading it needs the separate approval in `docs/PRODUCTION-DATABASE-RELEASE-PLAN.md`.

## 4. Audit (A–J)

| | Audit | Evidence | Result |
|---|---|---|---|
| A | Git / branch safety | Isolated worktree from `origin/main` `b238e53`; other worktrees untouched (main checkout still has its own 10 uncommitted changes); no force push; no secrets or DB files staged | pass |
| B | Source authenticity | All series from MoSPI eSankhyiki (WPI compiled by OEA/DPIIT, served by MoSPI); NAS codes verified live; links point to `api.mospi.gov.in` datasets and publisher sites | pass |
| C | Database integrity | Manifest regenerated identical (3,129 rows, unverified none); NAS: unique (series, release, quarter), values never 0 for missing, quarters only on Jan/Apr/Jul/Oct, idempotent re-run | pass |
| D | API integrity | 8 new API tests incl. contract matching the frontend parser, 404 when absent, limit validation, 503 without leaking credentials, old-schema run; live production API answers GDP 404 (handled) | pass |
| E | Overview | Browser: 3 sections, 4 card links, no expanded panel, Section 2 selector + Back, comparison quarterly switch | pass |
| F | Indicators | Browser: exactly 2 charts on all four views, both drawn on the full dataset; labelled fallbacks | pass |
| G | Filters | Browser on CPI 2012: 2M/3M/6M/1Y/2Y/3Y/5Y/All = 2/3/6/12/24/36/60/156 CSV rows ending Dec 2025; explanation changes with every filter; Back/Forward; refresh; Custom Apr 2019 – Mar 2020 = 12 rows; GDP 1Y = 4 quarters, 2M explained, 5Y shortfall stated | pass |
| H | Statistics | Bases never joined; YoY only against the same month/quarter a year earlier; no QoQ for non-seasonally-adjusted GDP; no monthly GDP; comparisons by % change only; F* kept verbatim (CSV `source_status`, page note) | pass |
| I | Responsive / a11y / tutorial | 8 pages × 6 widths (360–1920): HTTP 200, no horizontal overflow, no clipped chart; keyboard Tab → card → Enter opens view; charts keyboard-readable; data tables; tutorial collapsed by default | pass |
| J | Release safety | No change to deploy configuration, start commands, workflows or migrations; ingestion is CLI-only with the local-host guard; rollback commit recorded | pass |

## 5. Tests

* Python: **345 passed** (isolated test DB `arthasense_test_final`), incl. 18 NAS adapter tests and 8 GDP API tests. `ruff check` and `ruff format --check` clean.
* Frontend: **320 passed** (18 files) incl. 25 range/explanation tests, 21 detail-view tests and 16 Overview tests. ESLint and `tsc` clean. `next build` succeeds.
* Browser (production build, Chrome, `reports/final-e2e-*.json`): full local dataset + GDP **50/50**; production-shaped old schema **32/32**; backend down **20/20**; new frontend against the live production API (read-only) **32/32**.
* Screenshots, local dataset incl. GDP: `reports/final-ui/overview-{1440,390}.png`, `indicators-{cpi,wpi,iip,gdp}-1440.png`.
  Production-shaped (new frontend on the live production API): `reports/final-ui/production-shaped-overview-{1440,390}.png`, `production-shaped-indicators-*-1440.png`.
* Defaults never open on an empty view: Section 2 starts on the first indicator with a stored year-on-year figure (WPI on production, where CPI has 12 months and no rate), and the default comparison leaves out an indicator without any year-on-year value.

## 6. Limitations

* Production still stores only its short primary history (CPI 12 months on the 2024 base, without official inflation; WPI and IIP ~3.5 years) and no GDP. The new pages show that honestly: e.g. the live CPI inflation chart says no figure exists in the range.
* GDP official growth: 13 quarters (5Y asks for 20).
* Overview cards, Section 2 and the comparison use each indicator's current series; older bases are on the Indicators pages.
* WPI inflation is calculated (the source API publishes the index only).
