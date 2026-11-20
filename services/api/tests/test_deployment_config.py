"""Production-configuration tests: TLS selection, safe health output, CORS allow-list."""

import os
import time

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_CORS_ORIGINS, PRODUCTION_FRONTEND, get_settings, parse_cors_origins
from app.db import check_database, classify_failure, connection_kwargs
from app.main import create_app

VERCEL = "https://arthasense-ai.vercel.app"


@pytest.fixture
def make_client(monkeypatch):
    def _make(origins: str | None = None, database_url: str | None = "postgresql://u:secret@127.0.0.1:1/x"):
        monkeypatch.chdir(os.path.dirname(__file__))  # never pick up a developer's .env
        if origins is None:
            monkeypatch.delenv("ARTHASENSE_CORS_ORIGINS", raising=False)
        else:
            monkeypatch.setenv("ARTHASENSE_CORS_ORIGINS", origins)
        if database_url is None:
            monkeypatch.delenv("ARTHASENSE_DATABASE_URL", raising=False)
        else:
            monkeypatch.setenv("ARTHASENSE_DATABASE_URL", database_url)
        get_settings.cache_clear()
        return TestClient(create_app())

    yield _make
    get_settings.cache_clear()


# ---- TLS / pooler settings --------------------------------------------------------------------------


def test_remote_hosts_get_tls_and_prepared_statements_are_off():
    kw = connection_kwargs(
        "postgresql://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", 8
    )
    assert kw["sslmode"] == "require" and kw["prepare_threshold"] is None and kw["connect_timeout"] == 8


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@127.0.0.1:5432/db",
        "postgresql://u:p@localhost:5432/db",
        "postgresql://u:p@[::1]:5432/db",
        "postgresql://u@/db?host=/var/run/postgresql",
    ],
)
def test_local_hosts_do_not_force_tls(url):
    assert "sslmode" not in connection_kwargs(url, 2)


def test_explicit_sslmode_in_the_url_is_respected():
    kw = connection_kwargs("postgresql://u:p@db.example.com/db?sslmode=verify-full", 2)
    assert "sslmode" not in kw  # libpq reads the URL's own value; we do not override it


def test_password_with_special_characters_must_be_url_encoded_to_parse():
    # '@' inside a password breaks the URL unless encoded as %40: the helper parses the encoded form fine
    ok = connection_kwargs("postgresql://postgres.ref:p%40ss%2Fw%23rd@db.example.com:6543/postgres", 2)
    assert ok["sslmode"] == "require"


# ---- health output never leaks connection details ----------------------------------------------------


@pytest.mark.parametrize(
    "message,expected",
    [
        (
            'connection to server at "2406:da14:25a:5802::a82c", port 5432 failed: Network is unreachable',
            "IPv4 pooler",
        ),
        (
            'connection to server at "10.1.2.3", port 5432 failed: FATAL: password authentication failed for user "postgres"',
            "authentication failed",
        ),
        ("FATAL: Tenant or user not found", "authentication failed"),
        ("connection timeout expired", "timed out"),
        (
            'could not translate host name "db.abc.supabase.co" to address: Name or service not known',
            "could not be resolved",
        ),
        ("FATAL: remaining connection slots are reserved", "limit reached"),
        ("something unexpected at 10.9.9.9:5432", "connection failed"),
    ],
)
def test_failure_reasons_are_classified_and_contain_no_host_ip_port_or_user(message, expected):
    out = classify_failure(Exception(message))
    assert expected in out
    for leaked in ("2406", "10.1.2.3", "10.9.9.9", "5432", "supabase", "postgres", "a82c"):
        assert leaked not in out, leaked


def test_check_database_failure_detail_is_generic():
    res = check_database("postgresql://someuser:topsecret@127.0.0.1:1/privatedb", 1)
    assert res.status == "unavailable"
    for leaked in ("someuser", "topsecret", "privatedb", "127.0.0.1"):
        assert leaked not in (res.detail or "")


