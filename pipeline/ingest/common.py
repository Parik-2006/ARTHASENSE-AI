"""Building blocks shared by every MoSPI indicator ingestion (CPI, WPI, IIP, ...).

Pure helpers (parsing, validation errors, year-range CLI logic) plus the safe paginated fetcher.
Indicator-specific rules (filters, expected labels) live in each indicator's own module.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from pipeline.sources.mospi import MospiClient, records

MAX_PAGE_SIZE = 200  # verified live: the API answers HTTP 400 "Limit cannot be greater than 200"
MAX_PAGES = 60
RETRY_STATUS = {429, 500, 502, 503, 504}

MONTHS = {
    name: i
    for i, name in enumerate(
        ["January", "February", "March", "April", "May", "June",
         "July", "August", "September", "October", "November", "December"],
        start=1,
    )
}  # fmt: skip


class ValidationError(ValueError):
    """A record did not match what we asked the API for. The whole ingestion must stop."""


class FetchError(RuntimeError):
    """The API could not give us a complete, consistent answer."""


def parse_month(value: Any) -> int:
    if not isinstance(value, str) or value.strip().capitalize() not in MONTHS:
        raise ValidationError(f"invalid month name: {value!r}")
    return MONTHS[value.strip().capitalize()]


def parse_decimal(value: Any, field: str) -> Decimal | None:
    """None / empty string -> None (missing, never zero). Anything else must be a finite number."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool) or not isinstance(value, str | int | float):
        raise ValidationError(f"{field}: not a number: {value!r}")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ValidationError(f"{field}: not a number: {value!r}") from None
    if not number.is_finite():
        raise ValidationError(f"{field}: not a finite number: {value!r}")
    return number


def parse_year(value: Any, start_year: int, end_year: int) -> int:
    if not isinstance(value, str | int) or isinstance(value, bool) or not str(value).strip().isdigit():
        raise ValidationError(f"invalid year: {value!r}")
    year = int(str(value).strip())
    if not start_year <= year <= end_year:
        raise ValidationError(f"year {year} outside requested range {start_year}-{end_year}")
    return year


def expect_fields(raw: dict[str, Any], expected: dict[str, Any]) -> None:
    for key, want in expected.items():
        if raw.get(key) != want:
            raise ValidationError(f"{key}: expected {want!r}, got {raw.get(key)!r}")


# ---------------------------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------------------------


@dataclass
class PagedResult:
    records: list[dict[str, Any]]
    pages: int
    requests: int
    retrieved_at: datetime


def _get_json(
    client: MospiClient,
    endpoint: str,
    params: dict[str, Any],
    *,
    max_retries: int,
    backoff_s: float,
    sleep: Callable[[float], None],
    counter: list[int],
) -> dict[str, Any]:
    """One GET with bounded retries for transient failures (network, 429, 5xx)."""
    last = "unknown error"
    for attempt in range(max_retries + 1):
        if attempt:
            sleep(backoff_s * 2 ** (attempt - 1))
        counter[0] += 1
        try:
            resp = client.get(endpoint, params)
        except httpx.TransportError as exc:  # timeouts, connection errors
            last = type(exc).__name__
            continue
        if resp.status_code in RETRY_STATUS:
            last = f"HTTP {resp.status_code}"
            continue
        if resp.status_code != 200:
            raise FetchError(f"MoSPI returned HTTP {resp.status_code} (not retried)")
        try:
            payload = resp.json()
        except ValueError:
            raise FetchError("MoSPI returned malformed JSON") from None
        if not isinstance(payload, dict):
            raise FetchError("MoSPI returned an unexpected JSON shape")
        if payload.get("statusCode") is False:
            raise FetchError(f"MoSPI reported an error: {payload.get('msg')!r}")
        return payload
    raise FetchError(f"MoSPI request failed after {max_retries + 1} attempts ({last})")


