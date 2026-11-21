# Government source discovery report

Run date: 2026-11-21 (all times UTC). Evidence levels follow `docs/m1-data-verification.md`:
**L** = live request or document read in this audit · **D** = documented in a document I could read · **P** = pending (not verified here).

Machine-readable evidence: `reports/government-query-matrix.csv` (70 rows) and `reports/government-query-results.json`
(full per-case records). Raw response bytes are stored by sha256 under `data/evidence/raw/` (git-ignored; see
`docs/DATABASE-PRODUCTION-SAFETY.md` for retention). Re-run: `python -m pipeline.sourceaudit` (cached; `--refresh` re-requests).

## 0. Correction to my earlier report

My report on `govdata/foundation` said no official linking factor was found and that CPI had 38 of 60 months. **Both were
wrong.** I had searched the API only, not the repository's own verification record or the publisher's documents. The facts:

- MoSPI's CPI-2024 FAQ (Annexure V, Q36-38) states that the **Back series is calculated with a linking factor**
  and gives the factors (Rural 0.5222, Urban 0.5320, Combined 0.5267), the formula and the overlap year. **(L: PDF read here.)**
- The Back series covers **Jan 2013 – Dec 2024** at source; I had backfilled only 2020 onward. It is now stored from 2013.
- CPI Back + Current is therefore MoSPI's own linked headline on base 2024: 166 months, Jan 2013 – Oct 2026.
- WPI and IIP linking factors exist and reproduce from stored data (section 5).

`docs/DATA-FOUNDATION.md` carries a correction note pointing here.

## 1. Document evidence register

| Document | Location | Publisher | Date / version | Verified contents | Gaps |
|---|---|---|---|---|---|
| FAQs on CPI 2024 series, Annexure V | `mospi.gov.in/uploads/documents/documents/1770891066052-Annexure_V.pdf` (7 pp, sha256 `7720b640…`) | MoSPI | back-series release 12 Feb 2026 | Q36 Back series Jan 2013–Dec 2024 (indices) and Jan 2014–Dec 2024 (inflation); Q37 linking formula LF = GM(new)/GM(old) over overlap year 2025, linked = old × LF; Q38 factors 0.5222 / 0.5320 / 0.5267 **(L)** | General level only; no group/division factors |
| Swagger manuals CPI, IIP, WPI, RBI, NAS | `github.com/nso-india/esankhyiki-mcp` @ `5317aa0` `swagger/swagger_user_*.yaml` | NSO (MIT-licensed repo) | commit `5317aa0` (still HEAD) | Endpoints, parameter names, `Format` ∈ {JSON, CSV}, `limit`, `page` **(L)** | Static; live API differs in places (section 3) |
| MCP README | same repo, `README.md` | NSO | `5317aa0` | Tools: `list_datasets`, `get_indicators`, `get_metadata`, `get_data` **(L: matches live)** | — |
| Live MCP `tools/list` | `https://mcp.mospi.gov.in/` | MoSPI | server v2.3.0 | Same four tools **(L)**. The brief's `1_know_about_mospi_api … 4_get_data` names **do not exist** on this server | — |
| NSO IIP 2022-23 metadata | `microdata.gov.in/nada/index.php/catalog/299` | NSO | created 25 Jun 2026, modified 5 Nov 2026 | States the geometric-mean linking method and that factors exist at General and sectoral level **(L)** | **No numeric factors on the page** |
| OEA WPI linking factor (2022-23) | `eaindustry.nic.in/linking_factor2223.asp` | Office of the Economic Adviser | — | **Not read: TLS verification fails** (incomplete certificate chain) in two independent clients. Not bypassed. | Factor 1.53 known only via `docs/m1-data-verification.md` **(D)** |
| `docs/m1-data-verification.md` | this repo | ArthaSense | 19 Nov 2026 | Earlier L/D/P record; its linking tables are re-checked in section 5 | Contained "pending" probes |
| `docs/phase4-6-sources-and-research-data.md` | this repo | ArthaSense | 20 Nov 2026 | Source contracts, IIP growth rule | WPI 2011-12 marked "unverified" (now verified) |
| eSankhyiki CMS Swagger (`/api-docs`) | `api.mospi.gov.in/api-docs` | MoSPI | v1.0.0 | **CMS admin API only** (login, infographics). Not a data manual; no route was called | — |
| "Previous 60-step log / metadata document" | searched `docs/`, `reports/`, all worktrees, git history grep | — | — | **Not found.** `reports/verification/` is empty. I reconstructed the investigation from the manuals above | — |

