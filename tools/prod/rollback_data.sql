-- Roll back the 2026-11 production import (keeps the schema). Keys on the PRE-IMPORT baseline maxima recorded from
-- the read-only production export on 2026-11-22: releases.id <= 9, series.id <= 20, observations.id <= 415.
-- Everything the import created has a larger id. Review the SELECT before COMMIT; expected: 1 / 12 / 9 / 415 / 176 / 1195 / 718.
BEGIN;
DELETE FROM source_artifacts WHERE release_id > 9;
DELETE FROM observations     WHERE release_id > 9;
DELETE FROM releases         WHERE id > 9;
DELETE FROM series s WHERE s.id > 20
   AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.series_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM forecast_runs f WHERE f.series_id = s.id);
SELECT (SELECT count(*) FROM sources) AS sources, (SELECT count(*) FROM series) AS series, (SELECT count(*) FROM releases) AS releases,
       (SELECT count(*) FROM observations) AS observations, (SELECT count(*) FROM forecast_runs) AS forecast_runs,
       (SELECT count(*) FROM forecasts) AS forecasts, (SELECT count(*) FROM scores) AS scores,
       (SELECT md5(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text COLLATE "C")) FROM observations t) AS observations_fp;
COMMIT;
