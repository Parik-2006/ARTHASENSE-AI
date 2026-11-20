from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from environment variables or the repo-root .env file (never committed)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="ARTHASENSE_", extra="ignore")

    database_url: str | None = None
    db_connect_timeout_s: int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()
