# ArthaSense AI

Indian economic intelligence: official statistics with their sources, forecasts from evaluated
models, and a public record of how accurate those forecasts were.

> **Status: Milestone 0 (scaffold) + Milestone 1 (data-source verification).**
> No data has been ingested and no models have been trained yet. The site deliberately shows
> no economic figures. See [`docs/m1-data-verification.md`](docs/m1-data-verification.md).

Everything here runs for **₹0**. No paid APIs, databases, hosting or GPUs are required.

## Repository layout

```
apps/web/          Next.js 16 + TypeScript + Tailwind 4 (Research Desk UI)
services/api/      FastAPI, read-only (health checks only, for now)
pipeline/          Python data pipeline; pipeline/verify = M1 read-only source probes
db/                SQL migrations + tiny migration runner
docs/              Verification report, roles, (later) methodology
reports/           Local probe output (git-ignored)
```

Coming later: `models/` (M5–M6) and `research/` (M5, M13).

## Prerequisites (all free)

- Git, Node.js 22 LTS, Python 3.11+ (3.12 recommended)
- PostgreSQL 16, either through Docker Desktop / Docker Engine (`docker compose`) or a native install

## First-time setup

```bash
git clone https://github.com/<owner>/ArthaSense-AI.git
cd ArthaSense-AI
cp .env.example .env              # edit POSTGRES_PASSWORD and the two URLs to match

# 1. Database
docker compose up -d db           # or start your native PostgreSQL 16
#    Native install only: create the databases yourself, for example:
#    createdb arthasense && createdb arthasense_test

# 2. Python (API + pipeline)
python -m venv .venv
source .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m db.migrate              # reads ARTHASENSE_DATABASE_URL from your shell

# 3. Web
cd apps/web && npm ci && cd ../..
```

`db.migrate` and the tests read environment variables, not `.env`. Load them first:
`set -a; source .env; set +a` on macOS/Linux. On Windows PowerShell, set them with `$env:NAME="..."`.

## Run locally

```bash
# terminal 1: API on http://127.0.0.1:8000  (docs at /docs)
cd services/api && uvicorn app.main:app --reload

# terminal 2: web on http://localhost:3000
cd apps/web && npm run dev
```

Open <http://localhost:3000/status>. It should show Web, API and Database all green.

Health endpoints:

| URL | Meaning |
|---|---|
| `GET :8000/health` | Always 200 while the API runs. `database.status` is `ok`, `unavailable` or `not_configured` |
| `GET :8000/health/ready` | 200 only when the database is reachable, otherwise 503 |
| `GET :3000/api/health` | Web app liveness |

## Tests

```bash
pytest -q                          # integration tests need ARTHASENSE_TEST_DATABASE_URL
ruff check . && ruff format --check .
cd apps/web && npm run lint && npm run typecheck && npm test && npm run build
```

CI runs the same steps on every push and pull request (`.github/workflows/ci.yml`).

## CPI ingestion (2024 base)

Fetches monthly CPI from the official MoSPI API, validates it, and stores it in PostgreSQL.
Only **All India / Combined / CPI (General)**, base year 2024, series `Current` is requested.

- Endpoint: `GET https://api.mospi.gov.in/api/cpi/getCPIData`
  (`base_year=2024, series=Current, state_code=1, sector_code=3, division_code=0, year=..., limit=10, page=...`)
- Needs one variable: `ARTHASENSE_DATABASE_URL` (in `.env`; the CLI reads it, nothing is printed).
- CPI **index** and year-on-year **inflation** are stored as two separate series.
  A missing value is never stored as 0 (inflation is `null` in 2025 because the 2024 base has no prior year).
- Each distinct dataset retrieved becomes one row in `releases` (key contains a SHA-256 of the data).
  Re-running with unchanged data changes nothing; changed data creates a new snapshot and keeps the old one.
  `published_at` stays `NULL`: the API gives no publication date, so none is invented.

```powershell
docker compose up -d db                                    # start PostgreSQL
.\.venv\Scripts\python.exe -m db.migrate                   # apply migrations (set ARTHASENSE_DATABASE_URL first)
.\.venv\Scripts\python.exe -m pipeline.ingest.cpi --year 2025 --dry-run   # fetch + validate, DB untouched
.\.venv\Scripts\python.exe -m pipeline.ingest.cpi --year 2025             # real ingestion
.\.venv\Scripts\python.exe -m pipeline.ingest.cpi --help                  # --start-year/--end-year (max 5 years)
```

View the stored data:

```powershell
docker compose exec db psql -U arthasense -d arthasense -c "SELECT s.unit, o.period_date, o.value, r.release_key FROM observations o JOIN series s ON s.id=o.series_id JOIN releases r ON r.id=o.release_id ORDER BY o.period_date;"
```