Not found anywhere: an official publication calendar, a revision policy, provisional/final flags for WPI/IIP, publication dates.

## 2. Official sources checked

| Source | Result |
|---|---|
| `api.mospi.gov.in` (REST) | **L** working, keyless JSON, paginated |
| `mcp.mospi.gov.in` | **L** Streamable HTTP; replies as `text/event-stream`; session via `initialize` + `notifications/initialized` |
| `esankhyiki.mospi.gov.in`, `www.mospi.gov.in`, `microdata.gov.in`, `rbi.org.in` | HTTP 200 (existence only; not data sources used) |
| `eaindustry.nic.in` (OEA) | **TLS verification failed**; not reachable by a verified client here |
| RBI | MCP `get_indicators RBI` lists 39 indicators; **none is a repo/policy rate** **(L)** |
| NAS | `getNASData` 2022-23 quarterly returns 13 quarters **(L)** |

No third-party aggregator was used as a source of any stored value.

## 3. What the 70 cases showed

Outcomes: **43 returned data, 10 returned an empty result, 14 were documents/metadata, 2 were rejected (HTTP 400), 1 failed TLS.**
Three formats were **not executed** because nothing documents them: XLSX, XLS and ZIP (see `UNSUPPORTED` in
`pipeline/sourceaudit/cases.py`). They are not counted. Two earlier probes used endpoint names I had guessed
(`getRbiBaseYear`, `getNASBaseYear`); they returned the site's HTML shell, which breaks the rule against inventing endpoints,
so they were removed and replaced by documented calls (cases 67-68).

| Finding | Cases | Consequence |
|---|---|---|
| **An invalid `base_year` is silently answered with another base.** `base_year=1899-00` returned 12 rows with `base_year=2011-12` | 62 | Never trust the request echo. Our validators check `base_year` inside every record, so ingestion is protected. |
| `financial_year=2025-26` is **ignored**: all 42 months of 2022-23 returned | 59 | Use `year`, never `financial_year` (confirms the earlier "unverified" note) |
| `Format=CSV` works for WPI but returns **header-only** for CPI-2012 and IIP | 17, 18, 19 | CSV export is unreliable; JSON only |
| `Accept: text/csv` without `Format` is ignored (JSON returned) | 20 | No content negotiation |
| Comma-separated years: **WPI accepts** (24 rows for 2024,2025) but **CPI-2024 rejects with HTTP 400** | 38, 48 | One year per request, as the pipeline already does |
| `limit=201` → HTTP 400 | 61 | Page-size cap of 200 confirmed |
| Unknown filter code → empty result (not an error); page past the end → empty | 64, 66 | Empty ≠ "no data exists": check totals |
| MCP `get_data` equals REST exactly: WPI 2022-23 Mar 2025 = 100.6; CPI 2024 Jan 2026 = 104.45 / inflation 2.74 | 69, 70 | Two channels agree |
| CPI-2012 rows carry `status: "F"` (a **final** flag). CPI-2024, WPI and IIP rows carry no flag | 31 | Only CPI 2012 offers provisional/final information |
| IIP 2011-12, April 2021: **index present** (General 126.1; Mining 107.6; Manufacturing 124.6; Electricity 174.0), `growth_rate` is **null** | 53, 55 | The gap is the source's. We store the index and leave the rate missing. |
| WPI 2011-12 last served month **Apr 2026**; IIP 2011-12 last **Mar 2026**; WPI 2022-23 to Oct 2026, IIP 2022-23 to Sep 2026 | 40, 43, 50, 54 | Legacy bases have stopped at source |
| CPI-2024 Back: 2013 → 12 months, 2012 → empty, 2024 → 12 months. CPI-2012: 2013–Dec 2025, 2026 empty | 27–33 | Back = Jan 2013–Dec 2024 as documented |
| **IIP 2004-05 is served** (12 months of 2010 returned, case 58). My WPI 2004-05 probe was **empty** because I used the 2022-23 headline code (case 46: probe error, not proof of absence), and my CPI 2010 probe was empty (case 37). WPI 1993-94 / 2004-05 and IIP 1993-94 rows exist in the shared local DB, written by **another worktree**; I did not verify them | 46, 58, 37 | Not ingested by this branch (see section 6) |
| IIP exposes **use-based categories** (Primary, Capital, Intermediate, Infrastructure/Construction, Consumer Durables, Consumer Non-durables) in both bases | 14, 56 | Not ingested; new dataset opportunity |
| WPI exposes 4 major groups (Primary articles; Fuel & power; Manufactured products; headline) in both bases; field spelling differs by base (`major_group` vs `majorgroup`) | 44, 45 | Headline validator accepts both spellings and still rejects other groups |

