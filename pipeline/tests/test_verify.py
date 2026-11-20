"""Offline tests for the M1 probes. Responses are mocked; no network is used."""

import json

import httpx

from pipeline.sources.mospi import BASE_URL, MospiClient, records, total_records
from pipeline.verify.probes import PROBES, Probe, _periods, run_probe

CPI_2024 = {
    "data": [
        {"year": 2026, "month": "September", "sector": "Rural", "index": "110.1", "inflation": "6.1"},
        {"year": 2026, "month": "October", "sector": "Rural", "index": "110.73", "inflation": "6.63"},
    ],
    "meta_data": {"page": 1, "totalRecords": 688040, "totalPages": 34402, "recordPerPage": 20},
    "msg": "Data fetched successfully",
    "statusCode": True,
}


def mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_probe_ids_are_unique_and_safe():
    ids = [p.id for p in PROBES]
    assert len(ids) == len(set(ids))
    for p in PROBES:
        assert p.url.startswith("https://"), p.id
        assert p.kind in {"json", "html", "mcp"}


def test_probes_only_issue_reads():
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.method)
        return httpx.Response(200, json=CPI_2024)

    with mock_client(handler) as c:
        for p in PROBES:
            if p.kind != "mcp":  # MCP handshake is POST by protocol, but read-only
                run_probe(c, p)
    assert set(seen) == {"GET"}


def test_mospi_probe_summarises_records_and_periods():
    probe = Probe("t", "MoSPI", "q", f"{BASE_URL}/api/cpi/getCPIData", {"limit": 2})

    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params["Format"] == "JSON"
        return httpx.Response(200, json=CPI_2024)

    with mock_client(handler) as c:
        r = run_probe(c, probe)
    assert r.ok
    assert r.total_records == 688040
    assert r.periods == ["2026 September", "2026 October"]
    assert "inflation" in r.fields


def test_api_error_payload_is_a_failure_not_a_crash():
    probe = Probe("t", "MoSPI", "q", f"{BASE_URL}/api/wpi/getWpiRecords")

    def handler(req):
        return httpx.Response(200, json={"msg": "Invalid base_year", "statusCode": False, "data": []})

    with mock_client(handler) as c:
        r = run_probe(c, probe)
    assert not r.ok
    assert "Invalid base_year" in r.note


def test_network_failure_is_recorded():
    def handler(req):
        raise httpx.ConnectError("blocked by proxy")

    with mock_client(handler) as c:
        r = run_probe(c, PROBES[0])
    assert not r.ok and r.http_status is None
    assert "ConnectError" in r.note


def test_html_probe_checks_expected_text():
    probe = next(p for p in PROBES if p.id == "oea.wpi.linking_factor")
    with mock_client(lambda req: httpx.Response(200, text="<td>All Commodities</td><td>1.53</td>")) as c:
        assert run_probe(c, probe).ok
    with mock_client(lambda req: httpx.Response(200, text="<p>moved</p>")) as c:
        assert not run_probe(c, probe).ok


def test_hf_probe_reads_licence():
    probe = next(p for p in PROBES if p.id == "hf.chronos2.licence")
    body = {"cardData": {"license": "apache-2.0"}, "safetensors": {"total": 119477664}}
    with mock_client(lambda req: httpx.Response(200, json=body)) as c:
        r = run_probe(c, probe)
    assert r.ok and "apache-2.0" in r.note


def test_mcp_probe_parses_tools_list_over_sse():
    tools = {"result": {"tools": [{"name": n} for n in ["list_datasets", "get_data"]]}}

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        if body.get("method") == "tools/list":
            return httpx.Response(200, text=f"event: message\ndata: {json.dumps(tools)}\n")
        return httpx.Response(200, headers={"mcp-session-id": "abc"}, json={"result": {}})

    probe = next(p for p in PROBES if p.kind == "mcp")
    with mock_client(handler) as c:
        r = run_probe(c, probe)
    assert r.ok and "list_datasets" in r.note


def test_base_year_responses_in_both_shapes():
    cpi = {"data": {"base_year": [{"base_year": "2012"}, {"base_year": "2024"}]}, "statusCode": True}
    wpi = {"data": ["2022-23", "2011-12"], "statusCode": True}
    with mock_client(lambda req: httpx.Response(200, json=cpi)) as c:
        r = run_probe(c, PROBES[0])
    assert r.ok and "2024" in r.note
    with mock_client(lambda req: httpx.Response(200, json=wpi)) as c:
        r = run_probe(c, PROBES[2])
    assert r.ok and "2022-23" in r.note


def test_period_sorting_handles_quarters():
    rows = [{"year": "2025-26", "quarter": "Q2"}, {"year": "2025-26", "quarter": "Q1"}]
    assert _periods(rows) == ["2025-26 Q1", "2025-26 Q2"]


def test_mospi_client_drops_none_params():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "series" not in req.url.params
        return httpx.Response(200, json=CPI_2024)

    m = MospiClient(client=mock_client(handler))
    payload = m.get("cpi_2024", {"base_year": 2024, "series": None}).json()
    assert len(records(payload)) == 2 and total_records(payload) == 688040
