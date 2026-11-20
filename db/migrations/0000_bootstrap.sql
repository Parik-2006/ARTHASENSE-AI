-- M0 bootstrap. The core schema (sources, series, releases, observations,
-- linking_factors, forecast_runs, forecasts, scores) is added in M2.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sha256      TEXT NOT NULL
);
