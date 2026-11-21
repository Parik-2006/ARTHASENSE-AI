# Indicators V2 — implementation notes (branch `parik2`)

## What exists
- **Shared analysis library** `apps/web/src/lib/analysis.ts`: MoM / YoY computed on the *full* stored series and
  only then cut to the visible window (12-month lookback is never lost), 3M/6M/1Y/2Y/3Y/5Y/All/Custom ranges
  anchored to each series' own latest month, common-window clipping for comparisons, trailing 3-month average
  (blank across gaps), heatmap matrix, URL state (`?range=&metric=&from=&to=`), CSV with provenance columns.
- **Shared components** (`components/artha/*`): `SourceAttribution` (always-visible line + "View source" record),
  `Help` (ArthaGuide `?` popover answering four questions), `Tour` (non-modal, keyboard, restartable).
  Content lives in `lib/guide.ts`; provenance descriptors in `lib/provenance.ts`.
- **Charts** (`components/indicators/series-chart.tsx`, `explorer.tsx`): line/area/bar with zero line, gaps as
  real breaks, keyboard tooltip; heatmap (colour + printed number); moving-average overlay.
- **Pages**: Indicators hub (hero, tour, summary cards, trend previews, common-window comparison, coverage,
  explore cards); detail pages (filters, metric selector, chart, heatmap, observations table with search/sort and
  filtered CSV); IIP sector panel (sector trend, multi-sector official-growth comparison, ranking for the latest
  month in which *every* sector reports).
- **CPI history**: the detail page and hub now load MoSPI's official linked Back series (same 2024 base) next to
  Current via `getIndicatorHistory`; the join is labelled in the UI, the table and the source record.
- **Ingestion preview** `python -m pipeline.ingest.preview <cpi|wpi|iip> --start-year Y --end-year Y`:
  read-only (READ ONLY transaction, store step intercepted), refuses non-local DB hosts, prints host only.

## Local data coverage (Docker PostgreSQL only)
| Series | Stored months | Span |
|---|---|---|
| CPI (Back + Current, base 2024) | 82 | Jan 2020 – Oct 2026 |
| WPI (2022-23) | 43 | Apr 2023 – Oct 2026 |
| IIP (2022-23) | 42 | Apr 2023 – Sep 2026 |

Preview results against MoSPI on 2026-11-21: WPI and IIP: 0 additions, 0 revisions (identical to source).
CPI: 10 months (Jan–Oct 2026) and 60 Back-series months were missing locally and were ingested **locally**
(idempotent; re-run is a no-op).

## Honest limits
- **Five years for WPI / IIP is not possible on the current base.** The 2022-23 base only starts in 2023.
  Earlier months exist only on the 2011-12 base, which must not be joined. The existing 2011-12 WPI validator
  rejects the live response (`major_group` is `None`), so that history is *not* ingested; fixing the validator is
  a separate, reviewed change.
- Publication dates and provisional/final flags are not provided by the API (shown as "Not provided").
- No publisher dataset-page URL is recorded; the source record lists the access API and says so.
- WPI commodity groups and CPI categories are not ingested (not in the DB); no controls are shown for them.
- The seasonal multi-year overlay chart is **not** implemented; the heatmap and moving average are.
- Overview V2 (`parik`) was not merged: `origin/parik` has no Overview V2 commits yet (identical to the
  `parik2` base). Shared components here are independent and drop-in for it.

## Production import plan (needs explicit approval — nothing has been written to Supabase)
1. Run the preview against a **copy/staging** restore of production (preview refuses non-local hosts unless
   `--allow-host` names it explicitly).
2. Expected additions: CPI Current Jan–Oct 2026 (index + official YoY), CPI Back 2020–2024 (index + YoY).
   Expected revisions: none.
3. Apply with `python -m pipeline.ingest.history cpi --start-year 2026 --end-year 2026 --resume` and
   `... cpi --series Back --start-year 2020 --end-year 2024 --resume` (additive, one release per year).
4. Rollback: delete the observations and the `releases` row of the new `release_key` only.
