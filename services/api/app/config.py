import logging
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("arthasense.config")

PRODUCTION_FRONTEND = "https://arthasense-ai.vercel.app"
LOCAL_FRONTENDS = "http://localhost:5000,http://127.0.0.1:5000,http://localhost:3000,http://127.0.0.1:3000"
DEFAULT_CORS_ORIGINS = f"{PRODUCTION_FRONTEND},{LOCAL_FRONTENDS}"


class Settings(BaseSettings):
    """Read from environment variables or the repo-root .env file (never committed)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="ARTHASENSE_", extra="ignore")

    database_url: str | None = None
    db_connect_timeout_s: int = 2  # health checks: must answer quickly
    api_connect_timeout_s: int = 8  # data endpoints: a hosted database may need a moment
    # Comma-separated list of allowed browser origins, e.g. "https://app.example,http://localhost:5000".
    cors_origins: str = DEFAULT_CORS_ORIGINS


def parse_cors_origins(raw: str) -> list[str]:
    """Clean a comma-separated origin list. Wildcards and malformed entries are dropped (and logged)."""
    out: list[str] = []
    for item in raw.split(","):
        origin = item.strip().rstrip("/")
        if not origin:
            continue
        if origin == "*" or "*" in origin:
            log.warning("ARTHASENSE_CORS_ORIGINS: wildcard origins are not allowed; ignoring %r", origin)
            continue
        if not origin.startswith(("http://", "https://")) or "/" in origin.split("://", 1)[1]:
            log.warning(
                "ARTHASENSE_CORS_ORIGINS: ignoring malformed origin %r (use scheme://host[:port])", origin
            )
            continue
        if origin not in out:
            out.append(origin)
    return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
