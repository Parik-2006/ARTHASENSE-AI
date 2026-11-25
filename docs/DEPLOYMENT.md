# Deployment guide: Vercel (web) -> Render (API) -> Supabase (PostgreSQL)

```
Browser --> https://arthasense-ai.vercel.app   (Next.js, server-side data fetching)
                |  ARTHASENSE_API_URL
                v
            https://arthasense-ai.onrender.com (FastAPI, read-only)
                |  ARTHASENSE_DATABASE_URL (secret, TLS)
                v
            Supabase PostgreSQL (Session pooler)
```

The browser never calls the API or the database. Only the Next.js server calls Render, so the API address is a
**server-side** variable (`ARTHASENSE_API_URL`, not `NEXT_PUBLIC_...`): nothing is shipped to the browser. CORS is still
configured on the API as an explicit allow-list for any browser client that calls it directly.

## 1. Environment variables

| Variable | Where | Value | Secret? | After changing |
|---|---|---|---|---|
| `ARTHASENSE_API_URL` | **Vercel** (Production, and Preview if used) | `https://arthasense-ai.onrender.com` (no trailing slash needed) | No | **Redeploy** the Vercel project |
| `ARTHASENSE_SITE_URL` | Vercel (optional) | `https://arthasense-ai.vercel.app` | No | Redeploy |
| `ARTHASENSE_API_TIMEOUT_MS`, `ARTHASENSE_API_ATTEMPTS`, `ARTHASENSE_API_RETRY_DELAY_MS` | Vercel (optional) | defaults `20000`, `2`, `2000` (a sleeping free Render instance can need about a minute) | No | Redeploy |
| `ARTHASENSE_DATABASE_URL` | **Render** | Supabase **Session pooler** URL (see section 3) | **YES** | Render restarts the service automatically |
| `ARTHASENSE_CORS_ORIGINS` | **Render** | `https://arthasense-ai.vercel.app` (comma-separated list; no `*`, no trailing path) | No | Restart (automatic) |
| `ARTHASENSE_API_CONNECT_TIMEOUT_S` | Render (optional) | default `8` | No | Restart |
| `PYTHON_VERSION` | Render | `3.12.4` (the repository also has `.python-version`) | No | Redeploy |
| `ARTHASENSE_TARGET_DATABASE_URL` | **Your PowerShell session only**, for `db.transfer` | the hosted database | **YES** | n/a (never stored) |

Never put the database URL or any Supabase key in Vercel, in a `NEXT_PUBLIC_` variable, in a file in the repository, or in a
chat message. The Supabase JavaScript/Python SDKs and keys (`anon`, `service_role`) are **not used** and must not be added.

## 2. Render (backend)

* Repository `Parik-2006/ARTHASENSE-AI`, branch `main`, Root Directory: *(repository root, leave empty)*.
* Build command: `pip install -r requirements.txt` (the API needs only this file; the forecasting libraries in
  `requirements-ml.txt` are for offline experiments and are NOT installed on Render).
* Start command: `uvicorn app.main:app --app-dir services/api --host 0.0.0.0 --port $PORT` (verified: it imports and serves from the repository root).
* Health Check Path: `/healthz` (instant, no database). `/health` also reports the database state without exposing host, IP, port or user.
* No model weights are downloaded at start-up. The service keeps one short-lived database connection per request and no pool.
* Measured locally in a clean virtual environment containing only `requirements.txt` (24 packages, no numpy/statsmodels/xgboost/torch):
  the start command above serves all endpoints and uses about 72 MB of memory after 15 requests, well inside the 512 MB free plan.
* Free instances sleep when idle: the first request can take up to about a minute. The website retries automatically
  and shows a clear message if the API still is not ready.

## 3. Supabase (database)

1. Supabase Dashboard -> your project -> **Connect** (button labels may differ slightly between dashboard versions) -> choose **Session pooler** (host `aws-0-<region>.pooler.supabase.com`, port `5432`,
   user `postgres.<project-ref>`). Do **not** use the "Direct connection" host `db.<ref>.supabase.co`: it is IPv6-only and Render's
   free tier cannot reach it. That is the cause of `Network is unreachable` seen in production on 2026-11-20.
2. The transaction pooler (port `6543`) is supported by the code (prepared statements are disabled) but has not been tested against a
   real Supabase project; prefer the Session pooler for the API, migrations and the data copy.
3. Replace `[YOUR-PASSWORD]` with the database password. If it contains `@ : / ? # %`, URL-encode those characters
   (`@` -> `%40`, `/` -> `%2F`, `#` -> `%23`, `%` -> `%25`) or reset it to a simple one.
4. TLS is added automatically (`sslmode=require`) for any non-local host.

## 4. First-time database setup (one-off, from your own PC)

Nothing here runs automatically. Type the URL in **your** PowerShell session (it is not saved):