Call the API (start it as in "Run locally"):

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/v1/indicators/cpi?limit=12" | ConvertTo-Json -Depth 6
```

Query options: `start`, `end` (dates), `limit` (1-240 newest months), `release_key` (one snapshot).
By default each month uses the most recently retrieved snapshot; every value reports its
`release_key` and `retrieved_at`. An empty database returns an empty list plus a note.

Tests: `pytest -q` (mocked HTTP; integration tests need `ARTHASENSE_TEST_DATABASE_URL`, a database
whose name contains `test`, which they wipe).

Known limitations: one series only (no sectors, states or divisions); no publication dates;
the page-size minimum (10) and `page` parameter were verified live for 2025 only; IIP, WPI and GDP are not yet ingested.

## WPI, IIP and research data (Phases 4-6)

Same pattern as CPI: official MoSPI API, validation, release-aware PostgreSQL storage, read-only API
endpoints and a dashboard each. Details, verified source contracts and limits:
[docs/phase4-6-sources-and-research-data.md](docs/phase4-6-sources-and-research-data.md).

```powershell
.\.venv\Scripts\python.exe -m pipeline.ingest.wpi --year 2025 --dry-run       # WPI headline, base 2022-23
.\.venv\Scripts\python.exe -m pipeline.ingest.iip --year 2025 --dry-run       # IIP General + sectors
.\.venv\Scripts\python.exe -m pipeline.ingest.history wpi --start-year 2023 --end-year 2026 --dry-run
.\.venv\Scripts\python.exe -m pipeline.research quality                       # data-quality report
.\.venv\Scripts\python.exe -m pipeline.research export                        # CSV exports in data/exports/
```

API: `GET /api/v1/indicators/wpi`, `/iip`, `/iip/sectors`, and `/cpi?series=back`.
Pages: <http://localhost:5000/indicators> (overview), `/indicators/cpi`, `/indicators/wpi`, `/indicators/iip`.

## Forecasting, dashboard and research (Phases 7-9)

Index-level forecasts for CPI, WPI and IIP with rolling-origin backtesting, honest uncertainty and
reproducible experiments. Index LEVELS are forecast; official inflation/growth rates are never forecast or
mixed with them. Install the forecasting dependencies with `pip install -r requirements-dev.txt`.

```powershell
.\.venv\Scripts\python.exe -m db.migrate                                     # applies 0002_forecasting.sql
.\.venv\Scripts\python.exe -m pipeline.forecasting.cli models                # models, minimum history, availability
.\.venv\Scripts\python.exe -m pipeline.forecasting.cli backtest --indicator wpi --models naive,ets --horizons 1,3
.\.venv\Scripts\python.exe -m pipeline.forecasting.cli forecast --indicator iip --model ets --horizon 3
.\.venv\Scripts\python.exe -m pipeline.forecasting.cli suite --name all --indicator all --save   # reproducible suites
.\.venv\Scripts\python.exe -m pipeline.forecasting.report --out docs/research/generated        # tables + figures
```

Nothing is written to PostgreSQL unless `--save` is given. Rules (documented in `docs/PROGRESS-phases-7-9.md`):
at least 12 months of training, at least 5 usable origins to report any metric, fewer than 12 origins is
"indicative, not rankable"; models are compared only on identical data and origins; a horizon that cannot be
validated on the available history is refused. CPI Current (12 months) is therefore not evaluated.
Chronos-2 and TimesFM 2.5 are optional lazy adapters that report "unavailable" (they need PyTorch and a
0.5-1 GB download that has not been approved); no output is ever invented for them.

API (read-only, stored results): `GET /api/v1/forecasting/models|series|runs|runs/{id}|forecasts|forecasts/latest|scores|comparison`.
Pages: `/forecasting`, `/forecasting/{cpi,wpi,iip}`, `/forecasting/comparison`, `/forecasting/experiments`,
`/intelligence`. Research draft and generated tables: `docs/research/`. Deployment notes: `docs/DEPLOYMENT.md`.

## Verify the data sources (M1)

```bash
python -m pipeline.verify --list   # what will be checked
python -m pipeline.verify          # ~20 small read-only GETs; report saved to reports/verification/
```

Or run **Actions → Verify data sources → Run workflow** on GitHub, then download the report artifact.

## Ground rules

- No secrets, model weights or bulk data in Git (see `.gitignore`).
- No fabricated numbers. UI development uses clearly labelled demo values (`<DemoBadge />`).
- Old-base and new-base statistics are stored as separate series and combined only with
  official linking factors.
- Forecasts are produced offline and stored. The website never runs a model on page load.

Team roles: [`docs/roles.md`](docs/roles.md).

## Licence and attribution

MIT, see [`LICENSE`](LICENSE). This project draws on
[adhishthite/india-economic-dashboard](https://github.com/adhishthite/india-economic-dashboard)
and [nso-india/esankhyiki-mcp](https://github.com/nso-india/esankhyiki-mcp), both MIT. Their notices
and exactly what is used from each are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

ArthaSense AI is a research and decision-support project, not investment advice.
