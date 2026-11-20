"""ArthaSense AI read-only API.

Every endpoint is read-only (forecasting runs offline). The Next.js frontend calls this API from its
server, so browsers normally never reach it directly; CORS is still configured explicitly (an allow-list
from ARTHASENSE_CORS_ORIGINS, never a wildcard) for any browser client that does.
"""

from typing import Literal

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import __version__
from app.config import get_settings, parse_cors_origins
from app.db import DbStatus, check_database
from app.forecasting import router as forecasting_router
from app.indicators import router as indicators_router


class DatabaseHealth(BaseModel):
    status: DbStatus
    detail: str | None = None


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    service: str = "arthasense-api"
    version: str = __version__
    database: DatabaseHealth


class Alive(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "arthasense-api"


def _health() -> Health:
    settings = get_settings()
    db = check_database(settings.database_url, settings.db_connect_timeout_s)
    return Health(
        status="ok" if db.status == "ok" else "degraded",
        database=DatabaseHealth(status=db.status, detail=db.detail),
    )


def create_app() -> FastAPI:
    app = FastAPI(
        title="ArthaSense AI API",
        version=__version__,
        description="Read-only access to official Indian economic data, stored forecasts and scores.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=parse_cors_origins(get_settings().cors_origins),
        allow_credentials=False,  # no cookies or auth headers are used
        allow_methods=["GET", "HEAD", "OPTIONS"],  # the API is read-only
        allow_headers=["Accept", "Content-Type"],
        max_age=600,
    )
    app.include_router(indicators_router)
    app.include_router(forecasting_router)

    @app.get("/healthz", response_model=Alive, tags=["health"])
    def healthz() -> Alive:
        """Cheapest possible liveness probe: no database access. Use this for the host's health check."""
        return Alive()

    @app.get("/health", response_model=Health, tags=["health"])
    def health() -> Health:
        """Liveness plus database state: always 200 while the process is up."""
        return _health()

    @app.get("/health/ready", response_model=Health, tags=["health"])
    def ready(response: Response) -> Health:
        """Readiness: 503 unless the database is reachable."""
        h = _health()
        if h.status != "ok":
            response.status_code = 503
        return h

    return app


app = create_app()
