"""Helpers for offline tests: a fake MoSPI API built on httpx.MockTransport."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import httpx

from pipeline.sources.mospi import MospiClient

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]  # fmt: skip


def paged(rows: list[dict[str, Any]], params: httpx.QueryParams) -> httpx.Response:
    limit = int(params["limit"])
    page = int(params["page"])
    chunk = rows[(page - 1) * limit : page * limit]
    return httpx.Response(
        200,
        json={
            "data": chunk,
            "statusCode": True,
            "meta_data": {
                "page": page,
                "totalRecords": len(rows),
                "totalPages": max(1, math.ceil(len(rows) / limit)),
                "recordPerPage": limit,
            },
        },
    )


def client(handler: Callable[[httpx.Request], httpx.Response]) -> MospiClient:
    return MospiClient(client=httpx.Client(transport=httpx.MockTransport(handler)))


def no_sleep(_: float) -> None:
    pass


# ---- fake rows (shapes copied from the live API; values are made up for tests) -----------------


def wpi_row(year: int, month: int, value: str | None = "100.5", **over: Any) -> dict[str, Any]:
    return {
        "base_year": "2022-23", "year": year, "month": MONTHS[month - 1],
        "major_group": "Wholesale Price Index", "group": None, "sub_group": None,
        "sub_sub_group": None, "item": None, "index_value": value, **over,
    }  # fmt: skip


def iip_row(
    year: int, month: int, category: str = "General", sub: str = "", index: str | None = "120.0",
    growth: str | None = "5.0", **over: Any,
) -> dict[str, Any]:  # fmt: skip
    typ = "General" if category == "General" else "Sectoral"
    return {
        "base_year": "2022-23", "year": year, "month": MONTHS[month - 1], "type": typ,
        "category": category, "sub_category": sub, "index": index, "growth_rate": growth, **over,
    }  # fmt: skip


def with_(row: dict[str, Any], **over: Any) -> dict[str, Any]:
    return {**row, **over}
