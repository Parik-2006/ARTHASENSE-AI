# Overview: scientific audit, calculation transparency and UX

Date: 2026-11-25. Data: production database (read-only queries) and the raw MoSPI API evidence stored in
`data/evidence/raw`. No production data was changed: every stored value checked out.

## 1. Executive summary

* **Every number on the Overview is correct.** CPI 110.05 / 6.09%, WPI 113.3 / 12.29%, IIP 124.3 / 6.7% and GDP 7.8% were
  each traced from the source record to the screen and reproduced.
* **Confirmed defects (fixed):**
  1. *False precision*: WPI and IIP indices (published to one decimal) were shown as "113.30" and "124.30", and IIP's
     official growth (one decimal) as "6.70%". Values are now shown with each series' stored precision.
  2. *GDP in the comparison chart* was recalculated from levels (e.g. 8.556%) instead of using the official growth the
     GDP card shows (8.6%). The chart now uses the official figure; the two can no longer disagree.
  3. *Ambiguous method wording* in "Compare economic trends" ("enter as the average of a quarter's three months"). The
     implemented method was always the same; the text now states it exactly.
  4. *Accessibility*: the Overview card links had an `aria-label` that did not contain their visible text (WCAG 2.5.3,
     pre-existing). The link now takes its name from its visible content.
  5. *Grammar* in a new sentence found by the browser suite ("production were") — fixed before release, with a test.
* **New:** a "How was this calculated?" explanation on every card; an inspectable per-quarter calculation table for the
  comparison chart; richer chart tooltips (comparison period, base year, official/calculated) on the Overview; plain-
  language sentences with correct sign handling; glossary terms.

## 2. Data lineage (government publication → screen)

| Indicator | Displayed | Source record | Stored series (DB) | API field | Calculation | Code |
|---|---|---|---|---|---|---|
| CPI Oct 2026 | 110.05 | MoSPI eSankhyiki CPI, base 2024, series Current, All India, Combined, CPI (General): `index 110.05, inflation 6.09` (one record) | `mospi.cpi.2024.current…general.index` / `…inflation_yoy` | `/api/v1/indicators/cpi` `observations[].index` | none | `overview-final.tsx` MonthlyCard |
| CPI inflation | 6.09% (official) | same record, `inflation` | `…inflation_yoy` | `observations[].rate` | none (cross-checked) | `calc-explain.ts` `monthlyExplanation` |
| WPI Oct 2026 | 113.3 | OEA WPI, base 2022-23, All Commodities, served by MoSPI | `mospi.wpi.2022-23.india.all_commodities.index` | `observations[].index` | — | MonthlyCard |
| WPI inflation | 12.29% (calculated) | OEA publishes the index; the API carries no rate | — | — | (113.3 ÷ 100.9 − 1) × 100, frontend `derive().yoyCalc` | `lib/overview.ts` `derive` |
| IIP Sep 2026 | 124.3 / 6.7% (official) | MoSPI IIP, base 2022-23, General | `mospi.iip.2022-23.india.general.index` / `…growth_yoy` | `index`, `rate` | none (cross-checked) | MonthlyCard |
| GDP Q1 FY2026-27 | 7.8% (official) | MoSPI NAS quarterly, base 2022-23, constant prices | `mospi.nas.2022-23.india.gdp.real.growth_yoy` (+ `…real.level`) | `/api/v1/indicators/gdp` | none (cross-checked from levels) | GdpCard, `gdpExplanation` |
| Comparison chart | quarterly % | the four current series | — | — | see §5 | `lib/overview-v3.ts` `buildYearComparison` |

All calculations happen in the frontend (pure TypeScript, unit-tested); the API serves stored official values only.
Integrity: 3,429 observations, 3,429 distinct (series, period) pairs — no duplicates.

## 3. Verification by indicator

### CPI (October 2026)
| Item | Value |
|---|---|
| Index Oct 2026 / Oct 2025 (same Current series, base 2024) | **110.05 / 103.74** |
| Official inflation Oct 2026 | **6.09%** (published with the index in the same API record) |
| Formula on published indices | ((110.05 ÷ 103.74) − 1) × 100 = **6.0825% → 6.08%** |
| Rounding bounds (indices ±0.005) | 6.07% … 6.09% → official 6.09% is consistent |
| September cross-check | 109.49 ÷ 103.74 → 5.5427% → 5.54% = official 5.54% exactly |

The 0.01-point difference in October comes from rounding: MoSPI computes the rate from unrounded indices and publishes
both rounded to two decimals. **103.73 is not an observation**: it is 110.05 ÷ 1.0609, a back-calculation. The stored
October 2025 index is 103.74. Coverage, geography, basket, base and vintage of index and rate are identical (one record).

### WPI (October 2026 and the April 2026 jump)
| Month | 2022-23 base | YoY | MoM | 2011-12 base (legacy) | YoY | MoM |
|---|---|---|---|---|---|---|
| Mar 2026 | 104.6 | 3.98% | 1.45% | 160.8 | 3.88% | 1.52% |
| **Apr 2026** | **108.9** | 8.36% | **4.11%** | **167.0** | 8.30% | **3.86%** |
| Sep 2026 | 112.5 | 11.39% | 1.53% | — | — | — |
| Oct 2026 | 113.3 | **12.29%** | 0.71% | — | — | — |