Transport: JSON (nested and flat), JSON-RPC over Server-Sent Events, CSV (partial), HTML, PDF were all exercised. Responsible
rate: requests were spaced ≥ 0.6 s, one attempt per case, 71 live requests in total, then cached.

**Provenance note.** All 70 cases were run live earlier today (see `retrieved_at` on each record). The final
`government-query-*.json/csv` were regenerated from the on-disk cache, so every record shows `from_cache: true`; that flag
means "this report was assembled from the cache", and the original live retrieval time is preserved.

## 4. MCP tools (live ground truth)

`list_datasets`, `get_indicators(dataset)`, `get_metadata(dataset, user_query?)`, `get_data(dataset, filters)`. The optional
`user_query` is documented as captured by the publisher; **this audit never sent it**.

## 5. Linking factors: evidence and reproduction

| Indicator | Factor (documented) | Evidence | Reproduction from stored data |
|---|---|---|---|
| CPI Combined | 0.5267 (Rural 0.5222, Urban 0.5320) | **L**: primary PDF | Recomputed LF = GM(2024-base 2025)/GM(2012-base 2025) = **0.5267**. CPI-2012 × 0.5267 equals the stored Back series for all of 2024 to within 0.047 index points (rounding). |
| IIP General / Mining / Manufacturing / Electricity | 1.3834 / 1.1890 / 1.3700 / 1.8495 | **D**: repo record; NSO page confirms the geometric-mean method but not the numbers | GM of the stored 2011-12 index over FY2022-23 ÷ 100 = **1.3834 / 1.1890 / 1.3700 / 1.8495** (4 of 4 exact) |
| WPI All commodities | 1.53 | **D**: repo record; OEA page unreadable here | GM(old)/GM(new), FY2024-25 = **1.5327** (published to 2 d.p.) |

Directions (carry an old value to the new base): CPI × factor; IIP ÷ factor; WPI ÷ factor. Codified in
`pipeline/ingest/linking.py` with the evidence level on every entry. **Reproduction is a consistency check, not a derivation:**
no factor was computed from overlap and adopted. Linked values are never stored as observations.

## 6. What this audit did not do

- Did not ingest WPI/IIP 2004-05 or 1993-94 or CPI 2010/2012 on this branch. **Another worktree did** (section 7 of `MASTER-AUDIT-SUMMARY.md`).
- Did not verify per-dataset publication calendars, revision policy or any publication date. None is available from the sources reached.
- Did not read the OEA linking page or the numeric IIP table in their primary form.
- Did not test rate-limit behaviour beyond the documented page cap (deliberately: no stress on government infrastructure).