```powershell
cd P:\ArthaSense-AI\ARTHASENSE-AI-final
$env:ARTHASENSE_TARGET_DATABASE_URL = Read-Host "Supabase Session pooler URL"        # paste it, press Enter

# 1) identity and state of the hosted database (read-only; prints no credentials)
$env:ARTHASENSE_DATABASE_URL = $env:ARTHASENSE_TARGET_DATABASE_URL
.\.venv\Scripts\python.exe -m db.verify_target

# 2) create the schema there (migrations 0000, 0001, 0002; recorded with checksums)
.\.venv\Scripts\python.exe -m db.migrate

# 3) copy the existing data: first a DRY RUN with your local database as the source
$env:ARTHASENSE_DATABASE_URL = "<your LOCAL url from .env>"      # source (local); only READ
.\.venv\Scripts\python.exe -m db.transfer                         # dry run: prints the plan, writes nothing

# 4) after reviewing the plan, execute (needs the target database name for confirmation)
.\.venv\Scripts\python.exe -m db.transfer --apply --confirm-target-db postgres
```

The copy moves 8 tables (2,526 rows as of 2026-11-20: 415 observations, 176 forecast runs, 1,195 forecast rows, 718 scores, plus
sources, series and releases) with primary keys and provenance preserved. It only writes into an **empty** target, in one transaction,
and verifies every table's row count and content fingerprint before committing; a non-empty target is never modified, and
re-running after success changes nothing. It is an exact copy of the verified local data, so it needs no calls to MoSPI.

## 5. Vercel (frontend)

* Repository `Parik-2006/ARTHASENSE-AI`, Production Branch `main`, **Root Directory `apps/web`**, Framework Preset Next.js,
  default install (`npm install`/`npm ci`), build (`npm run build`) and output settings.
* Settings -> Environment Variables -> add `ARTHASENSE_API_URL` = `https://arthasense-ai.onrender.com` for **Production**, then
  **Deployments -> Redeploy** (environment variables are read at build/run time of a deployment).
* The build does not need the API: pages fetch data at request time. `/status` shows the configured API address and flags a
  missing `ARTHASENSE_API_URL` as a configuration problem.

## 6. Verify everything together (after the manual steps)

```powershell
$api = "https://arthasense-ai.onrender.com"; $web = "https://arthasense-ai.vercel.app"
Invoke-RestMethod "$api/healthz"                                   # {"status":"ok",...}  (may take ~1 min if asleep)
(Invoke-RestMethod "$api/health").database                         # status "ok", detail "PostgreSQL ..."
(Invoke-RestMethod "$api/api/v1/indicators/cpi?limit=1").observations[0]
(Invoke-RestMethod "$api/api/v1/forecasting/series") | Select indicator, n_observations, forecast_status
(Invoke-WebRequest "$web/indicators/wpi" -UseBasicParsing).Content -match "113\.30"     # True when live data is shown
(Invoke-WebRequest "$web/status" -UseBasicParsing).Content -match "Configuration problem"  # False when configured
```

Expected: 415 observations in total (CPI 12, WPI 43, IIP 360 including growth), forecasting status `has_experiments` for WPI and
IIP, and CPI `insufficient_history`.

## 7. Local development (unchanged)

| Component | Command (PowerShell, repo root) | URL |
|---|---|---|
| PostgreSQL 16 | `docker compose up -d db` | `127.0.0.1:5432` |
| Migrations | `$env:ARTHASENSE_DATABASE_URL="..."; .\.venv\Scripts\python.exe -m db.migrate` | |
| API | `cd services\api; ..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000` | `http://127.0.0.1:8000` |
| Web | `cd apps\web; npm ci; npm run build; npx next start -p 5000` | `http://localhost:5000` |

`ARTHASENSE_API_URL` defaults to `http://127.0.0.1:8000`, so nothing needs configuring locally. The API allows the local origins
`http://localhost:5000` and `http://127.0.0.1:5000` by default.

## 8. Troubleshooting (symptoms seen in production)

| Symptom | Cause | Fix |
|---|---|---|
| Website says "Unable to load ... check the API connection"; `/status` shows `http://127.0.0.1:8000` | `ARTHASENSE_API_URL` is not set on Vercel | set it (section 5) and redeploy |
| Render `/health` says `network unreachable ... IPv4 pooler` | the Supabase *direct* (IPv6-only) URL is in use | use the Session pooler URL (section 3) |
| `authentication failed` | wrong user (`postgres.<project-ref>` for poolers) or password not URL-encoded | fix the URL |
| API `/api/v1/forecasting/*` -> 503 `forecasting tables not migrated` | migration 0002 not applied to that database | `python -m db.migrate` against it |
| First page load is slow after idle | free Render instance waking up | wait about a minute; the site retries automatically |

## 9. Pre-deployment checklist

- [ ] `pytest -q` (with `ARTHASENSE_TEST_DATABASE_URL`), `ruff check .`, `ruff format --check .`
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in `apps/web`
- [ ] No secrets in the repository or the frontend bundle; `.env` not committed
- [ ] Supabase password is URL-encoded and stored only as a Render secret
- [ ] Browser visual check of every page at desktop and about 400 px width (still pending)
- [ ] Ingestion and experiments stay command-line jobs (they are not web endpoints)
