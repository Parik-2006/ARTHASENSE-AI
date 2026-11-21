# Browser end-to-end checks

Real Chrome driven by `playwright-core` (not a project dependency; install it in a scratch directory).

```
npm i playwright-core                       # in a scratch dir, not in apps/web
# API against the LOCAL database, and a production build of the web app:
python -m uvicorn app.main:app --port 8765  # from services/api, ARTHASENSE_DATABASE_URL = local DB
ARTHASENSE_API_URL=http://127.0.0.1:8765 npm run build && ARTHASENSE_API_URL=http://127.0.0.1:8765 npx next start -p 3114
WEB=http://127.0.0.1:3114 API=http://127.0.0.1:8765 node series-e2e.mjs
```
`series-e2e.mjs` expects the local database described in docs/OFFICIAL-DATA-PLATFORM.md (all 11 series) and a Chrome at
`C:/Program Files/Google/Chrome/Application/chrome.exe` (edit the path for other machines).
`failure-state.mjs` expects the same build started with `ARTHASENSE_API_URL=http://127.0.0.1:9` on port 3115.
