# ruff: noqa: E501
"""Executor for government-source discovery cases.

Rules this module enforces:
  * TLS verification is never disabled. A site that fails verification is recorded as a failed case.
  * Requests are spaced >= MIN_GAP_S apart and bounded (max_pages, one attempt per case, no retries on 4xx).
  * Every live response is saved as raw bytes under data/evidence/raw/<sha256> (git-ignored) so a result
    can be re-checked. A response served from the local cache is flagged from_cache=true and keeps its
    ORIGINAL retrieval time: a cached answer is never presented as freshly verified.
  * No user text is ever sent. MCP tools accept a `user_query` field that the publisher logs; we omit it.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

UA = "ArthaSense-AI/0.1 (student research project; read-only)"
MIN_GAP_S = 0.6
EVIDENCE = Path("data/evidence")
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"]  # fmt: skip


@dataclass(frozen=True)
class Case:
    id: str
    group: str
    title: str
    source: str  # host
    op: str  # GET | MCP
    url: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    mcp_method: str = ""  # initialize | tools/list | tools/call
    mcp_args: dict[str, Any] = field(default_factory=dict)
    accept: str = "application/json"
    dataset: str = ""
    base_year: str = ""
    frequency: str = "Monthly"
    expect: str = "JSON"
    note: str = ""
    max_pages: int = 1
    evidence_level: str = "L"  # L live, D documented (document read), P pending


def _ym(rec: dict[str, Any]) -> str | None:
    y, m = rec.get("year"), rec.get("month")
    try:
        y = int(str(y)[:4])
    except (TypeError, ValueError):
        return None
    if isinstance(m, str) and m.strip().lower() in MONTHS:
        return f"{y}-{MONTHS.index(m.strip().lower()) + 1:02d}"
    if isinstance(m, int | str) and str(m).isdigit() and 1 <= int(m) <= 12:
        return f"{y}-{int(m):02d}"
    return None


def _months_between(a: str, b: str) -> int:
    (y1, m1), (y2, m2) = (int(x) for x in a.split("-")), (int(x) for x in b.split("-"))
    return (y2 - y1) * 12 + m2 - m1 + 1


def summarise(content_type: str, body: bytes, pages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Describe a response without modifying it. Never raises."""
    out: dict[str, Any] = {"actual_type": content_type.split(";")[0].strip() or "unknown", "bytes": len(body)}
    text = body.decode("utf-8", errors="replace")
    records: list[dict[str, Any]] = []
    try:
        if "json" in out["actual_type"] or text.lstrip()[:1] in "{[":
            payloads = pages or [json.loads(text)]
            out["actual_type"] = "application/json"
            for p in payloads:
                data = p.get("data") if isinstance(p, dict) else p
                if isinstance(data, list):
                    records += [r for r in data if isinstance(r, dict)]
                elif isinstance(data, dict):
                    out["data_keys"] = sorted(data)[:12]
                    for v in data.values():
                        if isinstance(v, list):
                            records += [r for r in v if isinstance(r, dict)]
                if isinstance(p, dict):
                    meta = p.get("meta_data")
                    if isinstance(meta, dict):
                        out["total_records_reported"] = meta.get("totalRecords")
                        out["total_pages_reported"] = meta.get("totalPages")
                    if p.get("msg") or p.get("message"):
                        out["api_message"] = str(p.get("msg") or p.get("message"))[:120]
                    if p.get("statusCode") is False:
                        out["api_status_false"] = True
        elif "csv" in out["actual_type"]:
            records = list(csv.DictReader(io.StringIO(text)))
            out["csv_columns"] = list(records[0])[:14] if records else []
        elif "pdf" in out["actual_type"] or body[:4] == b"%PDF":
            out["actual_type"] = "application/pdf"
        elif "html" in out["actual_type"]:
            m = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
            out["html_title"] = m.group(1).strip()[:100] if m else None
    except (ValueError, AttributeError):
        out["parse_error"] = True
    out["records_returned"] = len(records)
    periods = sorted({p for p in (_ym(r) for r in records) if p})
    if periods:
        out["earliest"], out["latest"] = periods[0], periods[-1]
        out["distinct_months"] = len(periods)
        out["missing_months"] = [
            f"{y}-{m:02d}"
            for y in range(int(periods[0][:4]), int(periods[-1][:4]) + 1)
            for m in range(1, 13)
            if periods[0] <= f"{y}-{m:02d}" <= periods[-1] and f"{y}-{m:02d}" not in periods
        ]
    for key in (
        "major_group",
        "majorgroup",
        "category",
        "type",
        "sector",
        "status",
        "series",
        "base_year",
        "baseyear",
    ):
        vals = sorted({str(r[key]) for r in records if r.get(key) not in (None, "")})
        if vals:
            out.setdefault("distinct", {})[key] = vals[:10]
    nulls = [
        k
        for k in ("growth_rate", "inflation", "index", "index_value")
        if records and any(r.get(k) in (None, "") for r in records)
    ]
    if nulls:
        out["null_or_empty_fields"] = {k: sum(1 for r in records if r.get(k) in (None, "")) for k in nulls}
    return out


