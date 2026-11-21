-- ArthaSense AI: raw source evidence (additive only; no existing table is altered).
-- One row per HTTP response that contributed to a stored release.
--   raw_sha256        hash of the exact response bytes as received
--   normalized_sha256 hash of the validated records (this equals releases.content_sha256)
-- The bytes themselves live outside Git (storage_path, relative to the evidence directory).

CREATE TABLE source_artifacts (
    id BIGSERIAL PRIMARY KEY,
    release_id BIGINT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'api_response',
    request_url TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    content_type TEXT,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    raw_sha256 TEXT NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
    normalized_sha256 TEXT,
    storage_path TEXT,
    parser_version TEXT NOT NULL,
    validation_version TEXT NOT NULL,
    retrieved_at TIMESTAMPTZ NOT NULL,
    UNIQUE (release_id, raw_sha256, request_url)
);

CREATE INDEX idx_source_artifacts_release ON source_artifacts (release_id);
CREATE INDEX idx_source_artifacts_raw ON source_artifacts (raw_sha256);
