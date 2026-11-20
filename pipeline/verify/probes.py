"""M1 read-only verification probes.

Each probe is one small GET (or the MCP read-only handshake) that answers a concrete question:
"is this series published, on which base, and up to which period?". Probes never write to the
database or download bulk data. They use `limit` and sample a single year.
"""

from __future__ import annotations

import contextlib
import json
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any

import httpx

from pipeline.sources.mospi import BASE_URL, ENDPOINTS, USER_AGENT, records, total_records

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]  # fmt: skip


@dataclass(frozen=True)
class Probe:
    id: str
    source: str
    question: str
    url: str
    params: dict[str, Any] = field(default_factory=dict)
    kind: str = "json"  # json | html | mcp
    expect_text: str | None = None  # for html probes: text that must appear


@dataclass
class ProbeResult:
    id: str
    source: str
    question: str
    url: str
    ok: bool
    http_status: int | None
    latency_ms: int | None
    records_on_page: int | None = None
    total_records: int | None = None
    fields: list[str] | None = None
    periods: list[str] | None = None
    note: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _mospi(endpoint: str) -> str:
    return f"{BASE_URL}{ENDPOINTS[endpoint]}"


PROBES: list[Probe] = [
    # --- MoSPI: which base years are served ---
    Probe("mospi.cpi.base_years", "MoSPI", "CPI base years served", _mospi("cpi_base_years")),
    Probe("mospi.iip.base_years", "MoSPI", "IIP base years served", _mospi("iip_base_years")),
    Probe("mospi.wpi.base_years", "MoSPI", "WPI base years served", _mospi("wpi_base_years")),
    # --- CPI ---
    Probe(
        "mospi.cpi.2024.current.latest",
        "MoSPI",
        "Latest month on CPI 2024=100",
        _mospi("cpi_2024"),
        {"base_year": "2024", "series": "Current", "year": "2026", "limit": 20},
    ),
    Probe(
        "mospi.cpi.2024.current.first_year",
        "MoSPI",
        "Does CPI 2024=100 have index values for 2025 (overlap year)?",
        _mospi("cpi_2024"),
        {"base_year": "2024", "series": "Current", "year": "2025", "limit": 20},
    ),
    Probe(
        "mospi.cpi.2024.back.2013",
        "MoSPI",
        "Official back series on 2024=100 for 2013 (all-India general index)",
        _mospi("cpi_2024"),
        {"base_year": "2024", "series": "Back", "year": "2013", "limit": 50},
    ),
    Probe(
        "mospi.cpi.2012.current.2025",
        "MoSPI",
        "Old CPI 2012=100, all-India combined general, final year 2025",
        _mospi("cpi_group_legacy"),
        {
            "base_year": "2012",
            "series": "Current",
            "year": "2025",
            "state_code": 99,
            "sector_code": 3,
            "group_code": 0,
            "limit": 20,
        },
    ),
    # --- IIP ---
    Probe(
        "mospi.iip.2022-23.monthly",
        "MoSPI",
        "IIP 2022-23 monthly data",
        _mospi("iip"),
        {"base_year": "2022-23", "frequency": "Monthly", "financial_year": "2025-26", "limit": 20},
    ),
    Probe(
        "mospi.iip.2011-12.monthly",
        "MoSPI",
        "Old IIP 2011-12 monthly data (last year)",
        _mospi("iip"),
        {"base_year": "2011-12", "frequency": "Monthly", "financial_year": "2025-26", "limit": 20},
    ),
    # --- WPI ---
    Probe(
        "mospi.wpi.2022-23.latest",
        "MoSPI",
        "WPI 2022-23 latest month",
        _mospi("wpi"),
        {"base_year": "2022-23", "year": "2026", "limit": 20},
    ),
    Probe(
        "mospi.wpi.2011-12.2026",
        "MoSPI",
        "Is old WPI 2011-12 still published in 2026?",
        _mospi("wpi"),
        {"base_year": "2011-12", "year": "2026", "limit": 20},
    ),
    # --- GDP (NAS) ---
    Probe(
        "mospi.nas.2022-23.quarterly_growth",
        "MoSPI",
        "Quarterly real GDP growth on the 2022-23 base",
        _mospi("nas"),
        {
            "base_year": "2022-23",
            "series": "Current",
            "frequency_code": "Quarterly",
            "indicator_code": 22,
            "limit": 100,
        },
    ),
    Probe(
        "mospi.nas.2011-12.back.quarterly_growth",
        "MoSPI",
        "Quarterly GDP growth, old 2011-12 base (back series)",
        _mospi("nas"),
        {
            "base_year": "2011-12",
            "series": "Back",
            "frequency_code": "Quarterly",
            "indicator_code": 22,
            "limit": 100,
        },
    ),
    # --- RBI exchange rates via MoSPI ---
    Probe(
        "mospi.rbi.fx_monthly_avg",
        "MoSPI (RBI data)",
        "Monthly average INR exchange rates (indicator 36)",
        _mospi("rbi"),
        {"indicator_code": 36, "limit": 20},
    ),
    # --- MCP server handshake (read-only) ---
    Probe("mospi.mcp.tools", "MoSPI MCP", "MCP tools exposed", "https://mcp.mospi.gov.in/", kind="mcp"),
    # --- Other official sources ---
    Probe(
        "oea.wpi.linking_factor",
        "Office of the Economic Adviser",
        "Official WPI 2011-12 to 2022-23 linking factors page",
        "https://eaindustry.nic.in/linking_factor2223.asp",
        kind="html",
        expect_text="1.53",
    ),
    Probe(
        "rbi.dbie.reachable",
        "RBI DBIE",
        "DBIE portal reachable (no public API documented)",
        "https://data.rbi.org.in/",
        kind="html",
    ),
    Probe(
        "worldbank.ind.cpi_inflation",
        "World Bank",
        "World Bank API, India CPI inflation (annual)",
        "https://api.worldbank.org/v2/country/IND/indicator/FP.CPI.TOTL.ZG",
        {"format": "json", "per_page": 5},
    ),
    # --- Model licences (metadata only, no weights downloaded) ---
    Probe(
        "hf.chronos2.licence",
        "Hugging Face",
        "Chronos-2 licence and size",
        "https://huggingface.co/api/models/amazon/chronos-2",
    ),
    Probe(
        "hf.timesfm25.licence",
        "Hugging Face",
        "TimesFM 2.5 licence and size",
        "https://huggingface.co/api/models/google/timesfm-2.5-200m-pytorch",
    ),
]


