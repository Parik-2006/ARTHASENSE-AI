"""Find the database URL without ever printing it."""

from __future__ import annotations

import os
from pathlib import Path

ENV_VAR = "ARTHASENSE_DATABASE_URL"


def database_url(env_file: Path = Path(".env")) -> str | None:
    """Environment variable first, then the repo-root .env file. Returns None if unset."""
    value = os.environ.get(ENV_VAR)
    if value:
        return value
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, sep, rest = line.partition("=")
            if sep and key.strip() == ENV_VAR:
                return rest.strip().strip("'\"") or None
    return None