def test_health_endpoints_do_not_leak_and_healthz_needs_no_database(make_client):
    c = make_client()
    for path in ("/health", "/health/ready"):
        r = c.get(path)
        assert "127.0.0.1" not in r.text and "secret" not in r.text and "port" not in r.text.lower()
    t0 = time.perf_counter()
    r = c.get("/healthz")  # database is unreachable, yet this must be instant and 200
    assert r.status_code == 200 and r.json() == {"status": "ok", "service": "arthasense-api"}
    assert time.perf_counter() - t0 < 0.5


# ---- CORS ---------------------------------------------------------------------------------------------


def test_default_allow_list_has_the_production_frontend_and_local_origins_but_no_wildcard():
    origins = parse_cors_origins(DEFAULT_CORS_ORIGINS)
    assert (
        PRODUCTION_FRONTEND in origins
        and "http://localhost:5000" in origins
        and "http://127.0.0.1:5000" in origins
    )
    assert "*" not in origins and PRODUCTION_FRONTEND == VERCEL


def test_allowed_origin_gets_cors_headers_disallowed_does_not(make_client):
    c = make_client()
    ok = c.get("/healthz", headers={"Origin": VERCEL})
    assert ok.headers["access-control-allow-origin"] == VERCEL
    assert "access-control-allow-credentials" not in ok.headers  # credentials are never enabled
    assert ok.headers["access-control-allow-origin"] != "*"
    bad = c.get("/healthz", headers={"Origin": "https://evil.example"})
    assert bad.status_code == 200 and "access-control-allow-origin" not in bad.headers
    assert (
        "access-control-allow-origin"
        not in c.get("/healthz", headers={"Origin": "https://arthasense-ai.vercel.app.evil.example"}).headers
    )
    assert (
        "access-control-allow-origin"
        not in c.get("/healthz", headers={"Origin": "http://arthasense-ai.vercel.app"}).headers
    )  # http != https


def test_preflight_for_get_succeeds_and_for_write_methods_is_refused(make_client):
    c = make_client()
    pre = c.options(
        "/api/v1/indicators/cpi", headers={"Origin": VERCEL, "Access-Control-Request-Method": "GET"}
    )
    assert pre.status_code == 200
    assert pre.headers["access-control-allow-origin"] == VERCEL
    assert "GET" in pre.headers["access-control-allow-methods"]
    assert (
        "POST" not in pre.headers["access-control-allow-methods"]
        and "DELETE" not in pre.headers["access-control-allow-methods"]
    )
    for method in ("POST", "PUT", "DELETE", "PATCH"):
        r = c.options(
            "/api/v1/indicators/cpi", headers={"Origin": VERCEL, "Access-Control-Request-Method": method}
        )
        assert r.status_code == 400, method  # "Disallowed CORS method"
    evil = c.options(
        "/api/v1/indicators/cpi",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert evil.status_code == 400


def test_env_variable_replaces_the_allow_list_and_wildcards_are_ignored(make_client):
    c = make_client(
        origins="https://only.example/, https://other.example, *, ftp://x, https://a.example/path"
    )
    assert (
        c.get("/healthz", headers={"Origin": "https://only.example"}).headers["access-control-allow-origin"]
        == "https://only.example"
    )
    assert (
        c.get("/healthz", headers={"Origin": "https://other.example"}).headers["access-control-allow-origin"]
        == "https://other.example"
    )
    assert (
        "access-control-allow-origin" not in c.get("/healthz", headers={"Origin": VERCEL}).headers
    )  # replaced, not merged
    assert (
        "access-control-allow-origin"
        not in c.get("/healthz", headers={"Origin": "https://random.example"}).headers
    )
    assert parse_cors_origins(
        "*, https://a.example/path, ftp://x, https://ok.example/, https://ok.example, "
    ) == ["https://ok.example"]
    assert parse_cors_origins("") == []


def test_data_endpoints_still_require_a_working_database_and_do_not_leak(make_client):
    c = make_client()
    for path in ("/api/v1/indicators/cpi", "/api/v1/forecasting/series"):
        r = c.get(path, headers={"Origin": VERCEL})
        assert r.status_code == 503 and "secret" not in r.text and "127.0.0.1" not in r.text
        assert (
            r.headers["access-control-allow-origin"] == VERCEL
        )  # a failing response is still readable by the allowed origin
    assert make_client(database_url=None).get("/api/v1/indicators/cpi").status_code == 503
