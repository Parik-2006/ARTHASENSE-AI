# Forecasts V3: UX redesign, guided tours, cross-page integration

Branch `feature/forecasts-v3` (from `7fa0b92`). Local only: nothing was pushed, deployed, imported or migrated.
The model audit is in [`FORECASTS-V3-VERIFICATION.md`](FORECASTS-V3-VERIFICATION.md).

## What changed for users

The pages now answer three questions in order: *What might happen next? How uncertain is it? How much should I trust it?*

| Page | Simple View (default) | Research View (`?view=research`) |
|---|---|---|
| **Outlook** (`/forecasting`) | Compact hero, three cards (latest official vs model estimate, expected % change, 3-bar track-record meter, sparkline with bands, "Explore forecast"), a 3–4 line economic outlook, and one disclaimer line. CPI shows a clean **Not enough comparable history** card (22 months held, 23 needed). | Full reliability reasons per indicator, the selection rule, the model inventory and the latest experiments. |
| **WPI / IIP explorer** | Title and one-line definition → 4 KPI cards (latest official, forecast + target month, expected change, reliability) → model selector and **1 / 3 / 6-month horizon** → large chart → "What this means" (3 plain sentences, including the past coverage of the 80% range) → data-connection note with a link to Indicators. | Backtest evidence table (model **and** naive baseline from one test set), MAE / RMSE / MASE / sMAPE / 80 and 95% coverage, origins, test window, caveats, run / comparison / experiment links, provenance (training window, fingerprint, interval method, selection rule), forecast table, CSV, both source attributions. |
| **CPI** | "Not enough comparable history", the latest official value and a link to historical CPI. No forecast numbers. | Months needed per horizon (23 / 25 / 28) and a link to the skipped runs with their reasons. |
| **Model comparison** | Indicator and horizon as segmented controls, a **Test set** chooser (defaults to the largest set with the baseline), a concise table (average error, vs baseline, inside-80%-range, track record), an error bar chart with a **naive reference line**, and "Lower error is generally better". **Models are sorted by error only on rankable sets** (≥ 12 origins); smaller sets use a neutral order (baseline first, then alphabetical) in both table and bars, and say so. "Lowest error" appears only for rankable sets and always comes with a "no significance test" note. | All metrics, run links, excluded models, CSV. |
| **Experiments** | Search + indicator / model / status filters, "More filters" disclosure (type, horizon, min origins), a lean table, **expandable rows** (training window, test window, scores, Reproducibility block with fingerprints, experiment id, seed, snapshot). | Adds sortable Origins / MAE / MASE columns. CSV and deep links work in both views. |

**Chart (`outlook-chart.tsx`):**
- Teal solid line for official history, gold dashed line with hollow markers for the estimate.
- Shaded forecast zone with a labelled boundary (← Official | Forecast →; a single unclipped label on narrow screens).
- Gold 80% and 95% bands.
- HTML tooltip showing month, value, source ("Official · OEA via MoSPI" or "Model estimate · Drift") and both ranges, driven by mouse, touch or arrow keys (Home / End / Esc).
- Collision-free month ticks, round y-ticks, and a list legend.
- Validated with the dataviz palette checker: CVD and normal-vision separation pass in both themes. The light-mode chroma and dark-mode lightness checks miss by about 0.02. These are the product's existing brand tokens, so dash, markers and labels act as secondary encoding.

**Guided tours (`spotlight-tour.tsx`, no new dependency):**
- Dims the page and cuts out the real element, scrolls it into view and places the card beside it, docking to the screen edge on small screens.
- Next / Back / Skip / Finish, ← / →, Esc, focus trap, and focus returns to the trigger.
- Missing, `display:none` or closed-`<details>` targets are skipped. If nothing is available the tour does not open.
- A step can open a disclosure first: the Experiments tour expands row details to show the reproducibility block.
- Four tours: Outlook (5 steps), explorer (7), comparison (5), experiments (4).
- The old ArthaGuide `Tour` is no longer mounted on Forecasts pages and is untouched for Overview and Indicators. The two tours use different start events.
- **Dependency choice:** none was added. Existing libraries were too heavy or too generic for a 4-tour need, and the custom component is about 250 lines with full test coverage.

**Integration with Overview → Indicators → Forecasts:**
- Forecasts reads history through the **same API call** Indicators uses for the current series (`/api/v1/indicators/<id>?limit=240`).
- Links: "View historical WPI / IIP / CPI" goes to `/indicators/<id>`, carrying `?range=` only when Indicators parses it (3M–5Y). "Back to economic overview" goes to `/`. Model, horizon and view are never forwarded.
- The "Overview" sub-tab is renamed **Outlook** to avoid confusion with the site Overview.

**Controls and accessibility:** horizon, history, indicator and view controls are proper WAI-ARIA radio groups (`segmented.tsx`): one tab stop, ← → ↑ ↓ / Home / End. Scrollable tables are labelled, focusable regions. axe-core (WCAG 2.1 A/AA) over 7 Forecasts pages × Simple/Research × light/dark × 1440/390 px = 56 runs: **0 violations** (Forecasts-owned and shared chrome).

## Scientific changes (display logic only)
- Reliability and the default model now use **one evaluation set** (see the verification report).
  - IIP's default changes from ETS (limited) to ARIMA (supported on 19 origins).
  - WPI stays Drift (weak track record: 80% coverage 40%).
