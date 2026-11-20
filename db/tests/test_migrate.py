import os

import psycopg
import pytest

from db.migrate import migrate

pytestmark = pytest.mark.integration


@pytest.fixture
def url():
    u = os.environ.get("ARTHASENSE_TEST_DATABASE_URL")
    if not u:
        pytest.skip("ARTHASENSE_TEST_DATABASE_URL not set")
    with psycopg.connect(u, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS schema_migrations")
    return u


def test_migrate_is_idempotent(url):
    first = migrate(url)
    assert "0000_bootstrap" in first
    assert migrate(url) == []
    with psycopg.connect(url) as conn:
        rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    assert ("0000_bootstrap",) in rows


def test_edited_migration_is_rejected(url):
    migrate(url)
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("UPDATE schema_migrations SET sha256 = 'tampered'")
    with pytest.raises(RuntimeError, match="edited after being applied"):
        migrate(url)
