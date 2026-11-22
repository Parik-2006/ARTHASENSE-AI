# ruff: noqa: E501, E731  (registry text and small request-builder lambdas stay readable)
"""Official-source discovery and verification suite for CPI, WPI and IIP (MoSPI eSankhyiki API, OEA).

Run:  python -m pipeline.discovery           (writes reports/discovery-<date>.json and docs/GOVDATA-DISCOVERY.md)

Principles
  * A test passes only when CONTENT checks pass (documented fields present, values parse as finite numbers,
    periods are the ones requested, no duplicates, expected row counts). An HTTP 200 alone proves nothing.
  * "empty" is a first-class, honest outcome: the source answered but has no data for that request.
  * TLS verification is never disabled. A site that fails verification is recorded as failed, not worked around.
  * Strictly read-only: GET requests to public endpoints; the optional database cross-check opens a READ ONLY
    transaction on a local database.
"""

from __future__ import annotations

import hashlib
import json
import math
import ssl
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from pipeline.sources.mospi import BASE_URL, ENDPOINTS, MospiClient, records, total_records

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]  # fmt: skip

VERIFIED, EMPTY, FAILED, SKIPPED = "verified", "empty", "failed", "skipped"


@dataclass
class Outcome:
    status: str  # verified | empty | failed | skipped
    detail: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class TestResult:
    id: str
    category: str
    name: str
    request: str
    status: str
    detail: str
    evidence: dict[str, Any]
    seconds: float


@dataclass
class Probe:
    url: str
    status: int | None
    content_type: str
    json: Any
    text: str
    error: str | None
    digest: str

    @property
    def rows(self) -> list[dict[str, Any]]:
        return records(self.json)

    @property
    def total(self) -> int | None:
        return total_records(self.json)


class Context:
    """HTTP access with caching (so one request is never repeated within a run) and polite pacing."""

    def __init__(
        self,
        client: MospiClient,
        *,
        delay_s: float = 0.4,
        db_url: str | None = None,
        web: httpx.Client | None = None,
    ):
        self.client = client
        self.delay_s = delay_s
        self.db_url = db_url
        self.web = web or httpx.Client(
            timeout=25.0,
            headers={"User-Agent": "ArthaSense-AI/0.1 (student research project; read-only)"},
            follow_redirects=True,
        )
        self._cache: dict[str, Probe] = {}
        self.requests = 0

    def api(self, endpoint: str, params: dict[str, Any] | None = None) -> Probe:
        key = endpoint + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
        if key in self._cache:
            return self._cache[key]
        time.sleep(self.delay_s)
        self.requests += 1
        url = f"{BASE_URL}{ENDPOINTS[endpoint]}"
        full = str(httpx.URL(url, params={k: str(v) for k, v in (params or {}).items()}))
        last: Probe | None = None
        for attempt in range(3):
            if attempt:
                time.sleep(1.0 * 2**attempt)
            try:
                r = self.client.get(endpoint, params)
                try:
                    body = r.json()
                except ValueError:
                    body = None
                last = Probe(
                    full,
                    r.status_code,
                    r.headers.get("content-type", ""),
                    body,
                    r.text[:300],
                    None,
                    hashlib.sha256(r.content).hexdigest(),
                )
                if r.status_code in (429, 500, 502, 503, 504):
                    continue
                break
            except httpx.HTTPError as exc:
                last = Probe(full, None, "", None, "", f"{type(exc).__name__}: {str(exc)[:160]}", "")
        assert last is not None
        self._cache[key] = last
        return last

    def paged(
        self, endpoint: str, params: dict[str, Any], page_size: int = 100
    ) -> tuple[list[dict[str, Any]], int, Probe]:
        """All pages of one query (bounded). Returns (rows, pages, first-page probe)."""
        first = self.api(endpoint, {**params, "limit": page_size, "page": 1})
        rows = list(first.rows)
        meta = first.json.get("meta_data") if isinstance(first.json, dict) else None
        pages = (
            int(meta.get("totalPages", 1))
            if isinstance(meta, dict) and str(meta.get("totalPages", "")).isdigit()
            else 1
        )
        for p in range(2, min(pages, 60) + 1):
            rows += self.api(endpoint, {**params, "limit": page_size, "page": p}).rows
        return rows, pages, first


# ---------------------------------------------------------------------------------------------
# Content checks (pure; unit-tested)
# ---------------------------------------------------------------------------------------------


def to_decimal(v: Any) -> Decimal | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        d = Decimal(str(v).strip())
    except InvalidOperation:
        raise ValueError(f"not a number: {v!r}") from None
    if not d.is_finite():
        raise ValueError(f"not finite: {v!r}")
    return d


def month_of(row: dict[str, Any]) -> tuple[int, int]:
    y = int(str(row["year"]).strip())
    m = MONTHS.index(str(row["month"]).strip().capitalize()) + 1
    return y, m


