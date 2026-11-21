# Data-quality and calculation audit

Generated 2026-11-21T15:06:13+00:00 from the local database (read-only). Every number below is computed from stored official observations; nothing is edited or filled.

## 1. Completeness, freshness and revisions (per series)

| Series | Base | First | Last | Months | Missing months | Latest is N months old | Revised months |
|---|---|---|---|---:|---|---:|---:|
| `mospi.cpi.2012.current.all_india.combined.general.index` | 2012 | 2013-01 | 2025-12 | 156 | none | 11 | 0 |
| `mospi.cpi.2012.current.all_india.combined.general.inflation_yoy` | 2012 | 2014-01 | 2025-12 | 142 | 2020-04, 2020-05 | 11 | 0 |
| `mospi.cpi.2024.back.all_india.combined.general.index` | 2024 | 2013-01 | 2024-12 | 144 | none | 23 | 0 |
| `mospi.cpi.2024.back.all_india.combined.general.inflation_yoy` | 2024 | 2014-01 | 2024-12 | 132 | none | 23 | 0 |
| `mospi.cpi.2024.current.all_india.combined.general.index` | 2024 | 2025-01 | 2026-10 | 22 | none | 1 | 0 |
| `mospi.cpi.2024.current.all_india.combined.general.inflation_yoy` | 2024 | 2026-01 | 2026-10 | 10 | none | 1 | 0 |
| `mospi.iip.1993-94.india.general.index` | 1993-94 | 1994-04 | 2011-06 | 207 | none | 185 | 0 |
| `mospi.iip.2004-05.india.general.index` | 2004-05 | 2005-04 | 2017-03 | 144 | none | 116 | 0 |
| `mospi.iip.2011-12.india.electricity.growth_yoy` | 2011-12 | 2013-04 | 2026-03 | 155 | 2021-04 | 8 | 0 |
| `mospi.iip.2011-12.india.electricity.index` | 2011-12 | 2013-01 | 2026-03 | 159 | none | 8 | 0 |
| `mospi.iip.2011-12.india.general.growth_yoy` | 2011-12 | 2013-04 | 2026-03 | 155 | 2021-04 | 8 | 0 |
| `mospi.iip.2011-12.india.general.index` | 2011-12 | 2013-01 | 2026-03 | 159 | none | 8 | 0 |
| `mospi.iip.2011-12.india.manufacturing.growth_yoy` | 2011-12 | 2013-04 | 2026-03 | 155 | 2021-04 | 8 | 0 |
| `mospi.iip.2011-12.india.manufacturing.index` | 2011-12 | 2013-01 | 2026-03 | 159 | none | 8 | 0 |
| `mospi.iip.2011-12.india.mining.growth_yoy` | 2011-12 | 2013-04 | 2026-03 | 155 | 2021-04 | 8 | 0 |
| `mospi.iip.2011-12.india.mining.index` | 2011-12 | 2013-01 | 2026-03 | 159 | none | 8 | 0 |
| `mospi.iip.2022-23.india.electricity.growth_yoy` | 2022-23 | 2024-04 | 2026-09 | 30 | none | 2 | 0 |
| `mospi.iip.2022-23.india.electricity.index` | 2022-23 | 2023-04 | 2026-09 | 42 | none | 2 | 0 |
| `mospi.iip.2022-23.india.general.growth_yoy` | 2022-23 | 2024-04 | 2026-09 | 30 | none | 2 | 0 |
| `mospi.iip.2022-23.india.general.index` | 2022-23 | 2023-04 | 2026-09 | 42 | none | 2 | 0 |
| `mospi.iip.2022-23.india.manufacturing.growth_yoy` | 2022-23 | 2024-04 | 2026-09 | 30 | none | 2 | 0 |
| `mospi.iip.2022-23.india.manufacturing.index` | 2022-23 | 2023-04 | 2026-09 | 42 | none | 2 | 0 |
| `mospi.iip.2022-23.india.mining.growth_yoy` | 2022-23 | 2024-04 | 2026-09 | 30 | none | 2 | 0 |
| `mospi.iip.2022-23.india.mining.index` | 2022-23 | 2023-04 | 2026-09 | 42 | none | 2 | 0 |
| `mospi.iip.2022-23.india.water.growth_yoy` | 2022-23 | 2024-04 | 2026-09 | 30 | none | 2 | 0 |
| `mospi.iip.2022-23.india.water.index` | 2022-23 | 2023-04 | 2026-09 | 42 | none | 2 | 0 |
| `mospi.wpi.1993-94.india.all_commodities.index` | 1993-94 | 1994-04 | 2010-08 | 197 | none | 195 | 0 |
| `mospi.wpi.2004-05.india.all_commodities.index` | 2004-05 | 2005-01 | 2017-03 | 147 | none | 116 | 0 |
| `mospi.wpi.2011-12.india.all_commodities.index` | 2011-12 | 2012-04 | 2026-04 | 169 | none | 7 | 0 |
| `mospi.wpi.2022-23.india.all_commodities.index` | 2022-23 | 2023-04 | 2026-10 | 43 | none | 1 | 0 |

