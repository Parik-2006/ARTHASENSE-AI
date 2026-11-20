"""Read-only client for the public MoSPI eSankhyiki REST API (https://api.mospi.gov.in).

Adapted from nso-india/esankhyiki-mcp (MIT). See THIRD_PARTY_NOTICES.md.
Only the endpoint paths and parameter names are taken from that project's client.

The MoSPI MCP server (https://mcp.mospi.gov.in) is a wrapper around this same REST API.
ArthaSense calls the REST API directly: no MCP session handshake per request, plain JSON,
and the same data.
"""

from __future__ import annotations

from typing import Any

import httpx

BASE_URL = "https://api.mospi.gov.in"
USER_AGENT = "ArthaSense-AI/0.1 (student research project; read-only)"

# Endpoint paths verified against esankhyiki-mcp@5317aa0 (mospi/client.py) and live in M1.
ENDPOINTS: dict[str, str] = {
    "cpi_base_years": "/api/cpi/getCpiBaseYear",
    "cpi_2024": "/api/cpi/getCPIData",  # base_year=2024, series Current | Back
    "cpi_group_legacy": "/api/cpi/getCPIIndex",  # base_year=2012 | 2010
    "iip_base_years": "/api/iip/getIipBaseYear",
    "iip": "/api/iip/getIipData",
    "wpi_base_years": "/api/wpi/getWpiBaseYear",
    "wpi": "/api/wpi/getWpiRecords",
    "nas": "/api/nas/getNASData",
    "rbi": "/api/rbi/getRbiRecords",
}


class MospiClient:
    def __init__(self, client: httpx.Client | None = None, base_url: str = BASE_URL):
        self._client = client or httpx.Client(
            timeout=30.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
        )
        self.base_url = base_url.rstrip("/")

    def url(self, endpoint: str) -> str:
        return f"{self.base_url}{ENDPOINTS[endpoint]}"

    def get(self, endpoint: str, params: dict[str, Any] | None = None) -> httpx.Response:
        """GET only. This client never sends writes."""
        clean = {k: str(v) for k, v in (params or {}).items() if v is not None}
        return self._client.get(self.url(endpoint), params=clean)

    def close(self) -> None:
        self._client.close()


def records(payload: Any) -> list[dict[str, Any]]:
    """Extract the record list from a MoSPI response (`{"data": [...]}` or `{"data": {...}}`)."""
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    return []


def total_records(payload: Any) -> int | None:
    if isinstance(payload, dict):
        meta = payload.get("meta_data")
        if isinstance(meta, dict) and isinstance(meta.get("totalRecords"), int):
            return meta["totalRecords"]
    return None