def check_rows(
    rows: list[dict[str, Any]],
    *,
    required: list[str],
    value_key: str,
    years: set[int] | None = None,
    min_rows: int = 1,
    expect_rows: int | None = None,
    unique_months: bool = True,
    allow_null_values: bool = True,
) -> Outcome:
    """Content validation of a batch of records. Returns EMPTY (not failed) when there are no rows."""
    if not rows:
        return Outcome(EMPTY, "the source answered but returned no records")

    def has(
        r: dict[str, Any], k: Any
    ) -> bool:  # a tuple means "any of these spellings" (the 2011-12 WPI base spells fields differently)
        return any(x in r for x in k) if isinstance(k, tuple) else k in r

    missing = sorted({str(k) for r in rows for k in required if not has(r, k)})
    if missing:
        return Outcome(
            FAILED, f"documented field(s) missing: {missing}", {"fields_seen": sorted(rows[0].keys())}
        )
    try:
        periods = [month_of(r) for r in rows]
        vals = [to_decimal(r.get(value_key)) for r in rows]
    except (ValueError, KeyError) as exc:
        return Outcome(FAILED, f"unparseable record: {exc}")
    if years is not None and not {y for y, _ in periods} <= years:
        return Outcome(
            FAILED, f"records outside requested year(s): {sorted({y for y, _ in periods} - years)}"
        )
    if unique_months:
        dup = [p for p, n in Counter(periods).items() if n > 1]
        if dup:
            return Outcome(FAILED, f"{len(dup)} duplicate month(s), e.g. {dup[0]}")
    if len(rows) < min_rows:
        return Outcome(FAILED, f"only {len(rows)} row(s); expected at least {min_rows}")
    if expect_rows is not None and len(rows) != expect_rows:
        return Outcome(FAILED, f"{len(rows)} row(s); expected {expect_rows}")
    if not allow_null_values and any(v is None for v in vals):
        return Outcome(FAILED, "null index values present")
    first, last = min(periods), max(periods)
    nonnull = [v for v in vals if v is not None]
    return Outcome(
        VERIFIED,
        f"{len(rows)} records, {first[0]}-{first[1]:02d} to {last[0]}-{last[1]:02d}, {len(nonnull)} numeric",
        {"rows": len(rows), "first": f"{first[0]}-{first[1]:02d}", "last": f"{last[0]}-{last[1]:02d}", "null_values": len(vals) - len(nonnull),
         "min": float(min(nonnull)) if nonnull else None, "max": float(max(nonnull)) if nonnull else None},
    )  # fmt: skip


def months_between(first: tuple[int, int], last: tuple[int, int]) -> int:
    return (last[0] * 12 + last[1]) - (first[0] * 12 + first[1]) + 1


# ---------------------------------------------------------------------------------------------
# Test registry
# ---------------------------------------------------------------------------------------------


@dataclass
class T:
    id: str
    category: str
    name: str
    request: str
    run: Callable[[Context], Outcome]


TESTS: list[T] = []


def test(id: str, category: str, name: str, request: str):
    def deco(fn: Callable[[Context], Outcome]):
        TESTS.append(T(id, category, name, request, fn))
        return fn

    return deco


# ---- request builders (documented parameter names; headline filters) ---------------------------

CPI2024 = lambda series, year: (
    "cpi_2024",
    {
        "base_year": 2024,
        "series": series,
        "state_code": 1,
        "sector_code": 3,
        "division_code": 0,
        "year": year,
    },
)  # noqa: E731
CPI_LEGACY = lambda base, year, series="Current": (
    "cpi_group_legacy",
    {"base_year": base, "series": series, "state_code": 99, "sector_code": 3, "group_code": 0, "year": year},
)  # noqa: E731
# The headline major_group_code is "1000000000" on the two newest bases and "1" on the archive bases (read from live requests).
WPI_HEADLINE_CODE = {"2022-23": "1000000000", "2011-12": "1000000000", "2004-05": "1", "1993-94": "1"}
WPI = lambda base, year: (
    "wpi",
    {"base_year": base, "major_group_code": WPI_HEADLINE_CODE.get(base, "1000000000"), "year": year},
)  # noqa: E731
IIP_GEN = lambda base, year: (
    "iip",
    {"base_year": base, "frequency": "Monthly", "type": "General", "year": year},
)  # noqa: E731


def _fetch_check(
    ctx: Context,
    req: tuple[str, dict[str, Any]],
    *,
    required,
    value_key,
    year,
    expect_rows=None,
    min_rows=1,
    row_filter=None,
) -> Outcome:
    ep, params = req
    rows, pages, first = ctx.paged(ep, params)
    if first.error or first.status != 200:
        return Outcome(FAILED, f"HTTP {first.status} {first.error or first.text[:120]}")
    if isinstance(first.json, dict) and first.json.get("statusCode") is False:
        return Outcome(EMPTY, f"source reports: {first.json.get('msg')!r}")
    if row_filter:
        rows = [r for r in rows if row_filter(r)]
    out = check_rows(
        rows, required=required, value_key=value_key, years={year}, expect_rows=expect_rows, min_rows=min_rows
    )
    out.evidence["pages"] = pages
    out.evidence["api_total_records"] = first.total
    return out


# ===== A. catalogue ===========================================================================


def _base_list(p: Probe, ep: str) -> list[str]:
    d = p.json.get("data") if isinstance(p.json, dict) else None
    if ep == "wpi_base_years":
        return [r.get("label") for r in (d or []) if isinstance(r, dict)]
    return [r.get("base_year") for r in (d or {}).get("base_year", [])] if isinstance(d, dict) else []


