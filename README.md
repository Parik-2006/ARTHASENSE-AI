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
