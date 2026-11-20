# M1 — Data-source verification report

**Checked:** 19 Nov 2026 (IST) · **Scope:** read-only. No ingestion, no database writes, no model downloads.
**Re-run:** `python -m pipeline.verify`, or the "Verify data sources" GitHub Actions workflow.

Every row below carries one of these evidence levels:

- **L (live):** an actual request to the official endpoint on 19 Nov 2026 returned this.
- **D (documented):** stated in an official MoSPI / OEA / PIB document (links at the end).
- **P (pending):** not confirmed yet. The probe exists and the team must run it, because our build
  sandbox's network blocks government hosts. Treat these values as unverified.

---

## 1. Headline findings

1. **Use MoSPI's REST API directly, not MCP.** The MoSPI MCP server is open source (MIT,
   `nso-india/esankhyiki-mcp`) and is a thin wrapper around a public REST API at
   `api.mospi.gov.in`. That API needs **no key** and returns plain JSON with pagination (L).
   Our pipeline calls it directly (`pipeline/sources/mospi.py`).
2. **The reference repo's MCP integration is out of date.** It calls tools named
   `1_know_about_mospi_api` … `4_get_data`. The current server exposes `list_datasets`,
   `get_indicators`, `get_metadata` and `get_data` (D: server source at commit `5317aa0`;
   live MCP call pending, P).
3. **All four new base years are served** by the API's base-year endpoints: CPI `2024`, IIP `2022-23`,
   WPI `2022-23` (L), and NAS `2022-23` (L, via data).
4. **The API serves only the latest values, so it has no vintages.** For example, the CPI 2012
   series returns one value per month, and a provisional figure is overwritten when it is
   finalised. To backtest without leakage we must (a) **snapshot every release from now on**, and
   (b) for the past, either rebuild first-release values from archived press releases or use a
   documented "publication-lag only" approximation. **Decision needed (Section 6).**
5. **New-base CPI is short:** index values run Jan 2025 → Oct 2026 (22 months), and YoY inflation
   runs Jan 2026 → Oct 2026 (10 months) (L + D). That is far too short for fine-tuning. The
   official linked back series extends the **all-India general index only** to Jan 2013 (D).
6. **New-base GDP is shorter still:** 13 quarters of real growth (2023-24 Q1 → 2026-27 Q1) (L). The
   official back series is promised by Dec 2026 and is not published yet (D). GDP forecasting
   stays out of scope until it appears.
7. **Model licences confirmed:** Chronos-2 and TimesFM 2.5 are both Apache-2.0 on Hugging Face (L).

---

## 2. Sources

| Source | Access | Key / card | Status | Use in ArthaSense |
|---|---|---|---|---|
| MoSPI eSankhyiki REST API `api.mospi.gov.in` | JSON over HTTPS, paginated (`limit`, `page`, `meta_data.totalRecords`) | None | **L: working** | CPI, IIP, WPI, NAS, RBI-sourced FX |
| MoSPI MCP server `mcp.mospi.gov.in` | MCP over HTTP (4 read-only tools) | None | D (open-source code); live call P | Optional: later assistant work only |
| Office of the Economic Adviser `eaindustry.nic.in` | HTML pages + downloadable files | None | **L: linking-factor page** | WPI/PPI linking factors, archived releases |
| RBI (`rbi.org.in`, DBIE `data.rbi.org.in`) | Web pages / downloads. **No public API found** | None | P | Repo rate (curated table, see 3.6) |
| World Bank API | JSON | None | P | Annual context only |
| Hugging Face Hub (model metadata) | JSON | None | **L** | Licence and size checks; weights downloaded later, never committed |

---

## 3. Series availability

### 3.1 CPI (MoSPI / NSO)

| Series | Endpoint · params | Coverage | Evidence |
|---|---|---|---|
| **CPI 2024=100, Current** | `/api/cpi/getCPIData` · `base_year=2024&series=Current` | Index from **Jan 2025**; YoY from **Jan 2026**; latest **Oct 2026**. All-India + states, Rural/Urban/Combined, division → item level (2026 alone: 688,040 rows) | L (latest month, fields), D (start dates) |
| **CPI 2024=100, Back (official)** | same, `series=Back` | All-India **general index**, Rural/Urban/Combined, **Jan 2013 – Dec 2024**; YoY Jan 2014 – Dec 2024 | D. L: 2013 returns 36 rows (12 months × 3 sectors) |
| CPI 2012=100 (old) | `/api/cpi/getCPIIndex` · `base_year=2012&series=Current&state_code=99&sector_code=3&group_code=0` | Ends **Dec 2025** (Dec 2025 combined general: index 198.0, YoY 1.33%) | L, D |