for _ep, _label in (("cpi_base_years", "CPI"), ("iip_base_years", "IIP"), ("wpi_base_years", "WPI")):

    def _mk(ep=_ep, label=_label):
        @test(
            f"A-{label}-catalogue",
            "catalogue",
            f"{label} base-year catalogue endpoint answers with the documented structure",
            f"GET {ENDPOINTS[ep]}",
        )
        def _t(ctx: Context) -> Outcome:
            p = ctx.api(ep)
            if p.status != 200 or not isinstance(p.json, dict):
                return Outcome(FAILED, f"HTTP {p.status} {p.error or ''}")
            bases = _base_list(p, ep)
            if not bases:
                return Outcome(FAILED, "no base years listed")
            return Outcome(
                VERIFIED,
                f"{len(bases)} base years: {bases}",
                {"base_years": bases, "content_type": p.content_type},
            )

    _mk()

EXPECTED_BASES = {
    "cpi_base_years": ("CPI", ["2024", "2012", "2010"]),
    "iip_base_years": ("IIP", ["2022-23", "2011-12", "2004-05", "1993-94"]),
    "wpi_base_years": ("WPI", ["2022-23", "2011-12", "2004-05", "1993-94"]),
}
for _ep, (_label, _bases) in EXPECTED_BASES.items():
    for _b in _bases:

        def _mk2(ep=_ep, label=_label, b=_b):
            @test(
                f"A-{label}-base-{b}",
                "catalogue",
                f"{label} base {b} is advertised by the source's own catalogue",
                f"GET {ENDPOINTS[ep]}",
            )
            def _t(ctx: Context) -> Outcome:
                bases = _base_list(ctx.api(ep), ep)
                return Outcome(
                    VERIFIED if b in bases else FAILED,
                    f"{b} {'listed' if b in bases else 'NOT listed'} in {bases}",
                )

        _mk2()

# ===== B. retrieval (content-validated) =======================================================

CPI24_REQ = ["base_year", "series", "year", "month", "state", "sector", "division", "index", "inflation"]
CPI12_REQ = [
    "baseyear",
    "year",
    "month",
    "state",
    "sector",
    "group",
    "subgroup",
    "index",
    "inflation",
    "status",
]
WPI_REQ = ["base_year", "year", "month", ("major_group", "majorgroup"), "index_value"]
IIP_REQ = ["base_year", "year", "month", "type", "category", "index", "growth_rate"]

RETRIEVAL: list[tuple[str, str, Any, Any, int, dict[str, Any]]] = []
for _s, _ys in (("Current", [2025, 2026]), ("Back", [2013, 2020, 2024])):
    for _y in _ys:
        RETRIEVAL.append(
            (
                f"B-CPI2024-{_s}-{_y}",
                f"CPI base 2024, series {_s}, {_y}",
                CPI24_REQ,
                "index",
                _y,
                {"req": CPI2024(_s, _y), "expect": 12 if _y != 2026 else None},
            )
        )
for _y in (2013, 2017, 2021, 2025):
    RETRIEVAL.append(
        (
            f"B-CPI2012-{_y}",
            f"CPI base 2012 (legacy), {_y}",
            CPI12_REQ,
            "index",
            _y,
            {"req": CPI_LEGACY("2012", _y), "expect": 12},
        )
    )
for _b, _ys in (
    ("2022-23", [2023, 2026]),
    ("2011-12", [2012, 2021, 2026]),
    ("2004-05", [2010, 2016]),
    ("1993-94", [2000, 2004]),
):
    for _y in _ys:
        RETRIEVAL.append(
            (
                f"B-WPI-{_b}-{_y}",
                f"WPI base {_b}, headline, {_y}",
                WPI_REQ,
                "index_value",
                _y,
                {"req": WPI(_b, _y), "expect": None},
            )
        )
for _b, _ys in (
    ("2022-23", [2023, 2026]),
    ("2011-12", [2013, 2021, 2026]),
    ("2004-05", [2010, 2016]),
    ("1993-94", [2000, 2004]),
):
    for _y in _ys:
        RETRIEVAL.append(
            (
                f"B-IIP-{_b}-{_y}",
                f"IIP base {_b}, General, {_y}",
                IIP_REQ,
                "index",
                _y,
                {"req": IIP_GEN(_b, _y), "expect": None},
            )
        )

for _id, _name, _req_fields, _vkey, _year, _opt in RETRIEVAL:

    def _mk3(id=_id, name=_name, req_fields=_req_fields, vkey=_vkey, year=_year, opt=_opt):
        ep, params = opt["req"]

        @test(
            id,
            "retrieval",
            name + ": fields, numeric values, requested year, no duplicate months",
            f"GET {ENDPOINTS[ep]} {params}",
        )
        def _t(ctx: Context) -> Outcome:
            def keep(r):  # headline rows only (WPI/IIP legacy may return sub-levels)
                if "major_group" in r or "majorgroup" in r:
                    return str(
                        r.get("major_group", r.get("majorgroup"))
                    ).strip().casefold() == "wholesale price index" and not any(
                        r.get(k) for k in ("group", "subgroup", "sub_group", "item")
                    )
                if "category" in r:
                    return r.get("category") == "General"
                if "group" in r and "subgroup" in r:
                    return (
                        r.get("group") == "General"
                        and r.get("state") == "All India"
                        and r.get("sector") == "Combined"
                    )
                return True

            return _fetch_check(
                ctx,
                opt["req"],
                required=req_fields,
                value_key=vkey,
                year=year,
                expect_rows=opt["expect"],
                row_filter=keep,
            )

    _mk3()

