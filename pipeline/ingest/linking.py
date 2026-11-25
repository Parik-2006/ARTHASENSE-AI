# ruff: noqa: E501
"""Official base-year linking factors, with the evidence behind each one.

A linked value is an ArthaSense CALCULATION that applies an official factor. It is never stored as an
observation and never labelled as an index published by the government. Charts and the Indicators pages keep base
years apart. Forecasts V4 trains WPI and IIP on a back-cast that applies the WPI All Commodities and IIP General factors
below, in memory only, before the first new-base month (pipeline/research/loader.py, docs/FORECASTS-V4-WPI-HISTORY.md).

Evidence levels (same letters as docs/m1-data-verification.md):
  L  read from the primary publisher document in this audit, AND reproduced from stored data
  D  documented in the repository's earlier verification record; reproduced from stored data, but the
     primary table could not be read (none left: WPI and IIP were read in primary form on 2026-11-24)

Directions differ and are part of the record:
  CPI : linked(new base) = old * factor      (factor = GM(new, 2025) / GM(old, 2025))
  IIP : linked(new base) = old / factor      (factor = GM(old, FY2022-23) / 100)
  WPI : linked(new base) = old / factor      (factor = GM(old) / GM(new), FY2024-25)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class LinkingFactor:
    indicator: str
    scope: str
    old_base: str
    new_base: str
    factor: float
    direction: Literal["multiply", "divide"]  # how to carry an OLD value onto the NEW base
    method: str
    reference_period: str
    evidence: Literal["L", "D"]
    source: str
    reproduced: str  # what the stored data gives under the stated method

    def to_new_base(self, old_value: float) -> float:
        """Carry one old-base index value onto the new base. A calculation, not an official index."""
        return old_value * self.factor if self.direction == "multiply" else old_value / self.factor


FACTORS: tuple[LinkingFactor, ...] = (
    *(
        LinkingFactor(
            "CPI",
            f"All-India {sector} general index",
            "2012=100",
            "2024=100",
            f,
            "multiply",
            "Annual overlap: factor = geometric mean of the 2024-base index / geometric mean of the 2012-base index, 2025",
            "calendar year 2025",
            "L",
            "MoSPI, FAQs on CPI (base 2024), Annexure V, Q37-38 (read in this audit; PDF sha256 7720b640...)",
            "Combined: recomputed 0.5267 from 12 stored 2025 months; 2012-series x 0.5267 matches stored Back series to 0.05 (2024)",
        )
        for sector, f in (("Rural", 0.5222), ("Urban", 0.5320), ("Combined", 0.5267))
    ),
    *(
        LinkingFactor(
            "IIP",
            f"{name} index",
            "2011-12=100",
            "2022-23=100",
            f,
            "divide",
            "Geometric mean method: factor = geometric mean of the 2011-12 index over FY2022-23 / 100",
            "FY 2022-23 (Apr 2022 - Mar 2023)",
            "L",
            "NSO/MoSPI 'Linking Factor for IIP' (microdata.gov.in catalog 299, document 6676, read 2026-11-24): sector table; 'the linked series is obtained by dividing the indices of old series'",
            f"{f:.4f} reproduced exactly from stored 2011-12 index",
        )
        for name, f in (
            ("General", 1.3834),
            ("Mining", 1.1890),
            ("Manufacturing", 1.3700),
            ("Electricity", 1.8495),
        )
    ),
    LinkingFactor(
        "WPI",
        "All commodities",
        "2011-12=100",
        "2022-23=100",
        1.53,
        "divide",
        "Ratio of geometric means of the monthly indices, FY 2024-25 (old / new)",
        "FY 2024-25 (Apr 2024 - Mar 2025)",
        "L",
        "OEA 'Linking Factor For WPI Series (Base Year: 2022-23)', eaindustry.nic.in/linking_factor2223.asp (read 2026-11-24 over verified TLS), and OEA WPI 2022-23 FAQ Q20: back-cast = old index / 1.53",
        "1.5327 from 12 stored overlapping months (published to 2 d.p.: 1.53)",
    ),
)


def find(indicator: str, scope_contains: str) -> LinkingFactor:
    hits = [f for f in FACTORS if f.indicator == indicator and scope_contains.lower() in f.scope.lower()]
    if len(hits) != 1:
        raise LookupError(f"{len(hits)} factors match {indicator!r}/{scope_contains!r}")
    return hits[0]