def _periods(rows: list[dict[str, Any]]) -> list[str]:
    seen: set[tuple[str, str]] = set()
    for r in rows:
        year = r.get("year") or r.get("financial_year")
        sub = r.get("month") or r.get("quarter") or ""
        if year is not None:
            seen.add((str(year), str(sub)))

    def key(p: tuple[str, str]) -> tuple[str, int]:
        y, s = p
        idx = MONTHS.index(s) if s in MONTHS else (int(s[1:]) if s[:1] == "Q" and s[1:].isdigit() else 0)
        return (y, idx)

    return [f"{y} {s}".strip() for y, s in sorted(seen, key=key)]


def _summarise_json(probe: Probe, payload: Any) -> tuple[bool, dict[str, Any]]:
    if probe.id.startswith("hf."):
        card = payload.get("cardData") or {} if isinstance(payload, dict) else {}
        st = payload.get("safetensors") or {} if isinstance(payload, dict) else {}
        licence = card.get("license")
        note = f"licence={licence}; params={st.get('total')}; lastModified={payload.get('lastModified')}"
        return licence is not None, {"note": note}
    if probe.id.startswith("worldbank."):
        ok = isinstance(payload, list) and len(payload) == 2 and isinstance(payload[1], list)
        rows = payload[1] if ok else []
        dates = sorted({str(r.get("date")) for r in rows if isinstance(r, dict)})
        return ok, {"records_on_page": len(rows), "periods": dates}
    # MoSPI
    status_ok = isinstance(payload, dict) and payload.get("statusCode") is True
    rows = records(payload)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not rows and isinstance(data, dict):
        # base-year style response: {"data": {"base_year": [{"base_year": "2024"}, ...], ...}}
        labels = [v for d in data.get("base_year", []) if isinstance(d, dict) for v in d.values()]
        return status_ok, {"note": f"base_year={labels}" if labels else f"data keys: {sorted(data)}"}
    if not rows and isinstance(data, list) and data:
        # list of plain labels, e.g. WPI base years ["2022-23", "2011-12", ...]
        return status_ok, {"note": f"labels={[str(x) for x in data][:10]}"}
    out: dict[str, Any] = {
        "records_on_page": len(rows),
        "total_records": total_records(payload),
        "fields": sorted(rows[0]) if rows else [],
        "periods": _periods(rows),
    }
    if not status_ok:
        out["note"] = str(payload.get("msg") if isinstance(payload, dict) else payload)[:200]
    return status_ok and bool(rows), out


