# Deployment preparation (nothing is deployed)

ArthaSense AI runs fully locally and at zero cost. This page records how to run it, what to configure
and what to check before any public deployment. **No public deployment has been made and none should be
made without explicit approval.** Free hosting tiers change; verify current terms before relying on one.

## Components and ports

| Component | Command (PowerShell, repo root) | Default URL |
|---|---|---|
| PostgreSQL 16 | `docker compose up -d db` | `127.0.0.1:5432` |
| Migrations | `$env:ARTHASENSE_DATABASE_URL="..."; .\.venv\Scripts\python.exe -m db.migrate` | |
| API (FastAPI) | `cd services\api; ..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000` | `http://127.0.0.1:8000` (`/docs`, `/health`, `/health/ready`) |
| Web (Next.js) | `cd apps\web; npm ci; npm run build; npx next start -p 5000` | `http://localhost:5000` |

## Environment variables (names only; never commit values)

| Variable | Used by | Notes |
|---|---|---|
| `ARTHASENSE_DATABASE_URL` | API, pipeline, migrations | read from the environment or the repo-root `.env` (git-ignored) |
| `ARTHASENSE_TEST_DATABASE_URL` | tests only | must name a database containing `test`; tests WIPE it |
| `ARTHASENSE_API_URL` | web (server side only) | default `http://127.0.0.1:8000`; never exposed to the browser |
| `ARTHASENSE_ALLOW_MODEL_DOWNLOAD` | foundation-model adapters | leave unset; `1` permits a 0.5-1 GB weight download |
| `POSTGRES_USER/PASSWORD/DB/PORT` | docker compose | local container settings |

The browser never talks to FastAPI or MoSPI: the Next.js server fetches stored data, so no CORS
configuration is needed and none is enabled. The API is read-only and has no authentication because it
serves only public statistics; if it is ever exposed publicly, put it behind a reverse proxy with rate
limiting.

## Database

* Apply migrations once per environment (`db.migrate` refuses to run if an applied migration file changed).
* `0002_forecasting.sql` is additive (new columns, constraints, indexes). It does not modify observations.
* Back up before a production migration: `docker compose exec db pg_dump -U <user> <db> > backup.sql`.
* Forecast experiments are produced offline: `python -m pipeline.forecasting.cli suite --name all --indicator all --save`
  (idempotent: re-running stores nothing twice).

## Health checks

* `GET /health` always 200 with database state in the body; `GET /health/ready` is 503 unless PostgreSQL is reachable.
* Web liveness: `GET /api/health`.

## Pre-deployment checklist

- [ ] `pytest -q` (with `ARTHASENSE_TEST_DATABASE_URL`), `ruff check .`, `ruff format --check .`
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in `apps/web`
- [ ] No secrets in the repository or the frontend bundle (see the security review in the final report)
- [ ] `.env` is not committed; production secrets come from the host's secret store
- [ ] Database is not publicly reachable (compose binds to `127.0.0.1`)
- [ ] Browser visual check of every page at desktop and about 400 px width (still pending)
- [ ] Decide who may run ingestion and experiments (they are command-line jobs, not web endpoints)

## Possible free options (unverified, may change)

Static/serverless hosting for the Next.js app, a free container host for FastAPI, and a free managed
PostgreSQL tier are the usual combination. Because free tiers can disappear, the project stays fully usable
locally with Docker Compose.