* October: (113.3 ÷ 100.9 − 1) × 100 = 12.29%, calculated by ArthaSense from the official index.
* The OEA press release for October 2026 (read 2026-11-24) states 12.29% for October, 11.39% for September and 9.92% for
  August (final): ArthaSense's calculated values equal the published rates for those months. This is recorded here, not
  claimed in the UI (the UI says "Calculated by ArthaSense").
* **April 2026 is a genuine movement**: both independently compiled baskets rose (4.11% and 3.86%) in the same month. It is
  not a base mismatch, gap, duplicate, unit or chart error (one value per month, consecutive months, same series). The
  OEA April 2026 press release could not be retrieved (`press_release_202604/05.pdf` and the release index return 404),
  so the evidence is the two stored OEA-served series, not a press release. The jump is shown unchanged.
* Negative YoY months exist (May–Nov 2025, minimum −1.18% in Oct 2025) and are drawn as signed bars.
* The linking factor 1.53 (OEA, verified in primary form for Forecasts V4) is used **only** in the forecasting training
  history, in memory. The Overview never joins base years; each series is selected separately.

### IIP (September 2026)
Index 124.3 (one decimal), official growth 6.7% (one decimal). Check: 124.3 ÷ 116.5 → 6.695% → 6.7% ✓ (bounds 6.61–6.78%).
August: 123.1 ÷ 114.2 → 7.8% = official 7.8% ✓. The card now shows "6.7%" (was "6.70%").

### GDP (Q1 FY2026-27 = Apr–Jun 2026)
Official real growth 7.8%. Real GDP ₹81,36,153 crore vs ₹75,46,230 crore in Q1 FY2025-26 → 7.8175% → 7.8% ✓. All 13
official growth values match level-derived YoY within 0.05 points (rounding). Year-on-year only; never quarter-on-quarter;
no monthly GDP.

## 4. Stored precision (scan of every headline series)
CPI rates 2 decimals (all CPI series); CPI index 2 (base 2024 current and back) and 1 (base 2012); WPI and IIP indices 1
(all bases); IIP growth 1; GDP growth 1; GDP levels whole ₹ crore. The Overview derives display precision from the stored
values (`seriesPrecision`), so it follows the source if that ever changes. (The Indicators pages still show two decimals;
left unchanged in this release — see §10.)

## 5. "Compare economic trends" methodology

Implemented (and unchanged) for CPI, WPI and IIP — **Method B**:

```
YoY(q) = (average index of the quarter's 3 months ÷ average of the same 3 months a year earlier − 1) × 100
```

only when all six months are stored in the same current-base series. GDP: the **official** real growth of the quarter
(quarter vs the same quarter a year earlier) — changed in this release from a recalculation from levels.

Quarters are calendar blocks (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec); `fiscalQuarterOf().start` produces exactly these
blocks, which coincide with fiscal quarters (Jan–Mar 2026 = Q4 FY2025-26).

Every 2026 point reproduced independently from the database (Method B) and compared with Method A (mean of three monthly
YoY rates):

| Indicator | Quarter | Method B (plotted) | Method A | B − A |
|---|---|---|---|---|
| CPI | Jan–Mar | 3.1145 | 3.1149 | −0.0004 |
| CPI | Apr–Jun | 3.9348 | 3.9334 | +0.0014 |
| CPI | Jul–Sep | 4.9384 | 4.9378 | +0.0006 |
| WPI | Jan–Mar | 2.4455 | 2.4478 | −0.0023 |
| WPI | Apr–Jun | 9.4020 | 9.4028 | −0.0009 |
| WPI | Jul–Sep | 10.3642 | 10.3624 | +0.0018 |
| IIP | Jan–Mar | 3.8386 | 3.8653 | −0.0267 |
| IIP | Apr–Jun | 6.2191 | 6.2186 | +0.0005 |
| IIP | Jul–Sep | 7.2764 | 7.2797 | −0.0033 |
| GDP | Jan–Mar | **8.6 (official)** | — | (levels: 8.5561) |
| GDP | Apr–Jun | **7.8 (official)** | — | (levels: 7.8175) |

Oct–Dec 2026 is not drawn: CPI and WPI have only October, IIP has no month yet. GDP Jul–Sep 2026 is not published.

**Why Method B:** one rule for all three monthly indices, matching the definition of quarterly GDP growth (a quarter's
level vs the same quarter a year earlier); it does not mix in CPI/IIP's official monthly rates (which WPI does not
have), so all three monthly lines are computed the same way. The difference from Method A is at most 0.027 points here.
The chart text, tooltip, source note, explanation table and this document all describe Method B.

## 6. ChatGPT's claims — verdicts