def _run_mcp(client: httpx.Client, url: str) -> tuple[int, dict[str, Any]]:
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}

    def call(body: dict, session: str | None) -> httpx.Response:
        h = dict(headers)
        if session:
            h["mcp-session-id"] = session
        return client.post(url, json=body, headers=h)

    init = call(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "arthasense-verify", "version": "0.1"},
            },
        },
        None,
    )
    session = init.headers.get("mcp-session-id")
    call({"jsonrpc": "2.0", "method": "notifications/initialized"}, session)
    tools = call({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, session)
    names: list[str] = []
    for line in tools.text.splitlines() or [tools.text]:
        text = line[6:] if line.startswith("data: ") else line
        if '"tools"' in text:
            with contextlib.suppress(ValueError, KeyError, TypeError):
                names = [t["name"] for t in json.loads(text)["result"]["tools"]]
    return tools.status_code, {"note": f"tools={names}" if names else "tools/list not parsed"}


def run_probe(client: httpx.Client, probe: Probe) -> ProbeResult:
    start = time.monotonic()
    base = {"id": probe.id, "source": probe.source, "question": probe.question, "url": probe.url}
    try:
        if probe.kind == "mcp":
            status, extra = _run_mcp(client, probe.url)
            ok = status == 200 and extra["note"].startswith("tools=")
        else:
            params = dict(probe.params)
            if probe.url.startswith(BASE_URL):
                params.setdefault("Format", "JSON")
            resp = client.get(probe.url, params={k: str(v) for k, v in params.items()})
            status = resp.status_code
            if probe.kind == "html":
                found = probe.expect_text is None or probe.expect_text in resp.text
                ok = resp.is_success and found
                extra = {"note": None if found else f"expected text {probe.expect_text!r} not found"}
            else:
                ok_json, extra = _summarise_json(probe, resp.json())
                ok = resp.is_success and ok_json
        latency = int((time.monotonic() - start) * 1000)
        return ProbeResult(**base, ok=ok, http_status=status, latency_ms=latency, **extra)
    except Exception as exc:  # network blocked, DNS, timeout, bad JSON: all are findings
        return ProbeResult(
            **base, ok=False, http_status=None, latency_ms=None, note=f"{type(exc).__name__}: {exc}"
        )


def run_all(
    client: httpx.Client | None = None,
    probes: list[Probe] = PROBES,
    on_result: Callable[[ProbeResult], None] | None = None,
) -> list[ProbeResult]:
    own = client is None
    client = client or httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT})
    try:
        results = []
        for p in probes:  # sequential and polite: these are public government servers
            r = run_probe(client, p)
            results.append(r)
            if on_result:
                on_result(r)
        return results
    finally:
        if own:
            client.close()
