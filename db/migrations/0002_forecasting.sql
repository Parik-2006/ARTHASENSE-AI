-- ArthaSense AI: forecasting experiments (additive; migration 0001 is untouched).
--
-- A forecast_runs row is ONE evaluation unit:
--   kind='backtest' : one model, one series, ONE horizon step h, many forecast origins. Each
--                     forecasts row is the h-step-ahead prediction made at its origin, so
--                     (run_id, target_date) stays unique.
--   kind='forecast' : one model, one series, one origin, steps 1..horizon into the genuine future.
-- Source observations are never touched by forecasting.

ALTER TABLE forecast_runs
    ADD COLUMN experiment_id        TEXT,
    ADD COLUMN kind                 TEXT NOT NULL DEFAULT 'backtest'
        CHECK (kind IN ('backtest', 'forecast')),
    ADD COLUMN status               TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('completed', 'failed', 'skipped')),
    ADD COLUMN error                TEXT,
    ADD COLUMN random_seed          INTEGER,
    ADD COLUMN dataset_fingerprint  TEXT,
    ADD COLUMN origins_fingerprint  TEXT,
    ADD COLUMN snapshot_policy      TEXT,
    ADD COLUMN training_start        DATE,
    ADD COLUMN n_origins            INTEGER,
    ADD COLUMN runtime_seconds      DOUBLE PRECISION,
    ADD COLUMN suite                TEXT;

-- Deterministic experiment id: storing the same experiment twice is a no-op, never an overwrite.
CREATE UNIQUE INDEX uq_forecast_runs_experiment
    ON forecast_runs (experiment_id) WHERE experiment_id IS NOT NULL;
CREATE INDEX idx_forecast_runs_kind ON forecast_runs (kind, series_id, horizon);

ALTER TABLE forecasts
    ADD COLUMN origin_date      DATE,
    ADD COLUMN step             INTEGER CHECK (step IS NULL OR step > 0),
    ADD COLUMN actual_value     NUMERIC,
    ADD COLUMN lower_80         NUMERIC,
    ADD COLUMN upper_80         NUMERIC,
    ADD COLUMN lower_95         NUMERIC,
    ADD COLUMN upper_95         NUMERIC,
    ADD COLUMN interval_method  TEXT;

-- No NaN / Infinity in any stored number.
ALTER TABLE forecasts
    ADD CONSTRAINT forecasts_finite CHECK (
        point_forecast NOT IN ('NaN', 'Infinity', '-Infinity')
        AND (actual_value IS NULL OR actual_value NOT IN ('NaN', 'Infinity', '-Infinity'))
        AND (lower_80 IS NULL OR lower_80 NOT IN ('NaN', 'Infinity', '-Infinity'))
        AND (upper_80 IS NULL OR upper_80 NOT IN ('NaN', 'Infinity', '-Infinity'))
        AND (lower_95 IS NULL OR lower_95 NOT IN ('NaN', 'Infinity', '-Infinity'))
        AND (upper_95 IS NULL OR upper_95 NOT IN ('NaN', 'Infinity', '-Infinity'))
    ),
    ADD CONSTRAINT forecasts_interval_order CHECK (
        (lower_80 IS NULL OR upper_80 IS NULL OR lower_80 <= upper_80)
        AND (lower_95 IS NULL OR upper_95 IS NULL OR lower_95 <= upper_95)
    );

ALTER TABLE scores
    ADD COLUMN n_samples INTEGER CHECK (n_samples IS NULL OR n_samples >= 0),
    ADD COLUMN note      TEXT,
    ADD CONSTRAINT scores_finite CHECK (
        metric_value NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
    ),
    ADD CONSTRAINT uq_scores_run_metric UNIQUE (run_id, metric);

CREATE INDEX idx_forecasts_run ON forecasts (run_id, target_date);