def fetch_paginated(
    client: MospiClient,
    endpoint: str,
    params: dict[str, Any],
    *,
    key_fn: Callable[[dict[str, Any]], Any],
    page_size: int,
    min_page_size: int = 10,
    delay_s: float = 0.5,
    max_retries: int = 3,
    backoff_s: float = 1.0,
    sleep: Callable[[float], None] | None = None,
) -> PagedResult:
    """Fetch every page of one filtered query, or raise FetchError. Never returns partial data.

    `key_fn` must identify one record uniquely within the query; it drives repeated-page and
    duplicate detection.
    """
    sleep = sleep or time.sleep  # resolved per call so tests can patch time.sleep
    if not min_page_size <= page_size <= MAX_PAGE_SIZE:
        raise ValueError(f"page_size must be between {min_page_size} and {MAX_PAGE_SIZE}")
    retrieved_at = datetime.now(UTC)
    counter = [0]
    collected: list[dict[str, Any]] = []
    seen_keys: set[Any] = set()
    total_pages = 1
    total_records = 0
    page = 1
    while page <= total_pages:
        if page > 1:
            sleep(delay_s)
        payload = _get_json(
            client,
            endpoint,
            {**params, "limit": page_size, "page": page},
            max_retries=max_retries,
            backoff_s=backoff_s,
            sleep=sleep,
            counter=counter,
        )
        meta = payload.get("meta_data")
        if not isinstance(meta, dict):
            raise FetchError("response has no meta_data (pagination info)")
        try:
            total_records = int(meta["totalRecords"])
            total_pages = int(meta["totalPages"])
            per_page = int(meta["recordPerPage"])
            answered_page = int(meta["page"]) if meta.get("page") is not None else page
        except (KeyError, TypeError, ValueError):
            raise FetchError("meta_data is missing totalRecords/totalPages/recordPerPage") from None
        if answered_page != page:
            raise FetchError(f"asked for page {page}, API answered page {answered_page}")
        if total_pages > MAX_PAGES:
            raise FetchError(f"{total_pages} pages is more than the safety limit of {MAX_PAGES}")
        if per_page < 1 or math.ceil(total_records / per_page) != total_pages:
            raise FetchError("inconsistent pagination metadata")
        rows = records(payload)
        keys = [key_fn(r) for r in rows]
        if set(keys) & seen_keys:
            raise FetchError(f"page {page} repeats records from an earlier page")
        if len(set(keys)) != len(keys):
            raise FetchError(f"page {page} contains duplicate periods")
        seen_keys |= set(keys)
        collected.extend(rows)
        page += 1
    if len(collected) != total_records:
        raise FetchError(f"expected {total_records} records, collected {len(collected)}")
    return PagedResult(collected, total_pages, counter[0], retrieved_at)


# ---------------------------------------------------------------------------------------------
# CLI helpers
# ---------------------------------------------------------------------------------------------

MAX_YEARS = 5  # keep every single run small; use pipeline.ingest.history for longer ranges


def resolve_years(
    year: int | None,
    start_year: int | None,
    end_year: int | None,
    *,
    first_year: int,
    max_years: int = MAX_YEARS,
    today_year: int | None = None,
) -> tuple[int, int]:
    """Turn CLI flags into a bounded (start, end) year range, or raise ValueError."""
    last_year = today_year or datetime.now(UTC).year
    if year is not None:
        if start_year is not None or end_year is not None:
            raise ValueError("use either --year, or --start-year with --end-year")
        start = end = year
    elif start_year is not None and end_year is not None:
        start, end = start_year, end_year
    else:
        raise ValueError("give --year, or both --start-year and --end-year")
    if start > end:
        raise ValueError("--start-year must not be after --end-year")
    if start < first_year or end > last_year:
        raise ValueError(f"years must be between {first_year} and {last_year}")
    if end - start + 1 > max_years:
        raise ValueError(f"at most {max_years} years per run")
    return start, end
