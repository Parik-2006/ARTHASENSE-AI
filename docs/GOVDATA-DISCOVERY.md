# Government data discovery and verification

Run: 2026-11-21 14:42 UTC · source host: `api.mospi.gov.in` · requests sent: 70 · tests: 90

A test is **verified** only when content checks pass (documented fields, numeric values, requested year, no duplicate
months, expected row counts, or equality with the stored database). HTTP 200 alone never counts. **empty** means the source
answered but holds no data for that request. TLS verification is never disabled.

**Result:** 81 verified · 7 empty (informative) · 2 failed · 0 skipped

| Category | verified | empty | failed | skipped |
|---|---:|---:|---:|---:|
| boundary | 10 | 0 | 0 | 0 |
| catalogue | 14 | 0 | 0 | 0 |
| cross-check | 6 | 0 | 0 | 0 |
| freshness | 6 | 0 | 0 | 0 |
| identity | 7 | 0 | 0 | 0 |
| portal | 3 | 0 | 1 | 0 |
| protocol | 9 | 0 | 1 | 0 |
| retrieval | 23 | 7 | 0 | 0 |
| revision | 3 | 0 | 0 | 0 |

## All tests

| # | ID | Result | What was checked | Evidence |
|---:|---|---|---|---|
| 1 | `A-CPI-catalogue` | verified | CPI base-year catalogue endpoint answers with the documented structure | 3 base years: ['2010', '2012', '2024'] |
| 2 | `A-IIP-catalogue` | verified | IIP base-year catalogue endpoint answers with the documented structure | 4 base years: ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 3 | `A-WPI-catalogue` | verified | WPI base-year catalogue endpoint answers with the documented structure | 4 base years: ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 4 | `A-CPI-base-2024` | verified | CPI base 2024 is advertised by the source's own catalogue | 2024 listed in ['2010', '2012', '2024'] |
| 5 | `A-CPI-base-2012` | verified | CPI base 2012 is advertised by the source's own catalogue | 2012 listed in ['2010', '2012', '2024'] |
| 6 | `A-CPI-base-2010` | verified | CPI base 2010 is advertised by the source's own catalogue | 2010 listed in ['2010', '2012', '2024'] |
| 7 | `A-IIP-base-2022-23` | verified | IIP base 2022-23 is advertised by the source's own catalogue | 2022-23 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 8 | `A-IIP-base-2011-12` | verified | IIP base 2011-12 is advertised by the source's own catalogue | 2011-12 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 9 | `A-IIP-base-2004-05` | verified | IIP base 2004-05 is advertised by the source's own catalogue | 2004-05 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 10 | `A-IIP-base-1993-94` | verified | IIP base 1993-94 is advertised by the source's own catalogue | 1993-94 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 11 | `A-WPI-base-2022-23` | verified | WPI base 2022-23 is advertised by the source's own catalogue | 2022-23 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 12 | `A-WPI-base-2011-12` | verified | WPI base 2011-12 is advertised by the source's own catalogue | 2011-12 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 13 | `A-WPI-base-2004-05` | verified | WPI base 2004-05 is advertised by the source's own catalogue | 2004-05 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 14 | `A-WPI-base-1993-94` | verified | WPI base 1993-94 is advertised by the source's own catalogue | 1993-94 listed in ['2022-23', '2011-12', '2004-05', '1993-94'] |
| 15 | `B-CPI2024-Current-2025` | verified | CPI base 2024, series Current, 2025: fields, numeric values, requested year, no duplicate months | 12 records, 2025-01 to 2025-12, 12 numeric |
| 16 | `B-CPI2024-Current-2026` | verified | CPI base 2024, series Current, 2026: fields, numeric values, requested year, no duplicate months | 10 records, 2026-01 to 2026-10, 10 numeric |
| 17 | `B-CPI2024-Back-2013` | verified | CPI base 2024, series Back, 2013: fields, numeric values, requested year, no duplicate months | 12 records, 2013-01 to 2013-12, 12 numeric |
| 18 | `B-CPI2024-Back-2020` | verified | CPI base 2024, series Back, 2020: fields, numeric values, requested year, no duplicate months | 12 records, 2020-01 to 2020-12, 12 numeric |
| 19 | `B-CPI2024-Back-2024` | verified | CPI base 2024, series Back, 2024: fields, numeric values, requested year, no duplicate months | 12 records, 2024-01 to 2024-12, 12 numeric |
| 20 | `B-CPI2012-2013` | verified | CPI base 2012 (legacy), 2013: fields, numeric values, requested year, no duplicate months | 12 records, 2013-01 to 2013-12, 12 numeric |
| 21 | `B-CPI2012-2017` | verified | CPI base 2012 (legacy), 2017: fields, numeric values, requested year, no duplicate months | 12 records, 2017-01 to 2017-12, 12 numeric |
| 22 | `B-CPI2012-2021` | verified | CPI base 2012 (legacy), 2021: fields, numeric values, requested year, no duplicate months | 12 records, 2021-01 to 2021-12, 12 numeric |
| 23 | `B-CPI2012-2025` | verified | CPI base 2012 (legacy), 2025: fields, numeric values, requested year, no duplicate months | 12 records, 2025-01 to 2025-12, 12 numeric |
| 24 | `B-WPI-2022-23-2023` | verified | WPI base 2022-23, headline, 2023: fields, numeric values, requested year, no duplicate months | 9 records, 2023-04 to 2023-12, 9 numeric |
| 25 | `B-WPI-2022-23-2026` | verified | WPI base 2022-23, headline, 2026: fields, numeric values, requested year, no duplicate months | 10 records, 2026-01 to 2026-10, 10 numeric |
| 26 | `B-WPI-2011-12-2012` | verified | WPI base 2011-12, headline, 2012: fields, numeric values, requested year, no duplicate months | 9 records, 2012-04 to 2012-12, 9 numeric |
| 27 | `B-WPI-2011-12-2021` | verified | WPI base 2011-12, headline, 2021: fields, numeric values, requested year, no duplicate months | 12 records, 2021-01 to 2021-12, 12 numeric |
| 28 | `B-WPI-2011-12-2026` | verified | WPI base 2011-12, headline, 2026: fields, numeric values, requested year, no duplicate months | 4 records, 2026-01 to 2026-04, 4 numeric |
| 29 | `B-WPI-2004-05-2010` | empty (source has no data) | WPI base 2004-05, headline, 2010: fields, numeric values, requested year, no duplicate months | the source answered but returned no records |
| 30 | `B-WPI-2004-05-2016` | empty (source has no data) | WPI base 2004-05, headline, 2016: fields, numeric values, requested year, no duplicate months | the source answered but returned no records |
| 31 | `B-WPI-1993-94-2000` | empty (source has no data) | WPI base 1993-94, headline, 2000: fields, numeric values, requested year, no duplicate months | the source answered but returned no records |
| 32 | `B-WPI-1993-94-2004` | empty (source has no data) | WPI base 1993-94, headline, 2004: fields, numeric values, requested year, no duplicate months | the source answered but returned no records |
| 33 | `B-IIP-2022-23-2023` | verified | IIP base 2022-23, General, 2023: fields, numeric values, requested year, no duplicate months | 9 records, 2023-04 to 2023-12, 9 numeric |
| 34 | `B-IIP-2022-23-2026` | verified | IIP base 2022-23, General, 2026: fields, numeric values, requested year, no duplicate months | 9 records, 2026-01 to 2026-09, 9 numeric |
| 35 | `B-IIP-2011-12-2013` | verified | IIP base 2011-12, General, 2013: fields, numeric values, requested year, no duplicate months | 12 records, 2013-01 to 2013-12, 12 numeric |
| 36 | `B-IIP-2011-12-2021` | verified | IIP base 2011-12, General, 2021: fields, numeric values, requested year, no duplicate months | 12 records, 2021-01 to 2021-12, 12 numeric |
| 37 | `B-IIP-2011-12-2026` | verified | IIP base 2011-12, General, 2026: fields, numeric values, requested year, no duplicate months | 3 records, 2026-01 to 2026-03, 3 numeric |
| 38 | `B-IIP-2004-05-2010` | verified | IIP base 2004-05, General, 2010: fields, numeric values, requested year, no duplicate months | 12 records, 2010-01 to 2010-12, 12 numeric |
| 39 | `B-IIP-2004-05-2016` | verified | IIP base 2004-05, General, 2016: fields, numeric values, requested year, no duplicate months | 12 records, 2016-01 to 2016-12, 12 numeric |
| 40 | `B-IIP-1993-94-2000` | verified | IIP base 1993-94, General, 2000: fields, numeric values, requested year, no duplicate months | 12 records, 2000-01 to 2000-12, 12 numeric |
| 41 | `B-IIP-1993-94-2004` | verified | IIP base 1993-94, General, 2004: fields, numeric values, requested year, no duplicate months | 12 records, 2004-01 to 2004-12, 12 numeric |
| 42 | `B-CPI2010-2011` | empty (source has no data) | CPI base 2010, all-India combined general, 2011 | the source answered but returned no records |
| 43 | `B-CPI2010-2013` | empty (source has no data) | CPI base 2010, all-India combined general, 2013 | the source answered but returned no records |
| 44 | `B-CPI2010-2015` | empty (source has no data) | CPI base 2010, all-India combined general, 2015 | the source answered but returned no records |
| 45 | `C-WPI-2022-23-before` | verified | WPI 2022-23 asked for 2022 (before its first month, Apr 2023): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 46 | `C-WPI-2011-12-before` | verified | WPI 2011-12 asked for 2011 (before its first month, Apr 2012): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 47 | `C-IIP-2022-23-before` | verified | IIP 2022-23 asked for 2022 (before Apr 2023): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 48 | `C-IIP-2011-12-before` | verified | IIP 2011-12 asked for 2011 (before Apr 2012): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 49 | `C-CPI2024-Current-2024` | verified | CPI 2024 Current asked for 2024 (starts Jan 2025): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 50 | `C-CPI2024-Back-2012` | verified | CPI 2024 Back asked for 2012 (starts Jan 2013): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 51 | `C-CPI2012-2012` | verified | CPI 2012 asked for 2012 (base year itself): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 52 | `C-WPI-future` | verified | WPI asked for 2028 (future year): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 53 | `C-IIP-future` | verified | IIP asked for 2028 (future year): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 54 | `C-CPI-future` | verified | CPI asked for 2028 (future year): the source must not invent data | no records returned (HTTP 200): the boundary is honest |
| 55 | `D-limit-cap` | verified | page size above 200 is rejected (documented cap) | HTTP 400: None |
| 56 | `D-cpi-limit-cap` | FAILED | the CPI 2024 endpoint caps page size at 100 (lower than WPI/IIP) | HTTP 200: Limit parameter too large. Maximum allowed is 100. |
| 57 | `D-pagination-consistent` | verified | WPI all-level query paginates consistently (meta_data agrees with pages) | totalRecords=3476 recordPerPage=200 totalPages=18 |
| 58 | `D-page2-differs` | verified | page 2 returns different records from page 1 | 100 + 100 records, 0 overlap |
| 59 | `D-cpi2012-default-page` | verified | CPI 2012 legacy returns 10 rows by default but 12 exist (pagination is required) | default page has 10 rows, totalRecords=12 |
| 60 | `D-invalid-base` | verified | an unknown base year is rejected or empty, never silently mapped to another base | HTTP 200, 0 rows, msg='No Data Found' |
| 61 | `D-invalid-year` | verified | a non-numeric year is rejected or empty | HTTP 200, 0 rows |
| 62 | `D-unknown-param` | verified | an unknown query parameter does not change the result | HTTP 200; identical body: True |
| 63 | `D-content-type` | verified | data endpoints answer JSON (not HTML error pages) | content-type 'application/json; charset=utf-8' |
| 64 | `D-csv-not-offered` | verified | no CSV/other format is offered by the data endpoint: a format=csv request still returns JSON | content-type 'application/json; charset=utf-8': JSON is the only supported format |
| 65 | `E-cpi2012-headline-unique` | verified | CPI 2012: exactly one all-India/combined/General row per month | 12 months, row counts {1} |
| 66 | `E-cpi2012-status-flags` | verified | CPI 2012 rows carry a finality flag (status); record the observed values | status values observed: {'F': 24} (F=final; meaning of other codes not documented here) |
| 67 | `E-cpi2012-first-year-null-inflation` | verified | CPI 2012: no YoY inflation exists for the first year (2013); source gives null, not a value | 12 of 12 months have null inflation (Jan 2013 lacks a prior year) |
| 68 | `E-wpi-headline-unique` | verified | WPI 2022-23: one headline row per month (no group/item rows leak in) | 10 rows |
| 69 | `E-iip-first-12-growth` | verified | IIP 2011-12: growth_rate in the first served year equals index-100 (change from base, not YoY) | max /growth - (index-100)/ = 5.773159728050814e-15 |
| 70 | `E-iip-sector-set-2022-23` | verified | IIP 2022-23 sectors: General plus four sector totals can be requested (category codes 4, 12, 2, 13, 14) | category-total rows per sector (2026): {'Mining & Quarrying': 9, 'Manufacturing': 9, 'Electricity & Gas Supply': 9, 'Water Supply, Sewerage & Waste Management': 9} |
| 71 | `E-schema-stable-cpi2024` | verified | CPI 2024 Current and Back share the same documented field names | common fields 15; only Current: []; only Back: [] |
| 72 | `F-db-1` | verified | live source equals the stored database values: CPI 2024 Current index 2025 | 12 months compared, 0 differ, 0 only at the source |
| 73 | `F-db-2` | verified | live source equals the stored database values: CPI 2024 Back index 2022 | 12 months compared, 0 differ, 0 only at the source |
| 74 | `F-db-3` | verified | live source equals the stored database values: WPI 2022-23 2025 | 12 months compared, 0 differ, 0 only at the source |
| 75 | `F-db-4` | verified | live source equals the stored database values: WPI 2011-12 2021 | 12 months compared, 0 differ, 0 only at the source |
| 76 | `F-db-5` | verified | live source equals the stored database values: IIP 2022-23 General 2025 | 12 months compared, 0 differ, 0 only at the source |
| 77 | `F-db-6` | verified | live source equals the stored database values: IIP 2011-12 General 2021 | 12 months compared, 0 differ, 0 only at the source |
| 78 | `G-stable-1` | verified | WPI 2022-23 2026: a repeated request returns byte-identical data (no intra-day drift) | digest a683ad7970e6 vs a683ad7970e6 |
| 79 | `G-stable-2` | verified | IIP 2022-23 2026: a repeated request returns byte-identical data (no intra-day drift) | digest 3ac78d79b844 vs 3ac78d79b844 |
| 80 | `G-stable-3` | verified | CPI 2012 2021: a repeated request returns byte-identical data (no intra-day drift) | digest a0e208ce295e vs a0e208ce295e |
| 81 | `H-portal-esankhyiki` | verified | https://esankhyiki.mospi.gov.in/ is reachable with verified TLS and has the expected content | HTTP 200, 1198 bytes, missing terms: [] |
| 82 | `H-portal-mospi` | verified | https://www.mospi.gov.in/ is reachable with verified TLS and has the expected content | HTTP 200, 2608 bytes, missing terms: [] |
| 83 | `H-portal-api` | verified | https://api.mospi.gov.in/ is reachable with verified TLS and has the expected content | HTTP 200, 486 bytes, missing terms: [] |
| 84 | `H-portal-oea` | FAILED | https://eaindustry.nic.in/ is reachable with verified TLS and has the expected content | ConnectError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1000) (TLS verification failed; NOT bypassed) |
| 85 | `I-fresh-cpi2024` | verified | CPI 2024 Current: latest month the source serves (lag from today recorded, not judged) | latest 2026-10; 1 month(s) before the current month |
| 86 | `I-fresh-wpi2022` | verified | WPI 2022-23: latest month the source serves (lag from today recorded, not judged) | latest 2026-10; 1 month(s) before the current month |
| 87 | `I-fresh-iip2022` | verified | IIP 2022-23 General: latest month the source serves (lag from today recorded, not judged) | latest 2026-09; 2 month(s) before the current month |
| 88 | `I-fresh-wpi2011` | verified | WPI 2011-12 (legacy): latest month the source serves (lag from today recorded, not judged) | latest 2026-04; 7 month(s) before the current month |
| 89 | `I-fresh-iip2011` | verified | IIP 2011-12 (legacy): latest month the source serves (lag from today recorded, not judged) | latest 2026-03; 8 month(s) before the current month |
| 90 | `I-fresh-cpi2012` | verified | CPI 2012 (legacy): latest month the source serves (lag from today recorded, not judged) | latest 2025-12; 11 month(s) before the current month |

## Failures and what they mean

- `D-cpi-limit-cap`: HTTP 200: Limit parameter too large. Maximum allowed is 100.
- `H-portal-oea`: ConnectError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1000) (TLS verification failed; NOT bypassed)
