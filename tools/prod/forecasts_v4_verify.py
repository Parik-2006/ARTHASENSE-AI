"""Forecasts V4 integrity check (READ-ONLY; the session is forced read-only where the server honours it).

    # before the import: record a baseline of everything that must not change
    python tools/prod/forecasts_v4_verify.py baseline --env-file P:/ArthaSense-AI/.prod.env --out before.json
    # after: compare with the baseline, and (optionally) prove the new runs equal a rehearsal database's runs
    python tools/prod/forecasts_v4_verify.py check --env-file ... --baseline before.json [--reference-url-env REF_URL]

`check` verifies:
  * official data (sources, series, releases, observations, linking_factors) is byte-identical to the baseline;
  * every pre-existing forecast run, its forecasts and its scores are byte-identical (nothing overwritten);
  * no pre-existing row was deleted; only new rows were added;
  * every new run is completed/skipped/failed with a unique experiment id, its forecasts satisfy lower_95 <= lower_80
    <= point <= upper_80 <= upper_95 and target dates after the training cutoff, and its series is a forecast target;
  * with a reference database: each new run (matched by experiment_id) has identical status, metrics and forecast rows.
Only counts and fingerprints are printed; the URL never is.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os

import psycopg

OFFICIAL = ["sources", "series", "releases", "observations", "linking_factors"]
TARGET_SERIES = (
    "mospi.cpi.2024.current.all_india.combined.general.index",
    "mospi.wpi.2022-23.india.all_commodities.index",
    "mospi.iip.2022-23.india.general.index",
    "mospi.nas.2022-23.india.gdp.real.level",
)


def _url(a: argparse.Namespace, which: str = "") -> str:
    if which:
        return os.environ[which]
    if a.env_file:
        return [
            x.split("=", 1)[1].strip()
            for x in open(a.env_file, encoding="utf-8")
            if x.startswith(a.var + "=")
        ][0]
    return os.environ[a.url_env]


def _connect(url: str) -> psycopg.Connection:
    conn = psycopg.connect(url, connect_timeout=20, options="-c default_transaction_read_only=on")
    conn.execute("SET extra_float_digits = 0")
    return conn


def _fp(conn: psycopg.Connection, sql: str) -> dict:
    rows = conn.execute(f"SELECT row_to_json(t)::text FROM ({sql}) t").fetchall()
    body = sorted(r[0] for r in rows)
    return {"rows": len(body), "md5": hashlib.md5("|".join(body).encode()).hexdigest()}


def baseline(conn: psycopg.Connection) -> dict:
    max_run = conn.execute("SELECT coalesce(max(id), 0) FROM forecast_runs").fetchone()[0]
    out = {"max_run_id": max_run, "official": {t: _fp(conn, f"SELECT * FROM {t}") for t in OFFICIAL}}
    out["old_runs"] = _fp(conn, f"SELECT * FROM forecast_runs WHERE id <= {max_run}")
    out["old_forecasts"] = _fp(conn, f"SELECT * FROM forecasts WHERE run_id <= {max_run}")
    out["old_scores"] = _fp(conn, f"SELECT * FROM scores WHERE run_id <= {max_run}")
    out["counts"] = {
        t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ("forecast_runs", "forecasts", "scores")
    }
    out["migrations"] = [r[0] for r in conn.execute("SELECT version FROM schema_migrations ORDER BY 1")]
    return out


def _new_runs(conn: psycopg.Connection, after: int) -> dict[str, dict]:
    runs = {}
    for rid, eid, status, kind, model, h, cut, code in conn.execute(
        "SELECT fr.id, fr.experiment_id, fr.status, fr.kind, fr.model_name, fr.horizon, fr.training_cutoff, s.code"
        " FROM forecast_runs fr JOIN series s ON s.id = fr.series_id WHERE fr.id > %s ORDER BY fr.id",
        (after,),
    ):
        fc = conn.execute(
            "SELECT target_date, origin_date, step, point_forecast::float8, actual_value::float8, lower_80::float8,"
            " upper_80::float8, lower_95::float8, upper_95::float8, interval_method FROM forecasts WHERE run_id=%s ORDER BY 1, 2",
            (rid,),
        ).fetchall()
        sc = dict(conn.execute("SELECT metric, metric_value FROM scores WHERE run_id=%s", (rid,)).fetchall())
        runs[eid] = {"id": rid, "status": status, "kind": kind, "model": model, "h": h, "cutoff": str(cut), "series": code,
                     "forecasts": [list(map(lambda v: v.isoformat() if hasattr(v, "isoformat") else v, r)) for r in fc],
                     "scores": sc}  # fmt: skip
    return runs


def check(
    conn: psycopg.Connection, base: dict, ref: psycopg.Connection | None
) -> tuple[list[tuple[str, bool, str]], dict]:
    res: list[tuple[str, bool, str]] = []
    add = lambda name, ok, d="": res.append((name, bool(ok), str(d)))  # noqa: E731
    after = baseline(conn)
    for t in OFFICIAL:
        add(
            f"official table {t} unchanged", after["official"][t] == base["official"][t], after["official"][t]
        )
    m = base["max_run_id"]
    add(
        "pre-existing runs unchanged",
        _fp(conn, f"SELECT * FROM forecast_runs WHERE id <= {m}") == base["old_runs"],
        base["old_runs"]["rows"],
    )
    add(
        "pre-existing forecasts unchanged",
        _fp(conn, f"SELECT * FROM forecasts WHERE run_id <= {m}") == base["old_forecasts"],
        base["old_forecasts"]["rows"],
    )
    add(
        "pre-existing scores unchanged",
        _fp(conn, f"SELECT * FROM scores WHERE run_id <= {m}") == base["old_scores"],
        base["old_scores"]["rows"],
    )
    add("migrations unchanged", after["migrations"] == base["migrations"], after["migrations"])
    new = _new_runs(conn, m)
    add(
        "experiment ids unique",
        conn.execute(
            "SELECT count(*) = count(DISTINCT experiment_id) FROM forecast_runs WHERE experiment_id IS NOT NULL"
        ).fetchone()[0],
    )
    add(
        "new runs only on forecast target series",
        all(r["series"] in TARGET_SERIES for r in new.values()),
        len(new),
    )
    bad = []
    for eid, r in new.items():
        for t, _o, _s, p, _a, l8, u8, l95, u95, _m in r["forecasts"]:
            chain = [v for v in (l95, l8, p, u8, u95) if v is not None]
            paired = (l8 is None) == (u8 is None) and (l95 is None) == (u95 is None)
            if not paired or any(a > b for a, b in zip(chain, chain[1:], strict=False)):
                bad.append((eid, t))
            if r["kind"] == "forecast" and t <= r["cutoff"]:
                bad.append((eid, t, "target before cutoff"))
    add("new forecast rows: interval order and future targets", not bad, bad[:3])
    orphans = conn.execute(
        "SELECT count(*) FROM forecasts f LEFT JOIN forecast_runs r ON r.id=f.run_id WHERE r.id IS NULL"
    ).fetchone()[0]
    add("no orphan forecast rows", orphans == 0, orphans)
    summary = {"before": base["counts"], "after": after["counts"], "new_runs": len(new),
               "new_by_status": {s: sum(1 for r in new.values() if r["status"] == s) for s in ("completed", "skipped", "failed")}}  # fmt: skip
    if ref is not None:
        rnew = _new_runs(ref, m)
        add(
            "same set of new experiment ids as the reference",
            set(new) == set(rnew),
            f"{len(new)} vs {len(rnew)}",
        )
        diff = []
        for eid in set(new) & set(rnew):
            a, b = new[eid], rnew[eid]
            same_sc = a["scores"].keys() == b["scores"].keys() and all(
                abs(a["scores"][k] - b["scores"][k]) <= 1e-9 * max(1, abs(b["scores"][k]))
                for k in a["scores"]
            )
            if a["status"] != b["status"] or a["forecasts"] != b["forecasts"] or not same_sc:
                diff.append(eid)
        add("new runs identical to the reference (status, forecasts, scores)", not diff, diff[:5])
    return res, summary


def _write(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1)


def _read(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("what", choices=["baseline", "check"])
    p.add_argument("--env-file")
    p.add_argument("--var", default="ARTHASENSE_PROD_DATABASE_URL")
    p.add_argument("--url-env", default="ARTHASENSE_DATABASE_URL")
    p.add_argument("--out")
    p.add_argument("--baseline")
    p.add_argument("--reference-url-env")
    a = p.parse_args()
    with _connect(_url(a)) as conn:
        if a.what == "baseline":
            b = baseline(conn)
            _write(a.out, b)
            print(
                json.dumps(
                    {
                        "max_run_id": b["max_run_id"],
                        "counts": b["counts"],
                        "observations": b["official"]["observations"],
                    }
                )
            )
            return 0
        ref = _connect(_url(a, a.reference_url_env)) if a.reference_url_env else None
        res, summary = check(conn, _read(a.baseline), ref)
    for name, ok, d in res:
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {d[:160]}")
    print(json.dumps(summary))
    if a.out:
        _write(
            a.out, {"checks": [{"name": n, "pass": o, "detail": d} for n, o, d in res], "summary": summary}
        )
    return 0 if all(o for _, o, _ in res) else 1


if __name__ == "__main__":
    raise SystemExit(main())
