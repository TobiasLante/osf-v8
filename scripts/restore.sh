#!/usr/bin/env bash
set -euo pipefail

# ─── OSF Database Restore ─────────────────────────────────────────────────────
# Usage: ./scripts/restore.sh <backup_file>
# Env vars: DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD
#
# Restores from a pg_dump custom-format backup.
# WARNING: This drops and recreates the target database.

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lht "${BACKUP_DIR:-/var/backups/osf}/"*.sql.gz 2>/dev/null | head -10 || echo "  (none found)"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-osf_admin}"
DB_NAME="${DB_NAME:-osf}"

export PGPASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  WARNING: This will DROP and RECREATE database '${DB_NAME}'"
echo "║  Host: ${DB_HOST}:${DB_PORT}"
echo "║  Backup: ${BACKUP_FILE}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
read -p "Type 'yes' to confirm: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "[$(date -Is)] Verifying backup file..."
if ! pg_restore --list "${BACKUP_FILE}" > /dev/null 2>&1; then
  echo "ERROR: Backup file is corrupted or unreadable" >&2
  exit 1
fi

echo "[$(date -Is)] Terminating active connections to ${DB_NAME}..."
psql --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" --dbname="postgres" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  2>/dev/null || true

echo "[$(date -Is)] Dropping and recreating database ${DB_NAME}..."
psql --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" --dbname="postgres" -c \
  "DROP DATABASE IF EXISTS ${DB_NAME};"
psql --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" --dbname="postgres" -c \
  "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

echo "[$(date -Is)] Restoring from ${BACKUP_FILE}..."
pg_restore \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --username="${DB_USER}" \
  --dbname="${DB_NAME}" \
  --verbose \
  --no-owner \
  --no-privileges \
  "${BACKUP_FILE}" 2>&1

echo "[$(date -Is)] Restore complete. Verifying..."
TABLES=$(psql --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" --dbname="${DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "[$(date -Is)] Database has ${TABLES} tables."

echo "[$(date -Is)] Done. Restart the gateway to reconnect."
