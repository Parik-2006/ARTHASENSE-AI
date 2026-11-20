# Team roles

Four responsibilities. Names get added here once the team confirms who takes which role.
Every pull request is reviewed by someone from a **different** role.

| Role | Owns (directories) | Milestones | Day-to-day |
|---|---|---|---|
| **Data engineering** | `pipeline/`, `db/`, `data/` (local only), `docs/m1-data-verification.md` | M1–M4, M11 (ingest schedule) | Source adapters, raw-file archiving, validation, vintages, official linking factors |
| **AI/ML research** | `models/`, `research/` (from M5) | M5–M7, M13 | Backtest harness, SARIMA / XGBoost / Chronos-2 / TimesFM 2.5, calibration, paper experiments |
| **Backend/API** | `services/api/` | M8, M11 (static JSON export) | Read-only endpoints, schemas, health checks, API tests |
| **Frontend/UI** | `apps/web/` | UI foundation now, M9–M10, M12 | Research Desk design system, pages, charts, accessibility |

## Shared rules

- **No secrets in Git.** `.env` is ignored. Use `.env.example` for new variables.
- **No model weights or bulk data in Git.** Weights are downloaded into a local cache; raw files go to `data/raw/` (ignored) and their hashes go into the DB.
- **No fake numbers.** UI work uses `<DemoBadge />` and obviously synthetic values (zeros). Never put a realistic-looking number on screen without a real source.
- **Old and new base years are separate series.** Combining them is only allowed through an official linking factor, stored with its source URL.
- **One milestone per branch**, for example `m3-cpi-ingestion`. Commit messages look like `feat(M3): ...`, `fix(M3): ...` or `docs(M1): ...`.
- **Tests pass before merge:** `pytest`, `ruff check`, and in `apps/web` `npm run lint && npm run typecheck && npm test && npm run build`.