**Fields, CPI 2024:** `base_year, series, year, month, state, sector, division, group, class, sub_class, item, code, index, inflation, imputation`.
**Fields, CPI 2012:** `baseyear, year, month, state, sector, group, subgroup, index, inflation, status`. The two schemas differ, so they need separate parsers (M3).

**Official linking factors, CPI 2012 → 2024 (general index only)** (D):

| Sector | Linking factor |
|---|---|
| Rural | 0.5222 |
| Urban | 0.5320 |
| Combined | 0.5267 |

- **Method:** ratio of the 2025 annual average (geometric mean) of the new series to that of the old series. Back value = old index × factor. Overlap year: 2025.
- **Arithmetic check:** 198.0 (Dec 2025, old) × 0.5267 = 104.29 on the new base.
- **Rule for the pipeline:** MoSPI publishes factors only at the general level, so ArthaSense links **only the all-India general index** (R/U/C). Groups, divisions and states are not linked, because no official factor exists for them.

### 3.2 IIP (MoSPI / NSO)

| Series | Endpoint · params | Coverage | Evidence |
|---|---|---|---|
| **IIP 2022-23** | `/api/iip/getIipData` · `base_year=2022-23&frequency=Monthly` | Index from **Apr 2023**; latest returned **Sep 2026**; types General/Sectoral; 1,806 rows for the queried year | L (latest, fields), D (start) |
| IIP 2011-12 (old) | same, `base_year=2011-12` | Last month to be confirmed | P |

- **Fields:** `base_year, year, month, type, category, sub_category, index, growth_rate`.
- **Release lag:** about 28 days after the reference month (D). Revised and final estimates come in later releases (D), which is another reason we need vintages.
- **Official linking factors 2011-12 → 2022-23** (D), geometric-mean method. Linked value = old index **÷** factor:

| Sector | Factor |
|---|---|
| Mining & Quarrying | 1.1890 |
| Manufacturing | 1.3700 |
| Electricity | 1.8495 |
| General | 1.3834 |

- The new sector (water supply, sewerage and waste management) has **no** factor, because it wasn't covered before.
- **Watch-outs:**
  - The MCP repo's static swagger lists only `2011-12` for IIP, but the live base-year endpoint includes `2022-23` (L). Trust the live endpoints, not the static docs.
  - Querying `financial_year=2025-26` returned rows labelled year 2026 / September. The filter semantics must be checked before ingestion (P).

### 3.3 WPI (Office of the Economic Adviser, served via MoSPI API)

| Series | Endpoint · params | Coverage | Evidence |
|---|---|---|---|
| **WPI 2022-23** | `/api/wpi/getWpiRecords` · `base_year=2022-23` | Latest **Oct 2026**; 11,370 rows for 2026 (major group → item). Old 2011-12 series discontinued from the new release | L (latest, fields), D (discontinued) |
| WPI 2011-12 (old) | same, `base_year=2011-12` | 2012 onward, discontinued. Final month to be confirmed | P |

- **Fields:** `base_year, year, month, major_group, group, sub_group, sub_sub_group, item, index_value`.
- **Inflation is not a field.** YoY must be computed from the index, so a new-base YoY series starts 12 months after the new index starts.
- **Official linking factors 2011-12 → 2022-23** (L, OEA page): ratio of geometric means of the 12 monthly indices for FY 2024-25. OEA advises caution; factors are given only for All Commodities and the Major Groups.

| Major group | Factor |
|---|---|
| All Commodities | 1.53 |
| Primary Articles | 1.71 |
| Fuel & Power | 1.65 |
| Manufactured Products | 1.44 |

### 3.4 GDP (NAS)

| Series | Endpoint · params | Coverage | Evidence |
|---|---|---|---|
| **Quarterly GDP growth, 2022-23 base** | `/api/nas/getNASData` · `base_year=2022-23&series=Current&frequency_code=Quarterly&indicator_code=22` | **13 quarters**: 2023-24 Q1 → 2026-27 Q1 (latest 7.8% real, 10.3% nominal) | L |
| 2011-12 base, `series=Back` | same, `base_year=2011-12&series=Back` | Exists according to the API spec | P |
| **Official back series on the 2022-23 base** | — | **Not yet published.** Promised by Dec 2026 | D |

- **Fields:** `base_year, series, year, indicator, frequency, revision, quarter, current_price, constant_price, unit`.
- Values come as strings with a `%` sign, so they must be parsed (M3).
- A `revision` field exists. Record it with every vintage.

### 3.5 RBI data via MoSPI

The MoSPI API's `RBI` dataset has 39 indicators (D: definitions file), including **monthly
average exchange rates** (indicator 36, a useful INR/USD covariate). It does **not** include the
policy repo rate.

### 3.6 Policy repo rate

