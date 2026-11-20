"""Shared fixtures. Integration tests use ARTHASENSE_TEST_DATABASE_URL only, never the dev DB."""

import os

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict


def reset_test_database(url: str) -> None:
    """Empty the public schema of a *test* database. Refuses any database not named like a test DB."""
    name = conninfo_to_dict(url).get("dbname", "")
    if "test" not in name:
        raise RuntimeError("refusing to wipe a database whose name does not contain 'test'")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")


@pytest.fixture
def migrated_db_url() -> str:
    """A freshly wiped and fully migrated test database."""
    from db.migrate import migrate

    url = os.environ.get("ARTHASENSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("ARTHASENSE_TEST_DATABASE_URL not set")
    reset_test_database(url)
    migrate(url)
    return url
