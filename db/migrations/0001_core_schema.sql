
-- ArthaSense AI — M2 Core Economic Data Schema
-- Migration: 0001_core_schema.sql

-- 1. Official data providers
CREATE TABLE sources (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    base_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Economic indicator series
CREATE TABLE series (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES sources(id),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    indicator TEXT NOT NULL,
    frequency TEXT NOT NULL
        CHECK (frequency IN ('monthly', 'quarterly', 'annual')),
    unit TEXT NOT NULL,
    base_year TEXT,
    geography TEXT NOT NULL DEFAULT 'India',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Official publication releases
CREATE TABLE releases (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES sources(id),
    release_key TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_url TEXT,
    content_sha256 TEXT,
    UNIQUE (source_id, release_key)
);

-- 4. Economic observations
CREATE TABLE observations (
    id BIGSERIAL PRIMARY KEY,
    series_id BIGINT NOT NULL REFERENCES series(id),
    release_id BIGINT NOT NULL REFERENCES releases(id),
    period_date DATE NOT NULL,
    value NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (series_id, release_id, period_date)
);

CREATE INDEX idx_observations_series_period
    ON observations (series_id, period_date DESC);

-- 5. Statistical base-year linking factors
CREATE TABLE linking_factors (
    id BIGSERIAL PRIMARY KEY,
    old_series_id BIGINT NOT NULL REFERENCES series(id),
    new_series_id BIGINT NOT NULL REFERENCES series(id),
    factor NUMERIC NOT NULL CHECK (factor > 0),
    reference_period DATE,
    source_release_id BIGINT REFERENCES releases(id),
    methodology TEXT,
    UNIQUE (old_series_id, new_series_id, reference_period)
);

-- 6. Forecast experiment runs
CREATE TABLE forecast_runs (
    id BIGSERIAL PRIMARY KEY,
    series_id BIGINT NOT NULL REFERENCES series(id),
    model_name TEXT NOT NULL,
    model_version TEXT,
    training_cutoff DATE NOT NULL,
    release_cutoff TIMESTAMPTZ,
    horizon INTEGER NOT NULL CHECK (horizon > 0),
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Forecast predictions
CREATE TABLE forecasts (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES forecast_runs(id)
        ON DELETE CASCADE,
    target_date DATE NOT NULL,
    point_forecast NUMERIC NOT NULL,
    lower_bound NUMERIC,
    upper_bound NUMERIC,
    CHECK (
        lower_bound IS NULL
        OR upper_bound IS NULL
        OR lower_bound <= upper_bound
    ),
    UNIQUE (run_id, target_date)
);

-- 8. Forecast evaluation scores
CREATE TABLE scores (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES forecast_runs(id)
        ON DELETE CASCADE,
    metric TEXT NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    evaluation_start DATE,
    evaluation_end DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_forecast_runs_series
    ON forecast_runs (series_id, created_at DESC);
