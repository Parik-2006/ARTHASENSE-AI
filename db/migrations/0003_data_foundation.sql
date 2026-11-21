-- ArthaSense AI — government data foundation (additive only).
-- Adds run history, quality-check results, freshness expectations and two read-only views.
-- Existing tables (sources, series, releases, observations, linking_factors, forecast_*) are NOT altered.

-- 1. Every ingestion / update-check run, including dry runs and runs that failed or were skipped.
CREATE TABLE ingestion_runs (
    id BIGSERIAL PRIMARY KEY,
    indicator TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
    trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled')),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'success', 'no_change', 'failed', 'skipped_locked')),
    base_year TEXT,
    year_from INTEGER,
    year_to INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    records_fetched INTEGER,
    rows_new INTEGER,
    rows_unchanged INTEGER,
    rows_revised INTEGER,
    rows_rejected INTEGER,
    error TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_ingestion_runs_indicator
    ON ingestion_runs (indicator, started_at DESC);

-- 2. Results of automated checks (one row per check per run and series).
CREATE TABLE quality_checks (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT REFERENCES ingestion_runs(id) ON DELETE SET NULL,
    series_id BIGINT REFERENCES series(id),
    check_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
    message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quality_checks_series ON quality_checks (series_id, checked_at DESC);

-- 3. When new data should be expected. These are configurable ASSUMPTIONS used to flag stale data,
--    not statements by the publisher. `basis` records where each number came from.
CREATE TABLE freshness_policy (
    indicator TEXT PRIMARY KEY,
    expected_lag_months INTEGER NOT NULL CHECK (expected_lag_months >= 0),
    grace_days INTEGER NOT NULL CHECK (grace_days >= 0),
    basis TEXT NOT NULL
);

INSERT INTO freshness_policy (indicator, expected_lag_months, grace_days, basis) VALUES
    ('CPI', 1, 20, 'Assumption: reference month is normally published in the following month; verify against the MoSPI release calendar.'),
    ('WPI', 1, 20, 'Assumption: reference month is normally published in the following month; verify against the OEA release calendar.'),
    ('IIP', 2, 20, 'Assumption: reference month is normally published about a month after month-end; verify against the MoSPI release calendar.');

-- 4. Months where the same series holds different values in different retrieval snapshots (revisions).
CREATE VIEW observation_revisions AS
SELECT s.code AS series_code,
       o.series_id,
       o.period_date,
       count(DISTINCT o.value) AS distinct_values,
       count(*) AS snapshots,
       min(r.retrieved_at) AS first_seen,
       max(r.retrieved_at) AS last_seen
  FROM observations o
  JOIN series s ON s.id = o.series_id
  JOIN releases r ON r.id = o.release_id
 GROUP BY s.code, o.series_id, o.period_date
HAVING count(DISTINCT o.value) > 1;

-- 5. The value currently in force for each series and month: the most recently retrieved snapshot.
CREATE VIEW current_observations AS
SELECT DISTINCT ON (o.series_id, o.period_date)
       o.series_id, s.code AS series_code, o.period_date, o.value,
       r.release_key, r.retrieved_at, r.published_at, r.source_url, r.content_sha256
  FROM observations o
  JOIN series s ON s.id = o.series_id
  JOIN releases r ON r.id = o.release_id
 ORDER BY o.series_id, o.period_date, r.retrieved_at DESC, r.id DESC;
