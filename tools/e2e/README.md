# Browser end-to-end checks

Real Chrome driven by `playwright-core` (not a project dependency; install it in a scratch directory).

```
npm i playwright-core                       # in a scratch dir, not in apps/web
# API against the LOCAL database, and a production build of the web app:
python -m uvicorn app.main:app --port 8765  # from services/api, ARTHASENSE_DATABASE_URL = local DB
ARTHASENSE_API_URL=http://127.0.0.1:8765 npm run build && ARTHASENSE_API_URL=http://127.0.0.1:8765 npx next start -p 3114
WEB=http://127.0.0.1:3114 API=http://127.0.0.1:8765 node series-e2e.mjs
```
`series-e2e.mjs` expects the local database described in docs/OFFICIAL-DATA-PLATFORM.md (all 11 series) and a Chrome at
`C:/Program Files/Google/Chrome/Application/chrome.exe` (edit the path for other machines).
`failure-state.mjs` expects the same build started with `ARTHASENSE_API_URL=http://127.0.0.1:9` on port 3115.

## Overview logo, 2026 comparison and CPI forecasts

`overview-cpi-e2e.mjs`: logo, 2026-only comparison, Overview tour, Forecasts cards and the CPI explorer at 360-1920 px in
light and dark. `EXPECT_CPI=unavailable` checks the honest fallback against an API without linked CPI runs.

```
WEB=http://127.0.0.1:3124 API=http://127.0.0.1:8775 OUT=report.json SHOTS=shots node overview-cpi-e2e.mjs
```

## Forecasts V3

`forecasts-e2e.mjs`: 58 checks covering cross-page latest values (Forecasts vs Indicators), forecast dates after
cutoff, controls and Research View, CSV downloads, tooltips, spotlight tours at 360/390/768/1440 px (real geometry:
the card never covers its target), deep links, dark mode and console/hydration errors. GET requests and UI clicks only.

```
WEB=http://127.0.0.1:3124 API=http://127.0.0.1:8775 OUT=report.json node forecasts-e2e.mjs
```

`forecasts-a11y.mjs` (needs `axe-core` next to `playwright-core`): WCAG 2.1 A/AA over 7 Forecasts pages in Simple and
Research view, light and dark, at 1440 and 390 px; Forecasts-owned and shared-chrome violations are reported separately.

Note: `series-e2e.mjs` predates the Indicators redesign (`e01212d`, `841ef95`); some of its checks target controls
that no longer exist. It produces identical results on `7fa0b92` and on `feature/forecasts-v3`.

## Forecasts V4

`forecasts-v4-e2e.mjs`: the eight-model API contract (`/model-status`), interval order and future-only targets of every
V4 forecast row, four Outlook cards that name their model (and match the explorer's default), the GDP card (fiscal
quarters, lakh crore, implied YoY), eight-model selectors with disabled-and-explained options, quarterly horizons and
axis labels, Research view and CSVs (quarterly CSV for GDP), the comparison table (compared + explained = 8, default
badge), spotlight tours (step through, Escape, focus return) at 360–1440 px, no horizontal overflow at 360–1920 px in
light and dark, console errors, and, with `OLD=`, a pixel comparison of Overview and Indicators against a build of the
previous `main` (needs `pngjs` and `pixelmatch` next to `playwright-core`).

```
WEB=http://127.0.0.1:3114 API=http://127.0.0.1:8765 OLD=http://127.0.0.1:3115 OUT=report.json SHOTS=shots node forecasts-v4-e2e.mjs
WEB=http://127.0.0.1:3114 API=http://127.0.0.1:8765 OUT=results.json node forecasts-v4-results.mjs   # numbers for the docs
```

## Overview scientific audit

`overview-audit-e2e.mjs`: the verified card values at the source's precision (CPI 110.05 / 6.09%, WPI 113.3 / 12.29%,
IIP 124.3 / 6.7%, GDP 7.8%), every "How was this calculated?" explanation (real October 2025 CPI 103.74, substituted
formulas), the comparison method sentence, per-point table and tooltip, change-chart tooltips, 320–1920 px in light and
dark (no overflow, dialog inside the viewport), axe WCAG 2.1 A/AA with the dialog open, and console errors. Needs data
as stored on 2026-11-25 (production or a restore of it).
`indicators-pixel-diff.mjs`: Indicators pages of a previous build (`OLD`) vs this build (`WEB`) must be pixel-identical.

```
WEB=http://127.0.0.1:3114 OUT=report.json SHOTS=shots node overview-audit-e2e.mjs
OLD=http://127.0.0.1:3115 WEB=http://127.0.0.1:3114 node indicators-pixel-diff.mjs
```