# CPI base 2010 and its (documented-as-served) status for the headline request
for _y in (2011, 2013, 2015):

    def _mk4(y=_y):
        @test(
            f"B-CPI2010-{y}",
            "retrieval",
            f"CPI base 2010, all-India combined general, {y}",
            f"GET {ENDPOINTS['cpi_group_legacy']} base_year=2010 year={y}",
        )
        def _t(ctx: Context) -> Outcome:
            return _fetch_check(ctx, CPI_LEGACY("2010", y), required=CPI12_REQ, value_key="index", year=y)

    _mk4()

# ===== C. boundaries ==========================================================================

BOUNDS = [
    (
        "C-WPI-2022-23-before",
        "WPI 2022-23 asked for 2022 (before its first month, Apr 2023)",
        WPI("2022-23", 2022),
    ),
    (
        "C-WPI-2011-12-before",
        "WPI 2011-12 asked for 2011 (before its first month, Apr 2012)",
        WPI("2011-12", 2011),
    ),
    ("C-IIP-2022-23-before", "IIP 2022-23 asked for 2022 (before Apr 2023)", IIP_GEN("2022-23", 2022)),
    ("C-IIP-2011-12-before", "IIP 2011-12 asked for 2011 (before Apr 2012)", IIP_GEN("2011-12", 2011)),
    ("C-CPI2024-Current-2024", "CPI 2024 Current asked for 2024 (starts Jan 2025)", CPI2024("Current", 2024)),
    ("C-CPI2024-Back-2012", "CPI 2024 Back asked for 2012 (starts Jan 2013)", CPI2024("Back", 2012)),
    ("C-CPI2012-2012", "CPI 2012 asked for 2012 (base year itself)", CPI_LEGACY("2012", 2012)),
    ("C-WPI-future", "WPI asked for 2028 (future year)", WPI("2022-23", 2028)),
    ("C-IIP-future", "IIP asked for 2028 (future year)", IIP_GEN("2022-23", 2028)),
    ("C-CPI-future", "CPI asked for 2028 (future year)", CPI2024("Current", 2028)),
]
for _id, _name, _req in BOUNDS:

    def _mk5(id=_id, name=_name, req=_req):
        ep, params = req

        @test(id, "boundary", name + ": the source must not invent data", f"GET {ENDPOINTS[ep]} {params}")
        def _t(ctx: Context) -> Outcome:
            p = ctx.api(ep, params)
            if p.status not in (200, 400):
                return Outcome(FAILED, f"unexpected HTTP {p.status} {p.error or ''}")
            n = len(p.rows)
            if n == 0:
                return Outcome(
                    VERIFIED,
                    f"no records returned (HTTP {p.status}): the boundary is honest",
                    {
                        "http": p.status,
                        "msg": (p.json or {}).get("msg") if isinstance(p.json, dict) else None,
                    },
                )
            return Outcome(
                FAILED, f"{n} records returned outside the series' documented coverage", {"http": p.status}
            )

    _mk5()

# ===== D. pagination, filters, formats ========================================================


@test(
    "D-limit-cap",
    "protocol",
    "page size above 200 is rejected (documented cap)",
    f"GET {ENDPOINTS['wpi']} limit=201",
)
def _d1(ctx: Context) -> Outcome:
    p = ctx.api("wpi", {**WPI("2011-12", 2021)[1], "limit": 201})
    return Outcome(
        VERIFIED
        if p.status == 400 or (isinstance(p.json, dict) and p.json.get("statusCode") is False)
        else FAILED,
        f"HTTP {p.status}: {(p.json or {}).get('msg') if isinstance(p.json, dict) else p.text[:80]}",
    )


@test(
    "D-cpi-limit-cap",
    "protocol",
    "the CPI 2024 endpoint caps page size at 100 (lower than WPI/IIP)",
    f"GET {ENDPOINTS['cpi_2024']} limit=200",
)
def _d1b(ctx: Context) -> Outcome:
    p = ctx.api("cpi_2024", {**CPI2024("Current", 2025)[1], "limit": 200, "page": 1})
    j = p.json if isinstance(p.json, dict) else {}
    msg = j.get("error") or j.get("msg") or p.text[:100]
    # the API reports this as an error message in the body (observed: HTTP 200 with the text, or HTTP 400); never data
    return Outcome(VERIFIED if "100" in str(msg) and not p.rows else FAILED, f"HTTP {p.status}: {msg}")


@test(
    "D-pagination-consistent",
    "protocol",
    "WPI all-level query paginates consistently (meta_data agrees with pages)",
    f"GET {ENDPOINTS['wpi']} base_year=2011-12 year=2026 limit=200",
)
def _d2(ctx: Context) -> Outcome:
    p1 = ctx.api("wpi", {"base_year": "2011-12", "year": 2026, "limit": 200, "page": 1})
    meta = (p1.json or {}).get("meta_data") if isinstance(p1.json, dict) else None
    if not isinstance(meta, dict):
        return Outcome(FAILED, "no meta_data")
    tp, tr, rp = int(meta["totalPages"]), int(meta["totalRecords"]), int(meta["recordPerPage"])
    ok = math.ceil(tr / rp) == tp
    return Outcome(
        VERIFIED if ok else FAILED, f"totalRecords={tr} recordPerPage={rp} totalPages={tp}", {"meta": meta}
    )


