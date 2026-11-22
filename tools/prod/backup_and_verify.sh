#!/usr/bin/env bash
# Production backup with a PostgreSQL 17 client, then a test restore into an isolated PostgreSQL 17 container and a
# fingerprint comparison with the pre-import baseline. READS production only.
#
#   bash tools/prod/backup_and_verify.sh  P:/ArthaSense-AI/.prod.env  P:/ArthaSense-AI/backups
#
# * The URL stays inside the env file: docker reads it with --env-file, so it never appears on a command line, in shell
#   history or in logs. Only file names and counts are printed.
# * Use Supabase's SESSION pooler URL (port 5432) if the direct host is IPv6-only; not the transaction pooler (6543).
# * Output: <backups>/arthasense-prod-<UTC timestamp>.dump (custom format, whole database) + .sha256 + restore report.
#   Keep the backups folder OUTSIDE the repository (it is never committed).
set -euo pipefail
ENV_FILE="$1"; OUT_DIR="$2"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="arthasense-prod-$STAMP.dump"

echo "1/4 pg_dump (PostgreSQL 17 client) -> $DUMP"
docker run --rm --env-file "$ENV_FILE" -v "$OUT_DIR:/backup" postgres:17 \
  sh -c 'pg_dump "$ARTHASENSE_PROD_DATABASE_URL" --format=custom --no-owner --no-privileges --file "/backup/'"$DUMP"'"'
( cd "$OUT_DIR" && sha256sum "$DUMP" > "$DUMP.sha256" && ls -l "$DUMP" )

echo "2/4 archive is readable"
docker run --rm -v "$OUT_DIR:/backup" postgres:17 pg_restore --list "/backup/$DUMP" | grep -c "TABLE DATA public" | sed 's/^/public table-data entries: /'

echo "3/4 test restore of the public schema into an isolated PostgreSQL 17 container"
docker rm -f arthasense-restoretest17 >/dev/null 2>&1 || true
docker run -d --name arthasense-restoretest17 -e POSTGRES_PASSWORD=restoretest -e POSTGRES_DB=restoretest -v "$OUT_DIR:/backup" postgres:17 >/dev/null
for i in $(seq 1 30); do docker exec arthasense-restoretest17 pg_isready -U postgres -d restoretest >/dev/null 2>&1 && break; sleep 1; done; sleep 2
docker exec arthasense-restoretest17 pg_restore --no-owner --no-privileges --schema=public -d restoretest "/backup/$DUMP" || true

echo "4/4 fingerprint vs the pre-import production baseline"
for t in sources series releases observations linking_factors forecast_runs forecasts scores; do
  docker exec arthasense-restoretest17 psql -U postgres -d restoretest -At -c \
    "select '$t', count(*), coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text collate \"C\")), '') from $t t"
done | tee "$OUT_DIR/$DUMP.restore-check.txt"
docker exec arthasense-restoretest17 psql -U postgres -d restoretest -At -c "select string_agg(version, ',' order by version) from schema_migrations" | sed 's/^/migrations: /'
echo "compare with $REPO/reports/production-baseline-fingerprint.json"
