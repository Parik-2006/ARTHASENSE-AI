# Overview: historical CPI, WPI and IIP series (fix, 2026-11-23)

## Verified production coverage (read-only query, headline series)

| Series | Index | Official rate |
|---|---|---|
| CPI base 2024 · Current | Jan 2025 – Oct 2026 (22) | inflation Jan 2026 – Oct 2026 (10) |
| CPI base 2024 · Official back series | Jan 2013 – Dec 2024 (144) | inflation Jan 2014 – Dec 2024 (132) |
| CPI base 2012 · Legacy | Jan 2013 – Dec 2025 (156) | inflation Jan 2014 – Dec 2025 (142) |
| WPI base 2022-23 | Apr 2023 – Oct 2026 (43) | none published (YoY calculated from Apr 2024) |
| WPI base 2011-12 | Apr 2012 – Apr 2026 (169) | none published (YoY calculated from Apr 2013) |
| WPI base 2004-05 / 1993-94 | Jan 2005 – Mar 2017 / Apr 1994 – Aug 2010 | none |
| IIP base 2022-23 | Apr 2023 – Sep 2026 (42) | growth Apr 2024 – Sep 2026 (30) |
| IIP base 2011-12 | Jan 2013 – Mar 2026 (159) | growth Apr 2013 – Mar 2026 (155) |
| IIP base 2004-05 / 1993-94 | Apr 2005 – Mar 2017 / Apr 1994 – Jun 2011 | none |

The production API returns all of these rows (`limit=240`, no truncation); the Overview loader (`loadBundles`) already fetched every series.

## Root causes

| Report | Cause | Not the cause |
|---|---|---|
| CPI 2025 YoY empty on base 2024 | Real coverage: the 2024-base current series starts Jan 2025 and its official inflation starts Jan 2026 (a calculated YoY would need 2024 months in the same series). 2025 official inflation exists only in the **2012-base** series; 2022–2024 also in the **2024-base back series**. The Overview chart hard-wired `segments[0]` (current series) and offered no way to reach them. | API limits, pagination, YoY maths |
| WPI 2024 YoY only Apr–Dec | The 2022-23 series starts Apr 2023, so its calculated YoY starts Apr 2024. Earlier history is the **2011-12** series, hidden by the same `segments[0]` restriction. | API, calculation |
| IIP Level All = Apr 2023 – Sep 2026 | That is the full history of the 2022-23 series; the **2011-12** series (2013 – Mar 2026) was hidden. | "All" logic, API |

## Fix (frontend only; Overview Section 2 for CPI, WPI and IIP)
* `components/overview/overview-final.tsx`: a **Series (base year)** selector (`?chgs=`, current series by default) listing every stored
  series with its coverage; a coverage line (index span, official-rate span or "calculated"); the base label in the chart title,
  legend, tooltip description, source attribution (series ids, base year) and the "Explore in detail" link (`?base=`).
* When a **fixed calendar window** (Custom or a year button) has fewer figures in the selected series than in another stored series,
  or the selected series has none, a notice names the series that has them with a one-click **Show …** button — instead of a bare
  "no data". Relative ranges and All are each series' own history, so no cross-series suggestion appears there.
* Each series is shown on its own: no joining, no rebasing, no linking factor; YoY uses the same month a year earlier in the same
  series; WPI stays "Calculated by ArthaSense". Switching indicator resets the series choice. Cards, the comparison and **GDP/GVA
  are unchanged**.

## Tests
* Vitest: 339 passed (13 new Overview tests built on production coverage: CPI 2025 hint → base 2012; CPI years 2022–2026 in the
  series that has official inflation; WPI 2022 → 2011-12 with exact YoY; WPI 2024 nine months; IIP All on 2011-12; hint suppressed
  for relative ranges; indicator switch resets the series; GDP has no selector).
* Python 346 passed; ruff, ESLint, `tsc`, `next build` clean.
* Browser, production build against the **live production API**: history suite 16/16 (WPI 2022 YoY equals the API's own index
  arithmetic, +5.0% to +16.6%) and the full regression suite 56/56 (incl. GDP/GVA, six widths).
* Screenshots: `reports/overview-history/`.
