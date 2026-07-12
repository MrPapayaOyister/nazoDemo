#!/usr/bin/env bash
# Bootstrap the ISOLATED "nazo" Postgres role + database on the shared server.
# Idempotent: safe to re-run. NEVER drops anything. NEVER touches other databases
# (videopro / aganeti / aganeti_genesis are left completely alone).
#
# Runs psql as the superuser inside the existing "postgres" container. Override
# the container name / superuser / password via env if your setup differs.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-postgres}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
NAZO_DB="${NAZO_DB:-nazo}"
NAZO_ROLE="${NAZO_ROLE:-nazo}"
NAZO_PASSWORD="${NAZO_PASSWORD:-CHANGEME}"
PG_HOST="${PG_HOST:-host.docker.internal}"
PG_PORT="${PG_PORT:-5432}"

if [ "${NAZO_PASSWORD}" = "CHANGEME" ]; then
  echo ">> WARNING: NAZO_PASSWORD is still the default 'CHANGEME'; set NAZO_PASSWORD before production use." >&2
fi

echo ">> Bootstrapping role '${NAZO_ROLE}' and database '${NAZO_DB}' via container '${PG_CONTAINER}'"

psql_super() {
  docker exec -i "${PG_CONTAINER}" psql -v ON_ERROR_STOP=1 -U "${PG_SUPERUSER}" "$@"
}

# 1. Create the role if it does not exist (IF-NOT-EXISTS via \gexec pattern).
psql_super -d postgres <<SQL
SELECT 'CREATE ROLE ${NAZO_ROLE} LOGIN PASSWORD ' || quote_literal('${NAZO_PASSWORD}')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${NAZO_ROLE}')\gexec
SQL

# 2. Create the database owned by the role if it does not exist.
psql_super -d postgres <<SQL
SELECT 'CREATE DATABASE ${NAZO_DB} OWNER ${NAZO_ROLE}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${NAZO_DB}')\gexec
SQL

# 3. Grant privileges (idempotent).
psql_super -d postgres <<SQL
GRANT ALL PRIVILEGES ON DATABASE ${NAZO_DB} TO ${NAZO_ROLE};
SQL

# 4. Ensure the role owns the public schema in the new db (so create_all works).
psql_super -d "${NAZO_DB}" <<SQL
ALTER SCHEMA public OWNER TO ${NAZO_ROLE};
GRANT ALL ON SCHEMA public TO ${NAZO_ROLE};
SQL

echo ">> Done."
echo ">> DATABASE_URL=postgresql+psycopg://${NAZO_ROLE}:${NAZO_PASSWORD}@${PG_HOST}:${PG_PORT}/${NAZO_DB}"