No free, documented API was found. The repo rate changes only a few times a year, so the plan is
a small **hand-curated CSV in the repo**: effective date, rate, and the URL of the RBI Monetary
Policy Statement. Each row is checked by a second team member. Paid "interest-rate APIs" that
resell this data are excluded on cost and provenance grounds.

### 3.7 Covariates for later (M4)

| Need | Planned source | Status |
|---|---|---|
| INR/USD | MoSPI `RBI` dataset, indicator 36 | D; probe P |
| Crude oil, food prices (monthly) | World Bank commodity price data (free download) | P: exact file URL to confirm in M4 |
| Long CPI history (for panel experiments) | Labour Bureau CPI-IW, MoSPI CPI-AL/RL (`CPIALRL` dataset) | P |

---

## 4. Pretrained models (metadata only, nothing downloaded)

| Model | Hugging Face id | Licence | Parameters (safetensors) | Last modified | Evidence |
|---|---|---|---|---|---|
| Chronos-2 | `amazon/chronos-2` | **Apache-2.0** | 119,477,664 | 2026-06-05 | L |
| TimesFM 2.5 | `google/timesfm-2.5-200m-pytorch` | **Apache-2.0** | 231,289,280 | 2025-10-02 | L |

TimesFM 2.5 is published as "200M", but the checkpoint holds about 231M parameters (likely
including the optional quantile head). Both run on CPU for our series sizes. That gets checked in M6.

---

## 5. What this changes in the plan

| Plan item | Change |
|---|---|
| Ingestion (M3) | Call `api.mospi.gov.in` directly. Write separate parsers for CPI-2024 and CPI-2012 schemas. Paginate on `meta_data.totalPages`. Strip `%` from NAS values. |
| Vintages (M2/M3) | **Start snapshotting on day one.** Each run stores the full response and its hash as a new `release`. |
| Linking (M4) | Link only where an official factor exists: CPI general (R/U/C), IIP general and 3 sectors, WPI All + 3 major groups. Note the opposite directions: CPI multiplies, IIP divides. |
| Research (M13) | The rebasing experiment is well defined: new-only (22/10 points) vs official-linked (2013→) vs old-only (→ Dec 2025), at the all-India general level. |
| Fine-tuning | Confirmed infeasible on new-base CPI alone. Only consider it on panels of old-base or linked series, and only after the M5–M7 baselines. |
| GDP | Display only (M9). No forecasting until the 2022-23 back series is published. |

---

## 6. Decisions needed from the team

1. **Historical vintages.** Do we (a) rebuild first-release CPI/IIP values from archived MoSPI press
   releases (more work, a stronger paper), or (b) use a publication-lag-only pseudo-real-time
   design and state it as a limitation? Either way, live snapshots start in M3.
2. **Repo-rate CSV.** Agree that a curated table, with a source URL on every row, is acceptable.
3. **Who runs the pending (P) probes**, on a home or college network or via the GitHub workflow,
   before M3 starts.

---

## 7. References

- MoSPI, *First press release of CPI on base 2024=100* (Jan 2026 data), 12 Feb 2026: <https://www.mospi.gov.in/uploads/latestReleases/latest_release_1770891893893_6b458c0a-c327-4fef-a554-41131ea67273_Press_Relase_of_CPI_for_Jan26.pdf>
- MoSPI, *FAQs on CPI 2024 series* (Annexure V): <https://www.mospi.gov.in/uploads/documents/documents/1770891066052-Annexure_V.pdf>
- PIB, CPI base revision (inflation on the 2024 base from Jan 2026; the 2012 series up to Dec 2025): <https://www.pib.gov.in/PressReleasePage.aspx?PRID=2291051>
- MoSPI, *Press note on new series of GDP estimates, base 2022-23*, 27 Feb 2026: <https://www.mospi.gov.in/uploads/latestReleases/latest_release_1772189865181_f040336d-bc57-4aed-b80f-586d9ccb279e_Press_Note_on_New_Series_of_GDP_Estimates_with_Base_Year_2022-23_27022026.pdf>
- PIB, *New series of GDP estimates* (back series expected by Dec 2026): <https://www.pib.gov.in/PressReleasePage.aspx?PRID=2233518>
- NSO microdata catalogue, *IIP base 2022-23* metadata and linking factors: <https://microdata.gov.in/nada/index.php/catalog/299>
- OEA, *Linking factor for WPI series (base 2022-23)*: <https://eaindustry.nic.in/linking_factor2223.asp>
- `nso-india/esankhyiki-mcp` (MIT), commit `5317aa0`: <https://github.com/nso-india/esankhyiki-mcp>
- Hugging Face model APIs: `amazon/chronos-2`, `google/timesfm-2.5-200m-pytorch`