@test(
    "D-page2-differs",
    "protocol",
    "page 2 returns different records from page 1",
    f"GET {ENDPOINTS['wpi']} base_year=2011-12 year=2026 limit=100",
)
def _d3(ctx: Context) -> Outcome:
    a = ctx.api("wpi", {"base_year": "2011-12", "year": 2026, "limit": 100, "page": 1}).rows
    b = ctx.api("wpi", {"base_year": "2011-12", "year": 2026, "limit": 100, "page": 2}).rows
    ka = {json.dumps(r, sort_keys=True) for r in a}
    kb = {json.dumps(r, sort_keys=True) for r in b}
    if not a or not b:
        return Outcome(FAILED, f"page sizes {len(a)} / {len(b)}")
    return Outcome(
        VERIFIED if not ka & kb else FAILED, f"{len(a)} + {len(b)} records, {len(ka & kb)} overlap"
    )


@test(
    "D-cpi2012-default-page",
    "protocol",
    "CPI 2012 legacy returns 10 rows by default but 12 exist (pagination is required)",
    f"GET {ENDPOINTS['cpi_group_legacy']} year=2021",
)
def _d4(ctx: Context) -> Outcome:
    p = ctx.api("cpi_group_legacy", CPI_LEGACY("2012", 2021)[1])
    n, tot = len(p.rows), p.total
    return Outcome(
        VERIFIED if tot == 12 and n < tot else FAILED,
        f"default page has {n} rows, totalRecords={tot}",
        {"rows": n, "total": tot},
    )


@test(
    "D-invalid-base",
    "protocol",
    "an unknown base year is rejected or empty, never silently mapped to another base",
    f"GET {ENDPOINTS['wpi']} base_year=1999-00",
)
def _d5(ctx: Context) -> Outcome:
    p = ctx.api("wpi", {"base_year": "1999-00", "major_group_code": "1000000000", "year": 2000})
    return Outcome(
        VERIFIED if not p.rows else FAILED,
        f"HTTP {p.status}, {len(p.rows)} rows, msg={(p.json or {}).get('msg') if isinstance(p.json, dict) else None!r}",
    )


@test(
    "D-invalid-year",
    "protocol",
    "a non-numeric year is rejected or empty",
    f"GET {ENDPOINTS['iip']} year=abcd",
)
def _d6(ctx: Context) -> Outcome:
    p = ctx.api("iip", {"base_year": "2022-23", "frequency": "Monthly", "type": "General", "year": "abcd"})
    return Outcome(VERIFIED if not p.rows else FAILED, f"HTTP {p.status}, {len(p.rows)} rows")


@test(
    "D-unknown-param",
    "protocol",
    "an unknown query parameter does not change the result",
    f"GET {ENDPOINTS['wpi']} +foo=bar",
)
def _d7(ctx: Context) -> Outcome:
    a = ctx.api("wpi", {**WPI("2022-23", 2026)[1], "limit": 200, "page": 1})
    b = ctx.api("wpi", {**WPI("2022-23", 2026)[1], "limit": 200, "page": 1, "foo": "bar"})
    same = a.digest == b.digest if b.status == 200 else b.status == 400
    return Outcome(VERIFIED if same else FAILED, f"HTTP {b.status}; identical body: {a.digest == b.digest}")


@test(
    "D-content-type",
    "protocol",
    "data endpoints answer JSON (not HTML error pages)",
    f"GET {ENDPOINTS['iip']}",
)
def _d8(ctx: Context) -> Outcome:
    p = ctx.api("iip", {**IIP_GEN("2022-23", 2026)[1], "limit": 200, "page": 1})
    return Outcome(
        VERIFIED if "json" in p.content_type and isinstance(p.json, dict) else FAILED,
        f"content-type {p.content_type!r}",
    )


@test(
    "D-csv-not-offered",
    "protocol",
    "no CSV/other format is offered by the data endpoint: a format=csv request still returns JSON",
    f"GET {ENDPOINTS['wpi']} format=csv",
)
def _d9(ctx: Context) -> Outcome:
    p = ctx.api("wpi", {**WPI("2022-23", 2026)[1], "limit": 200, "page": 1, "format": "csv"})
    return Outcome(
        VERIFIED if "json" in p.content_type else FAILED,
        f"content-type {p.content_type!r}: JSON is the only supported format",
    )


# ===== E. identity and metadata ===============================================================


@test(
    "E-cpi2012-headline-unique",
    "identity",
    "CPI 2012: exactly one all-India/combined/General row per month",
    f"GET {ENDPOINTS['cpi_group_legacy']} year=2021",
)
def _e1(ctx: Context) -> Outcome:
    rows, _, _ = ctx.paged("cpi_group_legacy", CPI_LEGACY("2012", 2021)[1])
    c = Counter(
        month_of(r)
        for r in rows
        if r.get("state") == "All India" and r.get("sector") == "Combined" and r.get("group") == "General"
    )
    return Outcome(
        VERIFIED if len(c) == 12 and set(c.values()) == {1} else FAILED,
        f"{len(c)} months, row counts {set(c.values())}",
    )