class Runner:
    def __init__(self, refresh: bool = False, evidence: Path = EVIDENCE):
        self.refresh = refresh
        self.ev = evidence
        (self.ev / "raw").mkdir(parents=True, exist_ok=True)
        (self.ev / "cache").mkdir(parents=True, exist_ok=True)
        self.client = httpx.Client(timeout=30.0, headers={"User-Agent": UA}, follow_redirects=True)
        self._last = 0.0
        self._sid: str | None = None
        self._mcp_ready = False
        self._rpc = 0
        self.live_requests = 0

    def close(self) -> None:
        self.client.close()

    # -- plumbing -------------------------------------------------------------------------------
    def _wait(self) -> None:
        gap = time.monotonic() - self._last
        if gap < MIN_GAP_S:
            time.sleep(MIN_GAP_S - gap)
        self._last = time.monotonic()
        self.live_requests += 1

    def _store(self, body: bytes) -> str:
        sha = hashlib.sha256(body).hexdigest()
        p = self.ev / "raw" / sha
        if not p.exists():
            p.write_bytes(body)
        return sha

    def _cache_path(self, c: Case) -> Path:
        key = json.dumps(
            [c.op, c.url, c.params, c.mcp_method, c.mcp_args, c.accept, c.max_pages], sort_keys=True
        )
        return self.ev / "cache" / (hashlib.sha1(key.encode()).hexdigest() + ".json")  # noqa: S324 - cache key only

    # -- MCP ------------------------------------------------------------------------------------
    def _mcp_post(self, base: str, payload: dict[str, Any]) -> httpx.Response:
        self._wait()
        h = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        if self._sid:
            h["mcp-session-id"] = self._sid
        return self.client.post(base, json=payload, headers=h)

    def _mcp_init(self, base: str) -> None:
        if self._mcp_ready:
            return
        r = self._mcp_post(base, {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "arthasense-audit", "version": "0"}}})  # fmt: skip
        self._sid = r.headers.get("mcp-session-id")
        self._mcp_post(base, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        self._mcp_ready = True

    @staticmethod
    def _sse_json(text: str) -> Any:
        for line in text.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:])
        return json.loads(text)

    # -- execution ------------------------------------------------------------------------------
    def run(self, c: Case) -> dict[str, Any]:
        cp = self._cache_path(c)
        if cp.exists() and not self.refresh:
            rec = json.loads(cp.read_text(encoding="utf-8"))
            rec["from_cache"] = True
            return rec
        rec: dict[str, Any] = {
            "id": c.id, "group": c.group, "title": c.title, "source": c.source, "dataset": c.dataset,
            "base_year": c.base_year, "frequency": c.frequency, "operation": c.op if c.op != "MCP" else f"MCP {c.mcp_method}",
            "request_format": c.accept, "expected_type": c.expect, "evidence_level": c.evidence_level,
            "note": c.note, "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"), "from_cache": False,
        }  # fmt: skip
        try:
            if c.op == "MCP":
                body, status, ctype, pages = self._run_mcp(c)
                rec["request"] = {"url": c.url, "method": c.mcp_method, "arguments": c.mcp_args}
            else:
                body, status, ctype, pages = self._run_get(c)
                rec["request"] = {"url": c.url, "params": c.params}
            rec["http_status"] = status
            rec["raw_sha256"] = self._store(body)
            rec.update(summarise(ctype, body, pages))
            rec["outcome"] = self._outcome(
                status,
                rec,
                bool(c.dataset)
                and (c.op == "GET" and "/api/" in c.url or c.mcp_args.get("tool") == "get_data"),
            )
        except httpx.ConnectError as exc:
            reason = "tls_verification_failed" if "CERTIFICATE_VERIFY_FAILED" in str(exc) else "connect_error"
            rec.update(http_status=None, outcome=reason, error=str(exc)[:160], records_returned=0)
        except httpx.HTTPError as exc:
            rec.update(
                http_status=None,
                outcome="transport_error",
                error=f"{type(exc).__name__}: {str(exc)[:120]}",
                records_returned=0,
            )
        rec["usable_for_ingestion"] = rec.get("outcome") == "ok_data"
        cp.write_text(json.dumps(rec, indent=1, default=str), encoding="utf-8")
        return rec

    @staticmethod
    def _outcome(status: int, rec: dict[str, Any], is_data: bool) -> str:
        if status >= 400:
            return f"rejected_http_{status}"
        if rec.get("api_status_false"):
            return "api_error"
        if not is_data:
            return "ok_document"
        return "ok_data" if rec.get("records_returned", 0) > 0 else "ok_empty"

    def _run_get(self, c: Case) -> tuple[bytes, int, str, list[dict[str, Any]]]:
        pages: list[dict[str, Any]] = []
        body, status, ctype = b"", 0, ""
        total_pages = 1
        for page in range(1, c.max_pages + 1):
            if page > total_pages:
                break
            params = {**c.params, **({"page": page} if c.max_pages > 1 else {})}
            self._wait()
            r = self.client.get(c.url, params=params, headers={"Accept": c.accept})
            body, status, ctype = r.content, r.status_code, r.headers.get("content-type", "")
            if c.max_pages == 1 or status != 200:
                break
            try:
                j = r.json()
                pages.append(j)
                total_pages = int((j.get("meta_data") or {}).get("totalPages") or 1)
            except ValueError:
                break
        return body, status, ctype, pages

    def _run_mcp(self, c: Case) -> tuple[bytes, int, str, list[dict[str, Any]]]:
        if c.mcp_method == "initialize":
            self._mcp_ready, self._sid = False, None
            self._wait()
            r = self.client.post(c.url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-03-26", "capabilities": {},
                "clientInfo": {"name": "arthasense-audit", "version": "0"}}},
                headers={"Accept": "application/json, text/event-stream", "Content-Type": "application/json"})  # fmt: skip
            self._sid = r.headers.get("mcp-session-id")
            self._mcp_post(c.url, {"jsonrpc": "2.0", "method": "notifications/initialized"})
            self._mcp_ready = True
            return r.content, r.status_code, r.headers.get("content-type", ""), []
        self._mcp_init(c.url)
        self._rpc += 1
        params = (
            {"name": c.mcp_args["tool"], "arguments": c.mcp_args.get("arguments", {})}
            if c.mcp_method == "tools/call"
            else {}
        )
        r = self._mcp_post(
            c.url, {"jsonrpc": "2.0", "id": 100 + self._rpc, "method": c.mcp_method, "params": params}
        )
        env = self._sse_json(r.text)
        # unwrap a tool result so records inside are analysed like any other JSON payload
        inner: Any = env
        try:
            content = env["result"]["content"][0]["text"]
            inner = json.loads(content)
            return json.dumps(inner).encode(), r.status_code, "application/json", []
        except (KeyError, IndexError, TypeError, ValueError):
            return json.dumps(inner).encode(), r.status_code, "application/json", []
