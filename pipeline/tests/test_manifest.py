from datetime import date

from pipeline.ingest.manifest import build, level, series_hash


def test_hash_is_deterministic_and_value_sensitive():
    p = [date(2025, 1, 1), date(2025, 2, 1)]
    assert series_hash(p, ["100.0", "101.0"]) == series_hash(p, ["100.0", "101.0"])
    assert series_hash(p, ["100.0", "101.0"]) != series_hash(p, ["100.0", "101.1"])
    assert series_hash(p, ["100.0", "101.0"]) != series_hash(p[:1], ["100.0"])


def test_verification_levels_and_unknown_series_are_flagged():
    assert level("mospi.cpi.2012.current.all_india.combined.general.index") == "verified_live_full"
    assert level("mospi.wpi.2022-23.india.all_commodities.index") == "verified_audit_monitor"
    assert level("mospi.cpi.2010.something") == "unverified"
    m = build([("mospi.x.unknown", [date(2025, 1, 1)], ["1"])])
    assert m["series"][0]["verification"] == "unverified" and m["total_rows"] == 1