| Claim | Evidence | Verdict | Action |
|---|---|---|---|
| CPI 6.09% may need verification | One MoSPI record holds index 110.05 and inflation 6.09; Oct 2025 index 103.74; 6.08% from rounded indices, within bounds | **Correct value; the concern's premise was wrong** (103.73 is a back-calculation, not an observation) | Kept 6.09%; explanation shows 103.74 and the rounding |
| WPI April 2026 jump may be suspicious | +4.11% (2022-23 base) and +3.86% (2011-12 base) the same month | **False alarm**: genuine published movement | Shown unchanged; documented |
| Quarterly comparison wording may conflict | Code: Method B only; both texts described B, one ambiguously | **Partly valid** (wording ambiguous, no calculation conflict) | Wording made exact; per-point table |
| Base-year comparison needs safeguards | Series never joined; selectors and notes already present; linking factor only in Forecasts training | **Already safe** | Glossary entry "Current and legacy series" |
| Calculation transparency can improve | No per-figure formula view existed | **Valid** | "How was this calculated?" on every card; comparison table; tooltips |
| Data freshness could be clearer | Release `published_at` is not provided by the source API (NULL) | **Partly valid** | Frequency + latest period + retrieved date; no invented publication dates |
| (not raised by ChatGPT) | Precision scan | **Defect** | One-decimal series no longer shown with two decimals |
| (not raised by ChatGPT) | Chart used recalculated GDP growth | **Defect** | Official GDP growth in the comparison |

## 7. Rounding rules
* Official rates are shown exactly as published, at their published precision.
* Calculated WPI inflation is shown to 2 decimals (the precision OEA uses for its rates); the explanation states its
  uncertainty from one-decimal indices (about ±0.06 points for October 2026).
* Cross-checks report consistency with rounding bounds computed from the stored precision; a mismatch would be stated,
  never hidden or corrected.

## 8. UI changes
* **How was this calculated?** (`components/overview/calc-explainer.tsx`, logic in `lib/calc-explain.ts`): plain sentence,
  definition, official/calculated badge, exact observations, formula with substituted values, result, rounding, units,
  base year, source link, retrieval date, key terms. Keyboard: focus moves into the dialog; Escape / Close / outside click
  return focus. Placed beside, not inside, each card link.
* **Comparison**: exact method sentence; "How was each point calculated?" table (months, averages, result, provenance,
  reason for any gap).
* **Tooltips** (Overview only; opt-in prop on the shared chart): comparison month and base, official/calculated, GDP
  fiscal quarter with months.
* **Freshness**: "published monthly/quarterly", latest period and retrieval date on each card.
* **Glossary** (`lib/guide.ts`): inflation/deflation, real GDP, fiscal quarter, percent vs percentage points, calculated by
  ArthaSense, current vs legacy series (in addition to index, base year, YoY, official, source).

## 9. Tests
* Unit (real fixtures): `lib/calc-explain.test.ts` — precision, rounding bounds (CPI Oct/Sep, IIP, GDP), explanations,
  sign handling, verb agreement, Method B vs A, incomplete quarters, official GDP in the comparison.
* Component: `overview-final.test.tsx` — explainer placement, focus, Escape, values, method text, breakdown.
* Browser (`tools/e2e/overview-audit-e2e.mjs`, real data on an isolated restore): 72/72 — card values and precision,
  all four explanations, comparison table and tooltip, change-chart tooltips, 320–1920 px in light and dark (no overflow,
  dialog inside the viewport), axe WCAG 2.1 A/AA with the dialog open (0 violations), no console errors.
* Indicators pixel-identical to the previous `main`: 14/14 screenshots.
* Regression: Overview/CPI 366/366, Forecasts V4 113/113, Forecasts V3 58/58, accessibility (Forecasts) suite; results in
  `reports/overview-audit/`.

## 10. Remaining limitations
* Publication dates are not provided by the source API, so only retrieval dates are shown.
* The Indicators pages still display one-decimal series with two decimals (out of this release's Overview scope).
* The April 2026 WPI evidence is the two stored series, not a press release (unreachable).
* Calculated WPI inflation equals OEA's published rates for August–October 2026 (checked); other months were not
  compared with press releases.

## 11. Release and production verification (2026-11-25)

| Step | Result |
|---|---|
| Local gate | Ruff clean; pytest 394 passed; ESLint and `tsc` clean; vitest 443 passed; `next build` OK |
| Local browser (isolated restore of production data) | Overview audit 72/72; Indicators pixel-identical 14/14; Overview/CPI 366/366; Forecasts V4 113/113; Forecasts V3 58/58; Forecasts accessibility 0 violations (56 runs) |
| GitHub `main` | fast-forward `1e36e65` → `2ab3b76` (includes the earlier local docs commit `96f3fe6`); no force push |
| CI | success (run 45573578674) |
| Vercel | new Overview served (explanations present) |
| Render | API unchanged; `/health`, `/api/v1/indicators/cpi`, `/api/v1/forecasting/model-status` 200 |
| Live browser | Overview audit **72/72**, Forecasts V4 **113/113**, Overview/CPI **366/366** (`reports/overview-audit/live-*.json`) |
| Production database | not modified: 3,429 observations, 365 forecast runs, 4,673 forecasts, 1,788 scores (read-only check after release) |