@test(
    "E-cpi2012-status-flags",
    "identity",
    "CPI 2012 rows carry a finality flag (status); record the observed values",
    f"GET {ENDPOINTS['cpi_group_legacy']} years 2021 and 2025",
)
def _e2(ctx: Context) -> Outcome:
    flags: Counter = Counter()
    for y in (2021, 2025):
        rows, _, _ = ctx.paged("cpi_group_legacy", CPI_LEGACY("2012", y)[1])
        flags.update(str(r.get("status")) for r in rows)
    return Outcome(
        VERIFIED if flags and "None" not in flags else FAILED,
        f"status values observed: {dict(flags)} (F=final; meaning of other codes not documented here)",
        {"flags": dict(flags)},
    )


@test(
    "E-cpi2012-first-year-null-inflation",
    "identity",
    "CPI 2012: no YoY inflation exists for the first year (2013); source gives null, not a value",
    f"GET {ENDPOINTS['cpi_group_legacy']} year=2013",
)
def _e3(ctx: Context) -> Outcome:
    rows, _, _ = ctx.paged("cpi_group_legacy", CPI_LEGACY("2012", 2013)[1])
    nulls = sum(1 for r in rows if r.get("inflation") in (None, ""))
    return Outcome(
        VERIFIED if rows and nulls >= 11 else FAILED,
        f"{nulls} of {len(rows)} months have null inflation (Jan 2013 lacks a prior year)",
    )


@test(
    "E-wpi-headline-unique",
    "identity",
    "WPI 2022-23: one headline row per month (no group/item rows leak in)",
    f"GET {ENDPOINTS['wpi']} year=2026",
)
def _e4(ctx: Context) -> Outcome:
    rows, _, _ = ctx.paged("wpi", WPI("2022-23", 2026)[1])
    ok = (
        rows
        and all(
            r.get("major_group") == "Wholesale Price Index" and not r.get("group") and not r.get("item")
            for r in rows
        )
        and len({month_of(r) for r in rows}) == len(rows)
    )
    return Outcome(VERIFIED if ok else FAILED, f"{len(rows)} rows")


@test(
    "E-iip-first-12-growth",
    "identity",
    "IIP 2011-12: growth_rate in the first served year equals index-100 (change from base, not YoY)",
    f"GET {ENDPOINTS['iip']} base_year=2011-12 year=2013",
)
def _e5(ctx: Context) -> Outcome:
    rows, _, _ = ctx.paged("iip", IIP_GEN("2011-12", 2013)[1])
    rows = [
        r for r in rows if r.get("category") == "General" and month_of(r)[0] == 2013 and month_of(r)[1] <= 3
    ]
    if not rows:
        return Outcome(EMPTY, "no Jan-Mar 2013 rows")
    diffs = [
        abs(float(r["growth_rate"]) - (float(r["index"]) - 100))
        for r in rows
        if r.get("growth_rate") not in (None, "")
    ]
    return Outcome(
        VERIFIED if diffs and max(diffs) < 0.11 else FAILED,
        f"max |growth - (index-100)| = {max(diffs) if diffs else None}",
        {"months": len(diffs)},
    )


@test(
    "E-iip-sector-set-2022-23",
    "identity",
    "IIP 2022-23 sectors: General plus four sector totals can be requested (category codes 4, 12, 2, 13, 14)",
    f"GET {ENDPOINTS['iip']} per category",
)
def _e6(ctx: Context) -> Outcome:
    got = {}
    for code, label in (
        (12, "Mining & Quarrying"),
        (2, "Manufacturing"),
        (13, "Electricity & Gas Supply"),
        (14, "Water Supply, Sewerage & Waste Management"),
    ):
        rows, _, _ = ctx.paged(
            "iip",
            {
                "base_year": "2022-23",
                "frequency": "Monthly",
                "type": "Sectoral",
                "category_code": code,
                "year": 2026,
            },
        )
        tot = [
            r
            for r in rows
            if r.get("category", "").casefold() == label.casefold() and not r.get("sub_category")
        ]
        got[label] = len(tot)
    return Outcome(
        VERIFIED if all(n >= 1 for n in got.values()) else FAILED,
        f"category-total rows per sector (2026): {got}",
        got,
    )


@test(
    "E-schema-stable-cpi2024",
    "identity",
    "CPI 2024 Current and Back share the same documented field names",
    f"GET {ENDPOINTS['cpi_2024']}",
)
def _e7(ctx: Context) -> Outcome:
    a = ctx.api(*CPI2024("Current", 2025)).rows
    b = ctx.api(*CPI2024("Back", 2020)).rows
    if not a or not b:
        return Outcome(FAILED, "missing rows")
    ka, kb = set(a[0]), set(b[0])
    return Outcome(
        VERIFIED if set(CPI24_REQ) <= ka & kb else FAILED,
        f"common fields {len(ka & kb)}; only Current: {sorted(ka - kb)}; only Back: {sorted(kb - ka)}",
    )


# ===== F. cross-check against the local database (read-only) ==================================

