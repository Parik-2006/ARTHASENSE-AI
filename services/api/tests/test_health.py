import os

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture
def client(monkeypatch):
    def _make(database_url: str | None):
        if database_url is None:
            monkeypatch.delenv("ARTHASENSE_DATABASE_URL", raising=False)
        else:
            monkeypatch.setenv("ARTHASENSE_DATABASE_URL", database_url)
        monkeypatch.chdir(os.path.dirname(__file__))  # don't pick up a developer's .env
        get_settings.cache_clear()
        return TestClient(app)

    yield _make
    get_settings.cache_clear()


def test_health_without_database_config(client):
    r = client(None).get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["database"]["status"] == "not_configured"


def test_ready_is_503_when_database_unreachable(client):
    # Port 1 on localhost: nothing listens there, so the connection fails fast.
    url = "postgresql://nobody:secret@127.0.0.1:1/none"
    r = client(url).get("/health/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["database"]["status"] == "unavailable"
    assert "secret" not in r.text  # never leak credentials


@pytest.mark.integration
def test_health_with_real_database(client):
    url = os.environ.get("ARTHASENSE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("ARTHASENSE_TEST_DATABASE_URL not set")
    c = client(url)
    assert c.get("/health/ready").status_code == 200
    body = c.get("/health").json()
    assert body["status"] == "ok"
    assert body["database"]["detail"].startswith("PostgreSQL ")
