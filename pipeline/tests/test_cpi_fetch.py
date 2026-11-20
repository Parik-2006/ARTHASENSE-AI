"""Offline tests for the CPI fetcher and CLI. All HTTP is mocked."""

import httpx
import pytest

from pipeline.ingest import cpi as cli
from pipeline.ingest.cpi_fetch import FetchError, fetch_year
from pipeline.sources.mospi import MospiClient

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]  # fmt: skip


def row(month):
    return {
        "base_year": "2024", "series": "Current", "year": "2025", "month": month,
        "state": "All India", "sector": "Combined", "division": "CPI (General)",
        "index": "104.10", "inflation": None,
    }  # fmt: skip


def page_payload(page, per_page=10, total=12):
    rows = [row(m) for m in MONTHS][(page - 1) * per_page : page * per_page]
    pages = -(-total // per_page)
    return {
        "data": rows, "statusCode": True,
        "meta_data": {"page": page, "totalRecords": total, "totalPages": pages, "recordPerPage": per_page},
    }  # fmt: skip


def make(handler):
    return MospiClient(client=httpx.Client(transport=httpx.MockTransport(handler)))


def good_handler(req):
    assert req.url.params["division_code"] == "0" and req.url.params["state_code"] == "1"
    assert req.url.params["sector_code"] == "3" and req.url.params["limit"] == "10"
    return httpx.Response(200, json=page_payload(int(req.url.params["page"])))


def no_sleep(_):
    pass


def test_pagination_collects_all_pages():
    result = fetch_year(make(good_handler), 2025, sleep=no_sleep)
    assert len(result.records) == 12 and result.pages == 2 and result.requests == 2


def test_page_size_below_api_minimum_rejected():
    with pytest.raises(ValueError):
        fetch_year(make(good_handler), 2025, page_size=5, sleep=no_sleep)


def test_repeated_page_detected():
    def handler(req):
        p = page_payload(1)  # same rows every time...
        p["meta_data"]["page"] = int(req.url.params["page"])  # ...while claiming to be the requested page
        return httpx.Response(200, json=p)

    with pytest.raises(FetchError, match="repeats"):
        fetch_year(make(handler), 2025, sleep=no_sleep)


def test_wrong_page_answered_detected():
    def handler(req):
        return httpx.Response(200, json=page_payload(1))

    # page 2 request answered with page 1 metadata
    with pytest.raises(FetchError):
        fetch_year(make(handler), 2025, sleep=no_sleep)


def test_incomplete_data_is_an_error():
    def handler(req):
        p = page_payload(int(req.url.params["page"]))
        p["data"] = p["data"][:-1] if p["meta_data"]["page"] == 2 else p["data"]
        return httpx.Response(200, json=p)

    with pytest.raises(FetchError, match="expected 12"):
        fetch_year(make(handler), 2025, sleep=no_sleep)


def test_transient_errors_are_retried_then_succeed():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectTimeout("slow")
        if calls["n"] == 2:
            return httpx.Response(503)
        return httpx.Response(200, json=page_payload(1, per_page=20, total=12))

    waits = []
    result = fetch_year(make(handler), 2025, sleep=waits.append, backoff_s=1)
    assert len(result.records) == 12 and calls["n"] == 3
    assert waits == [1, 2]  # exponential backoff


def test_retries_are_bounded():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(500)

    with pytest.raises(FetchError, match="after 3 attempts"):
        fetch_year(make(handler), 2025, sleep=no_sleep, max_retries=2)
    assert calls["n"] == 3


def test_client_error_is_not_retried():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(400, json={"msg": "limit too small"})

    with pytest.raises(FetchError, match="HTTP 400"):
        fetch_year(make(handler), 2025, sleep=no_sleep)
    assert calls["n"] == 1


def test_malformed_json_and_api_error_payload():
    with pytest.raises(FetchError, match="malformed"):
        fetch_year(make(lambda r: httpx.Response(200, text="<html>")), 2025, sleep=no_sleep)
    bad = {"statusCode": False, "msg": "Invalid year", "data": []}
    with pytest.raises(FetchError, match="Invalid year"):
        fetch_year(make(lambda r: httpx.Response(200, json=bad)), 2025, sleep=no_sleep)


def test_cli_dry_run_end_to_end(capsys, monkeypatch):
    monkeypatch.setattr(cli.time, "sleep", no_sleep)
    monkeypatch.delenv("ARTHASENSE_DATABASE_URL", raising=False)
    code = cli.main(["--year", "2025", "--dry-run", "--delay", "0"], client=make(good_handler))
    out = capsys.readouterr().out
    assert code == 0
    assert "Fetched records: 12" in out and "Validated records: 12" in out
    assert "Missing inflation values: 12" in out
    assert "Database: not touched" in out


def test_cli_fails_clearly_on_invalid_data(capsys, monkeypatch):
    def handler(req):
        p = page_payload(int(req.url.params["page"]))
        p["data"][0]["division"] = "Food and beverages"
        return httpx.Response(200, json=p)

    code = cli.main(["--year", "2025", "--dry-run", "--delay", "0"], client=make(handler))
    assert code == 1 and "FAILED" in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [[], ["--year", "2025", "--start-year", "2025"], ["--start-year", "2025"],
     ["--year", "1999"], ["--start-year", "2024", "--end-year", "2040"], ["--year", "2024", "--delay", "-1"]],
)  # fmt: skip
def test_cli_rejects_bad_ranges(argv, capsys):
    assert cli.main(argv + ["--dry-run"]) == 2
