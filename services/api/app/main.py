"""ArthaSense AI read-only API.

M0 scope: health checks only. Data, forecast and report-card endpoints arrive in M8,
and every endpoint will stay read-only (forecasting runs offline).
"""

from typing import Literal

from fastapi import FastAPI, Response
from pydantic import BaseModel

from app import __version__
from app.config import get_settings
from app.db import DbStatus, check_database

app = FastAPI(
    title="ArthaSense AI API",
    version=__version__,
    description="Read-only access to official Indian economic data, stored forecasts and scores.",
)


class DatabaseHealth(BaseModel):
    status: DbStatus
    detail: str | None = None


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    service: str = "arthasense-api"
    version: str = __version__
    database: DatabaseHealth


def _health() -> Health:
    settings = get_settings()
    db = check_database(settings.database_url, settings.db_connect_timeout_s)
    return Health(
        status="ok" if db.status == "ok" else "degraded",
        database=DatabaseHealth(status=db.status, detail=db.detail),
    )


@app.get("/health", response_model=Health, tags=["health"])
def health() -> Health:
    """Liveness: always 200 while the process is up; reports DB state in the body."""
    return _health()


@app.get("/health/ready", response_model=Health, tags=["health"])
def ready(response: Response) -> Health:
    """Readiness: 503 unless the database is reachable."""
    h = _health()
    if h.status != "ok":
        response.status_code = 503
    return h
