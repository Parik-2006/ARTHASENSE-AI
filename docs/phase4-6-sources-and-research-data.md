# WPI, IIP and research-data preparation (Phases 4 to 6)

Verified on 2026-11-20 with a small number of read-only GETs to `https://api.mospi.gov.in`.
**V** = verified live. **I** = inferred from data structure, flagged. **U** = not verified.

## Source contracts

| | CPI (Phase 2) | WPI | IIP |
|---|---|---|---|
| Publisher | MoSPI | Office of the Economic Adviser (DPIIT), **served via the MoSPI API** | MoSPI (NSO) |
| Endpoint | `/api/cpi/getCPIData` | `/api/wpi/getWpiRecords` (V) | `/api/iip/getIipData` (V) |
| Metadata | `/api/cpi/getCpiBaseYear` | `/api/wpi/getWpiBaseYear`, `/api/wpi/getWpiData?base_year=` (codes, years) (V) | `/api/iip/getIipBaseYear`, `/api/iip/getIipFilter?base_year=&frequency=` (V) |
| Auth | none (V) | none (V; the swagger mentions a bearer token but calls work without) | none (V) |
| Headline filter | `state_code=1&sector_code=3&division_code=0` | `major_group_code=1000000000` (V) | `type=General` (V) |
| Year filter | `year=` | `year=` | `year=` (V; `financial_year=` returned mixed years, so it is not used) |
| Page size | min 10, max 200 | max 200 (V) | max 200 (V) |
| Pagination | `page`, `meta_data` | same (V) | same (V) |
| Index field | `index` | `index_value` | `index` |
| Official YoY field | `inflation` (null in 2025) | **none** (V) | `growth_rate` (V) |
| Provisional/final flag | none | **none** (V) | **none** (V) |
| Publication date | none | none | none |

## Base years and historical coverage

| Series | Base | Coverage seen | Status |
|---|---|---|---|
| CPI Current | 2024 | Jan 2025 onwards | ingested (Phase 2) |
| CPI **Back** | 2024 (same 2024=100 base) | Jan 2013 to Dec 2024 (V: 2013, 2014, 2020, 2023 return 12 months; 2012 returns none); official inflation present from the second year | dry-run verified; separate series |
| CPI 2012 / 2010 base | 2012, 2010 | listed by `getCpiBaseYear`; legacy endpoint | **not ingested** (U) |
| WPI | 2022-23 | Apr 2023 to Oct 2026 (43 months) | ingestion verified |
| WPI | 2011-12 | years 2012 to 2026 listed (V); headline code `1000000000` (V) | **unverified**: registered, but no record from it has been seen. It fails closed (validation rejects anything unexpected) |
| WPI | 2004-05, 1993-94 | listed | **not supported** (headline code unverified) |
| IIP | 2022-23 | Apr 2023 to Sep 2026 (42 months) | ingestion verified |
| IIP | 2011-12 | years 2012 to 2026 listed (V); 2013 dry-run OK (4 categories x 12) | dry-run verified; growth rule checked (see below) |
| IIP | 2004-05, 1993-94 | listed | **not supported** |

Series on different base years are separate series (the base year is part of the series code) and
are never concatenated. The only composite is **CPI 2024 official Back series + Current series**.
Both are labelled `base_year=2024` by MoSPI and no linking factor is invented, **but the join is not
verified to be seamless**: the 12 Back values for 2024 average 100.56 (not exactly 100) and the step
from Dec 2024 (Back, 102.90) to Jan 2025 (Current, 101.67) is -1.20%, which may be seasonal or a
series-join effect. The splice is therefore *opt-in*: `python -m pipeline.research export
--include-spliced-cpi`. It is flagged `spliced_official_back_series`. Treat results that straddle
Dec 2024 / Jan 2025 with care.
No linking factors between WPI 2011-12 / 2022-23 or IIP 2011-12 / 2022-23 are used; OEA publishes a
WPI linking factor page (see `docs/m1-data-verification.md`) but it has not been wired in.

## IIP growth is year-on-year only from the 13th served month (V)

For the first 12 months a base is served (Apr 2023 to Mar 2024 for 2022-23; Apr 2012 to Mar 2013 for
2011-12) MoSPI's `growth_rate` equals `index - 100`: it is measured from the base-year level, not
from the same month a year earlier. From Apr 2024 (Apr 2013) it equals the real year-on-year change
(checked against values computed from the index for General and Mining, every month of 2024 and 2025).
Those early values are **withheld** (not stored; counted as "missing growth"). The index itself is
always kept. `python -m pipeline.research quality` additionally flags any stored rate that differs by
more than 0.2 percentage points from the year-on-year change implied by its own index.

## Inferences to be aware of (I)

* IIP sector totals: the row with an empty `sub_category` inside a sectoral category is treated as
  the category total (one per month per category; duplicates are rejected). Sub-categories are
  validated and skipped.
* IIP 2022-23 categories: Mining & Quarrying (code 12), Manufacturing (2), Electricity & Gas
  Supply (13), Water Supply, Sewerage & Waste Management (14), General (4). Use-based categories are
  not ingested.

## Commands (PowerShell, from the repo root)

```powershell
# one indicator, one year, nothing written
.\.venv\Scripts\python.exe -m pipeline.ingest.wpi --year 2025 --dry-run
.\.venv\Scripts\python.exe -m pipeline.ingest.iip --year 2025 --dry-run
.\.venv\Scripts\python.exe -m pipeline.ingest.cpi --series Back --year 2024 --dry-run

# bounded, resumable history: one transaction + one release per year
.\.venv\Scripts\python.exe -m pipeline.ingest.history wpi --start-year 2023 --end-year 2026 --dry-run
.\.venv\Scripts\python.exe -m pipeline.ingest.history wpi --start-year 2023 --end-year 2026 --resume   # writes

# research tools (read-only on the database)
.\.venv\Scripts\python.exe -m pipeline.research quality
.\.venv\Scripts\python.exe -m pipeline.research export          # data/exports/ (git-ignored)
```

Request budget: WPI about 1 request per year (headline only). IIP about 9 per year (General plus
four sector categories, up to 3 pages of 100). CPI 2 per year. A 0.5 s pause separates requests.

## Research loader

`pipeline.research.loader.load_series(conn, code, policy="latest"|"first", as_of=...)` returns one
series with its base year, snapshot policy and missing months. It raises on gaps unless
`require_complete=False`, never interpolates, hides snapshots retrieved after `as_of` (no future
leakage), and `TimeSeries.train_test_split(train_end)` splits strictly by time.
`splice()` refuses series on different base years.

## Limitations

* No publication dates anywhere (the API gives none); `retrieved_at` is our download time.
* WPI: index only; no inflation figure, no provisional/final marker, headline only.
* IIP: growth is MoSPI's own figure; no use-based categories; no revision flag.
* Dev database: only CPI Current 2025 is ingested until you approve more.