- Concerning results on any other matched set are shown as caveats and cap "supported".
- 1- and 3-month views are steps 1..k of the stored 6-month run, labelled "first k of 6 stored months".
- The hardcoded "CPI has only 12 observations" text is now derived from the API.
- Explorer CSV for a 1- or 3-month view contains those 1 or 3 rows and records the **actual stored run** (`horizon_months` = 6, run id); the filename says `h1`/`h3`.
- `reliabilityFor` (the V2 mixed-set helper) is still in `lib/forecast-v2.ts` because that file is shared with Indicators; no page calls it any more (a regression test documents its flaw). Removing it is a separate, approved change.

## Files

Forecasts-only (modified):
- `components/forecasting/run-detail.tsx` (focusable scroll regions only)
- `app/forecasting/comparison/page.tsx`
- `app/forecasting/experiments/page.tsx`
- `components/forecasting/{comparison-view, experiments-view, forecast-explorer, forecast-pages, subnav, forecasting.test}.tsx`
- `lib/forecast-data.ts`

New:
- `components/forecasting/{outlook-chart, spotlight-tour, segmented, view-mode, research-only, reliability-meter, interactive.test}.tsx`
- `lib/{forecast-evidence, forecast-tours}.ts`
- `lib/{forecast-evidence, forecast-crosspage}.test.ts`
- `services/api/tests/test_forecast_crosspage.py`
- `tools/e2e/{forecasts-e2e, forecasts-a11y}.mjs`
- `tools/forecast_reproduce.py`
- `docs/FORECASTS-V3-*.md`
- `reports/forecasts-v3/`

**Shared files changed: 0. Overview / Indicators files changed: 0.**
- `git diff --name-only 7fa0b92` over `components/overview`, `components/indicators`, `app/page.tsx`, `app/indicators`, `forecast-chart.tsx`, `lib/forecast-v2.ts`, `lib/forecasting.ts`, `components/guide`, `lib/guide.ts`, `components/ui`, `lib/analysis.ts`, `components/source`, `globals.css`, `layout.tsx`, `components/layout`, `lib/indicators.ts`, `lib/series-options.ts`, `lib/api.ts`, `lib/overview.ts`, `lib/indicator-view.ts`, `services/api/app`, `pipeline`, `db` prints nothing.
- New Forecasts code only *imports* shared modules.

## Test results (local, 2026-11-23)

| Suite | Before | After |
|---|---|---|
| Vitest (frontend) | 18 files / 339 passed | **21 files / 394 passed** |
| `tsc --noEmit`, ESLint | clean | clean |
| Pytest (backend + pipeline, test DB `arthasense_test_final`) | 346 passed | **349 passed** (+3 cross-page) |
| `tools/e2e/forecasts-e2e.mjs` (Chrome) | — | **58 / 58** |
| `tools/e2e/forecasts-a11y.mjs` (axe-core, 56 runs) | — | **0 violations** |
| Layout audit: 12 pages × 6 widths (360, 390, 768, 1024, 1440, 1920) × 2 themes | 144 / 144 clean | **144 / 144 clean** (no horizontal overflow, no console errors) |
| `tools/e2e/series-e2e.mjs` (older Indicators script) | 28 pass + failures | **identical outcome lines** on the untouched baseline build and on this branch |

About `series-e2e.mjs`: the script predates the Indicators redesign (`e01212d`, `841ef95`), and its MoM-bar and moving-average checks target controls that no longer exist. Running it against a clean build of `7fa0b92` gives the same results, so this branch introduces no regression there.

Overview and Indicators screenshots:
- 56 of 60 are byte-identical before and after.
- The other 4 differ by 2–47 anti-aliased pixels at the same dimensions.

The 58 browser checks cover:
- Forecasts vs Indicators latest values: both APIs and both pages.
- Base years, and future dates after the training cutoff.
- Horizon, model and history controls, and Research View surviving control changes.
- Three CSV downloads and their contents.
- Tooltips on forecast and history points.
- 8 tours at 360 / 390 / 768 / 1440: every step visited; card inside the viewport and never covering the target; keyboard and Esc; focus return.
- Deep links, the Indicators and Overview links, dark mode, and console and hydration errors.

Screenshots: `reports/forecasts-v3/screens/` holds curated before/after pairs plus the tour, Research View and tooltip shots. The full 2 × 144 matrices are kept locally in `reports/forecasts-v3/{before,after}/`, excluded via `.git/info/exclude` (local only), and are not committed.

## Remaining scientific limitations
- Short histories: WPI and IIP have about 42 months; evaluation sets have 19–25 origins. No significance test, so no winner is claimed.
- WPI intervals under-cover badly after the Apr 2026 shift. That is shown, not hidden.
- CPI: one month short of a testable 1-month horizon. Back and 2012 series are never spliced.
- Backtests use `snapshot_policy=latest` (revised data, not real-time vintages). Library versions are not stored per run.
- Stored ARIMA/SARIMA runs predate the `explosive_ar` diagnostic, so a recompute is a candidate.
- Only 6-step future runs are stored. 1- and 3-month views are their first steps, not separate fits; for these one-shot models they are identical.
- Reliability is a rule of thumb, not a calibrated probability.
- Production may hold newer observations than the local DB. A forecast whose origin predates the latest official month is marked stale and never called "supported".