XCHECK = [
    (
        "CPI 2024 Current index 2025",
        CPI2024("Current", 2025),
        "index",
        "mospi.cpi.2024.current.all_india.combined.general.index",
        2025,
    ),
    (
        "CPI 2024 Back index 2022",
        CPI2024("Back", 2022),
        "index",
        "mospi.cpi.2024.back.all_india.combined.general.index",
        2022,
    ),
    (
        "WPI 2022-23 2025",
        WPI("2022-23", 2025),
        "index_value",
        "mospi.wpi.2022-23.india.all_commodities.index",
        2025,
    ),
    (
        "WPI 2011-12 2021",
        WPI("2011-12", 2021),
        "index_value",
        "mospi.wpi.2011-12.india.all_commodities.index",
        2021,
    ),
    (
        "IIP 2022-23 General 2025",
        IIP_GEN("2022-23", 2025),
        "index",
        "mospi.iip.2022-23.india.general.index",
        2025,
    ),
    (
        "IIP 2011-12 General 2021",
        IIP_GEN("2011-12", 2021),
        "index",
        "mospi.iip.2011-12.india.general.index",
        2021,
    ),
    (
        "CPI 2012 legacy index 2021",
        CPI_LEGACY("2012", 2021),
        "index",
        "mospi.cpi.2012.current.all_india.combined.general.index",
        2021,
    ),
    (
        "CPI 2012 legacy official inflation 2021",
        CPI_LEGACY("2012", 2021),
        "inflation",
        "mospi.cpi.2012.current.all_india.combined.general.inflation_yoy",
        2021,
    ),
    (
        "WPI 2004-05 archive 2010",
        WPI("2004-05", 2010),
        "index_value",
        "mospi.wpi.2004-05.india.all_commodities.index",
        2010,
    ),
    (
        "WPI 1993-94 archive 2000",
        WPI("1993-94", 2000),
        "index_value",
        "mospi.wpi.1993-94.india.all_commodities.index",
        2000,
    ),
    (
        "IIP 2004-05 archive General 2010",
        IIP_GEN("2004-05", 2010),
        "index",
        "mospi.iip.2004-05.india.general.index",
        2010,
    ),
    (
        "IIP 1993-94 archive General 2000",
        IIP_GEN("1993-94", 2000),
        "index",
        "mospi.iip.1993-94.india.general.index",
        2000,
    ),
]
for _i, (_n, _req, _vk, _code, _yr) in enumerate(XCHECK):

    def _mk6(i=_i, n=_n, req=_req, vk=_vk, code=_code, yr=_yr):
        @test(
            f"F-db-{i + 1}",
            "cross-check",
            f"live source equals the stored database values: {n}",
            f"GET {ENDPOINTS[req[0]]} vs series {code}",
        )
        def _t(ctx: Context) -> Outcome:
            if not ctx.db_url:
                return Outcome(SKIPPED, "no local database URL supplied")
            import psycopg

            rows, _, _ = ctx.paged(req[0], req[1])
            rows = [
                r
                for r in rows
                if (r.get("category") in (None, "General"))
                and (
                    r.get("major_group", r.get("majorgroup"))
                    in (None, "Wholesale Price Index", "Wholesale price index")
                )
                and (r.get("group") in (None, "General"))
                and not r.get("item")
            ]
            live = {month_of(r): to_decimal(r.get(vk)) for r in rows}
            with psycopg.connect(ctx.db_url, connect_timeout=5) as conn:
                conn.read_only = True
                got = conn.execute(
                    """SELECT period_date, value FROM current_observations
                        WHERE series_code = %s AND period_date >= %s AND period_date < %s""",
                    (code, date(yr, 1, 1), date(yr + 1, 1, 1)),
                ).fetchall()
            db = {(d.year, d.month): v for d, v in got}
            both = sorted(k for k in live if k in db and live[k] is not None)
            diffs = [k for k in both if live[k] != db[k]]
            only_live = sorted(k for k in live if k not in db and live[k] is not None)
            ok = both and not diffs and not only_live
            return Outcome(
                VERIFIED if ok else FAILED,
                f"{len(both)} months compared, {len(diffs)} differ, {len(only_live)} only at the source",
                {
                    "differ": [f"{a}-{b:02d}" for a, b in diffs[:5]],
                    "only_at_source": [f"{a}-{b:02d}" for a, b in only_live[:5]],
                },
            )

    _mk6()

# ===== G. idempotence / revision stability ====================================================

for _k, (_n, _req) in enumerate(
    (
        ("WPI 2022-23 2026", WPI("2022-23", 2026)),
        ("IIP 2022-23 2026", IIP_GEN("2022-23", 2026)),
        ("CPI 2012 2021", CPI_LEGACY("2012", 2021)),
    )
):

    def _mk7(k=_k, n=_n, req=_req):
        @test(
            f"G-stable-{k + 1}",
            "revision",
            f"{n}: a repeated request returns byte-identical data (no intra-day drift)",
            f"GET {ENDPOINTS[req[0]]} twice",
        )
        def _t(ctx: Context) -> Outcome:
            params = {**req[1], "limit": 200, "page": 1}
            a = ctx.api(req[0], params)
            time.sleep(ctx.delay_s)
            b_params = {**params, "page": 1}
            ctx.requests += 1
            r = ctx.client.get(req[0], b_params)
            return Outcome(
                VERIFIED if hashlib.sha256(r.content).hexdigest() == a.digest else FAILED,
                f"digest {a.digest[:12]} vs {hashlib.sha256(r.content).hexdigest()[:12]}",
            )

    _mk7()