Age is the distance between the newest stored month and the current month. It is not a staleness claim: no publication schedule is known to the API.

## 2. Calculation correctness: website YoY vs the publisher's official rate

The site calculates YoY as `(index_t / index_t-12 - 1) × 100`. For every series that also has an official rate, the two are compared month by month.

| Index series | Official rate | Months compared | Max abs diff (pp) | Mean abs diff (pp) | Over tolerance |
|---|---|---:|---:|---:|---:|
| `mospi.cpi.2012.current.all_india.combined.general.index` | `inflation_yoy` | 142 | 0.005 | 0.002 | 0 (> 0.15 pp) |
| `mospi.cpi.2024.back.all_india.combined.general.index` | `inflation_yoy` | 132 | 0.156 | 0.048 | 1 (> 0.15 pp) |
| `mospi.cpi.2024.current.all_india.combined.general.index` | `inflation_yoy` | 10 | 0.01 | 0.004 | 0 (> 0.15 pp) |
| `mospi.iip.2011-12.india.electricity.index` | `growth_yoy` | 146 | 0.05 | 0.025 | 0 (> 0.15 pp) |
| `mospi.iip.2011-12.india.general.index` | `growth_yoy` | 146 | 0.05 | 0.027 | 0 (> 0.15 pp) |
| `mospi.iip.2011-12.india.manufacturing.index` | `growth_yoy` | 146 | 0.05 | 0.025 | 0 (> 0.15 pp) |
| `mospi.iip.2011-12.india.mining.index` | `growth_yoy` | 146 | 0.05 | 0.024 | 0 (> 0.15 pp) |
| `mospi.iip.2022-23.india.electricity.index` | `growth_yoy` | 30 | 0.049 | 0.024 | 0 (> 0.15 pp) |
| `mospi.iip.2022-23.india.general.index` | `growth_yoy` | 30 | 0.05 | 0.024 | 0 (> 0.15 pp) |
| `mospi.iip.2022-23.india.manufacturing.index` | `growth_yoy` | 30 | 0.044 | 0.021 | 0 (> 0.15 pp) |
| `mospi.iip.2022-23.india.mining.index` | `growth_yoy` | 30 | 0.046 | 0.021 | 0 (> 0.15 pp) |
| `mospi.iip.2022-23.india.water.index` | `growth_yoy` | 30 | 0.049 | 0.022 | 0 (> 0.15 pp) |

Small differences are expected because the published index is rounded to one decimal. Larger ones are listed in the JSON report with the months.

## 3. Base-year transitions (reported, never used)

