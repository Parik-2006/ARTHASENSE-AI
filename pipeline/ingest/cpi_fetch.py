"""Fetch CPI (2024 base, All India / Combined / General) from MoSPI with safe pagination."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pipeline.ingest.common import FetchError, fetch_paginated
from pipeline.ingest.cpi_records import filters
from pipeline.sources.mospi import MospiClient

__all__ = ["MIN_PAGE_SIZE", "FetchError", "FetchResult", "fetch_year"]

MIN_PAGE_SIZE = 10  # the API answers HTTP 400 below this


@dataclass
class FetchResult:
    year: int
    records: list[dict[str, Any]]
    pages: int
    requests: int
    retrieved_at: datetime


def fetch_year(
    client: MospiClient,
    year: int,
    *,
    page_size: int = MIN_PAGE_SIZE,
    delay_s: float = 0.5,
    max_retries: int = 3,
    backoff_s: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
    series_name: str = "Current",
) -> FetchResult:
    """Fetch every page for one calendar year, or raise FetchError. Never returns partial data."""
    r = fetch_paginated(
        client,
        "cpi_2024",
        {**filters(series_name), "year": year},
        key_fn=lambda rec: (rec.get("year"), rec.get("month")),
        page_size=page_size,
        min_page_size=MIN_PAGE_SIZE,
        delay_s=delay_s,
        max_retries=max_retries,
        backoff_s=backoff_s,
        sleep=sleep,
    )
    return FetchResult(year, r.records, r.pages, r.requests, r.retrieved_at)