# ===== H. portals and documentation sites =====================================================

PORTALS = [
    ("H-portal-esankhyiki", "https://esankhyiki.mospi.gov.in/", ("esankhyiki",)),
    ("H-portal-mospi", "https://www.mospi.gov.in/", ("statistics",)),
    ("H-portal-api", "https://api.mospi.gov.in/", ()),
    ("H-portal-oea", "https://eaindustry.nic.in/", ("economic adviser",)),
]
for _id, _url, _needles in PORTALS:

    def _mk8(id=_id, url=_url, needles=_needles):
        @test(
            id, "portal", f"{url} is reachable with verified TLS and has the expected content", f"GET {url}"
        )
        def _t(ctx: Context) -> Outcome:
            try:
                r = ctx.web.get(url)
            except httpx.HTTPError as exc:
                msg = f"{type(exc).__name__}: {str(exc)[:140]}"
                if isinstance(exc, httpx.ConnectError) and "CERTIFICATE" in str(exc).upper():
                    msg += " (TLS verification failed; NOT bypassed)"
                return Outcome(FAILED, msg)
            body = r.text.lower()
            if r.status_code >= 400 and url.endswith("mospi.gov.in/") and "api." in url:
                return Outcome(
                    VERIFIED, f"HTTP {r.status_code} on the API root is expected (data lives under /api/...)"
                )
            missing = [n for n in needles if n not in body]
            return Outcome(
                VERIFIED if r.status_code < 400 and not missing else FAILED,
                f"HTTP {r.status_code}, {len(r.text)} bytes, missing terms: {missing}",
            )

    _mk8()

# ===== I. freshness ===========================================================================

FRESH = [
    ("I-fresh-cpi2024", "CPI 2024 Current", CPI2024("Current", datetime.now(UTC).year), "index"),
    ("I-fresh-wpi2022", "WPI 2022-23", WPI("2022-23", datetime.now(UTC).year), "index_value"),
    ("I-fresh-iip2022", "IIP 2022-23 General", IIP_GEN("2022-23", datetime.now(UTC).year), "index"),
    ("I-fresh-wpi2011", "WPI 2011-12 (legacy)", WPI("2011-12", datetime.now(UTC).year), "index_value"),
    ("I-fresh-iip2011", "IIP 2011-12 (legacy)", IIP_GEN("2011-12", datetime.now(UTC).year), "index"),
    ("I-fresh-cpi2012", "CPI 2012 (legacy)", CPI_LEGACY("2012", datetime.now(UTC).year - 1), "index"),
]
for _id, _n, _req, _vk in FRESH:

    def _mk9(id=_id, n=_n, req=_req, vk=_vk):
        @test(
            id,
            "freshness",
            f"{n}: latest month the source serves (lag from today recorded, not judged)",
            f"GET {ENDPOINTS[req[0]]}",
        )
        def _t(ctx: Context) -> Outcome:
            rows, _, _ = ctx.paged(req[0], req[1])
            rows = [
                r
                for r in rows
                if r.get("category") in (None, "General")
                and r.get("group") in (None, "General")
                and not r.get("item")
                and r.get("major_group", r.get("majorgroup", "Wholesale Price Index"))
                in ("Wholesale Price Index", "Wholesale price index")
            ]
            ok = [month_of(r) for r in rows if to_decimal(r.get(vk)) is not None]
            if not ok:
                return Outcome(EMPTY, "no values for the year")
            y, m = max(ok)
            today = datetime.now(UTC)
            lag = (today.year * 12 + today.month) - (y * 12 + m)
            return Outcome(
                VERIFIED,
                f"latest {y}-{m:02d}; {lag} month(s) before the current month",
                {"latest": f"{y}-{m:02d}", "lag_months": lag},
            )

    _mk9()


# ---------------------------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------------------------


def run_all(ctx: Context, only: str | None = None, tests: list[T] | None = None) -> list[TestResult]:
    out: list[TestResult] = []
    for t in tests if tests is not None else TESTS:
        if only and only not in t.id:
            continue
        started = time.perf_counter()
        try:
            res = t.run(ctx)
        except Exception as exc:  # a crashing test is a failed test, never a silent pass
            res = Outcome(FAILED, f"test crashed: {type(exc).__name__}: {str(exc)[:160]}")
        out.append(
            TestResult(
                t.id,
                t.category,
                t.name,
                t.request,
                res.status,
                res.detail,
                res.evidence,
                round(time.perf_counter() - started, 2),
            )
        )
    return out


def summarize(results: list[TestResult]) -> dict[str, Any]:
    c = Counter(r.status for r in results)
    return {
        "total": len(results),
        **{k: c.get(k, 0) for k in (VERIFIED, EMPTY, FAILED, SKIPPED)},
        "by_category": {
            k: dict(Counter(r.status for r in results if r.category == k))
            for k in sorted({r.category for r in results})
        },
    }


__all__ = ["TESTS", "Context", "Outcome", "TestResult", "run_all", "summarize", "check_rows", "asdict", "ssl"]