| Series A | Series B | Overlap | Ratio A/B min | max | Spread % | Constant like a factor? |
|---|---|---|---:|---:|---:|---|
| `mospi.cpi.2012.current.all_india.combined.general.index` | `mospi.cpi.2024.back.all_india.combined.general.index` | 2013-01 to 2024-12 (144 mo) | 1.8972 | 1.9002 | 0.15 | yes |
| `mospi.cpi.2012.current.all_india.combined.general.index` | `mospi.cpi.2024.current.all_india.combined.general.index` | 2025-01 to 2025-12 (12 mo) | 1.8937 | 1.9027 | 0.48 | yes |
| `mospi.iip.1993-94.india.general.index` | `mospi.iip.2004-05.india.general.index` | 2005-04 to 2011-06 (75 mo) | 1.8591 | 2.1469 | 14.13 | no |
| `mospi.iip.2004-05.india.general.index` | `mospi.iip.2011-12.india.general.index` | 2013-01 to 2017-03 (51 mo) | 1.4796 | 1.7377 | 16.29 | no |
| `mospi.iip.2011-12.india.electricity.index` | `mospi.iip.2022-23.india.electricity.index` | 2023-04 to 2026-03 (36 mo) | 1.8292 | 1.8633 | 1.85 | no |
| `mospi.iip.2011-12.india.general.index` | `mospi.iip.2022-23.india.general.index` | 2023-04 to 2026-03 (36 mo) | 1.3193 | 1.4014 | 6.04 | no |
| `mospi.iip.2011-12.india.manufacturing.index` | `mospi.iip.2022-23.india.manufacturing.index` | 2023-04 to 2026-03 (36 mo) | 1.2848 | 1.3866 | 7.62 | no |
| `mospi.iip.2011-12.india.mining.index` | `mospi.iip.2022-23.india.mining.index` | 2023-04 to 2026-03 (36 mo) | 1.1301 | 1.3661 | 18.78 | no |
| `mospi.wpi.1993-94.india.all_commodities.index` | `mospi.wpi.2004-05.india.all_commodities.index` | 2005-01 to 2010-08 (68 mo) | 1.84 | 1.8799 | 2.14 | no |
| `mospi.wpi.2004-05.india.all_commodities.index` | `mospi.wpi.2011-12.india.all_commodities.index` | 2012-04 to 2017-03 (60 mo) | 1.5565 | 1.6484 | 5.75 | no |
| `mospi.wpi.2011-12.india.all_commodities.index` | `mospi.wpi.2022-23.india.all_commodities.index` | 2023-04 to 2026-04 (37 mo) | 1.5148 | 1.5427 | 1.82 | no |

A ratio that drifts between months is not a linking factor. ArthaSense never converts or joins series across base years.

## 4. Source flags stored per observation

- `mospi.cpi.2012.current.all_india.combined.general.index`: `source_final` on 154 month(s)
- `mospi.cpi.2012.current.all_india.combined.general.index`: `source_status_F*` on 2 month(s)
- `mospi.cpi.2012.current.all_india.combined.general.inflation_yoy`: `source_final` on 142 month(s)

## 5. Large single-month moves (informational; values are shown unchanged)

- `mospi.iip.1993-94.india.general.index`: 2007-03 (+16.5%), 2007-04 (-15.1%), 2011-03 (+17.4%), 2011-04 (-16.1%)
- `mospi.iip.2011-12.india.electricity.index`: 2013-03 (+16.8%), 2018-03 (+15.1%), 2019-03 (+16.1%), 2020-05 (+19.9%), 2021-03 (+17.0%), 2022-03 (+18.8%)
- `mospi.iip.2011-12.india.general.index`: 2020-04 (-53.9%), 2020-05 (+67.0%), 2020-06 (+19.6%)
- `mospi.iip.2011-12.india.manufacturing.index`: 2020-03 (-16.8%), 2020-04 (-62.3%), 2020-05 (+100.5%), 2020-06 (+26.9%)
- `mospi.iip.2011-12.india.mining.index`: 2013-03 (+17.8%), 2013-04 (-16.3%), 2014-03 (+16.6%), 2014-04 (-17.9%), 2015-03 (+16.8%), 2015-04 (-18.9%), 2016-04 (-17.3%), 2016-10 (+15.2%) …
- `mospi.iip.2022-23.india.mining.index`: 2023-07 (-17.1%), 2023-10 (+22.4%), 2024-04 (-17.0%), 2024-07 (-17.7%), 2024-10 (+23.6%), 2026-04 (-15.4%)
