# ruff: noqa: E501
import hashlib
import math
from datetime import date

import httpx
import psycopg
import pytest
from mospi_mock import no_sleep, paged, wpi_row

from pipeline.ingest import monitor
from pipeline.ingest.evidence import PARSER_VERSION, RecordingClient
from pipeline.ingest.linking import FACTORS, find

TODAY = date(2026, 2, 15)


# ---- linking registry ---------------------------------------------------------------------------


def test_directions_and_round_trip_for_each_indicator():
    cpi = find("CPI", "Combined")
    assert cpi.direction == "multiply" and cpi.to_new_base(198.0) == pytest.approx(104.2866, abs=1e-4)
    for f in FACTORS:
        # applying the factor in its stated direction then undoing it returns the old value
        back = (
            f.to_new_base(100.0) / f.factor if f.direction == "multiply" else f.to_new_base(100.0) * f.factor
        )
        assert back == pytest.approx(100.0)
    assert find("IIP", "General").direction == "divide" and find("WPI", "All").direction == "divide"


def test_every_factor_names_its_evidence_and_primary_ones_are_only_cpi():
    assert all(f.source and f.method and f.reproduced for f in FACTORS)
    assert {f.indicator for f in FACTORS if f.evidence == "L"} == {"CPI"}
    assert {f.indicator for f in FACTORS if f.evidence == "D"} == {"IIP", "WPI"}


def test_cpi_formula_is_ratio_of_geometric_means():
    old = [185.5, 190.0, 195.0, 198.0]  # made-up overlap-year values
    new = [97.0, 100.0, 103.0, 104.0]
    gm = lambda v: math.exp(sum(math.log(x) for x in v) / len(v))  # noqa: E731
    lf = gm(new) / gm(old)
    assert old[0] * lf == pytest.approx(old[0] * (gm(new) / gm(old)))
    assert 0.5 < lf < 0.6


def test_unknown_factor_lookup_fails_loudly():
    with pytest.raises(LookupError):
        find("CPI", "Nonexistent")


# ---- raw evidence --------------------------------------------------------------------------------

integration = pytest.mark.integration


def rec_client(handler, tmp_path):
    return RecordingClient(httpx.Client(transport=httpx.MockTransport(handler)), evidence_dir=tmp_path)


def test_recording_client_hashes_and_archives_exact_bytes(tmp_path):
    body = b'{"data": [], "meta_data": {}}'
    c = rec_client(
        lambda r: httpx.Response(200, content=body, headers={"content-type": "application/json"}), tmp_path
    )
    c.get("wpi")
    [cap] = c.take()
    assert cap.sha256 == hashlib.sha256(body).hexdigest() and cap.size == len(body)
    assert (tmp_path / "raw" / cap.sha256).read_bytes() == body
    assert c.take() == []  # cleared after taking


@integration
def test_monitor_apply_links_raw_evidence_and_is_idempotent(migrated_db_url, monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", migrated_db_url)
    monkeypatch.setattr("time.sleep", no_sleep)

    def handler(req):
        rows = [wpi_row(2026, m, "100.0") for m in (1, 2)] if int(req.url.params["year"]) == 2026 else []
        return paged(rows, req.url.params)

    argv = ["--only", "wpi:2022-23", "--years-back", "0", "--delay", "0", "--apply"]
    for _ in range(2):
        assert monitor.run(argv, rec_client(handler, tmp_path), TODAY) == 0
    with psycopg.connect(migrated_db_url) as c:
        rows = c.execute(
            "SELECT a.raw_sha256, a.normalized_sha256, a.parser_version, r.content_sha256 "
            "FROM source_artifacts a JOIN releases r ON r.id = a.release_id"
        ).fetchall()
    assert len(rows) == 1  # re-run did not duplicate the artifact
    raw, norm, parser, content = rows[0]
    assert parser == PARSER_VERSION and norm == content and raw != norm  # raw and normalized hashes differ
    assert (tmp_path / "raw" / raw).exists()
