#!/usr/bin/env bash
set -euo pipefail

# ─── OSF Database Backup ──────────────────────────────────────────────────────
# Usage: ./scripts/backup.sh
# Env vars: DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD, BACKUP_DIR, BACKUP_RETAIN_DAYS
#
# Creates timestamped pg_dump backups with rotation.
# Designed for cron: 0 2 * * * /opt/osf-v8/scripts/backup.sh >> /var/log/osf-backup.log 2>&1

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-osf_admin}"
DB_NAME="${DB_NAME:-osf}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/osf}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Is)] Starting backup: ${DB_NAME}@${DB_HOST}:${DB_PORT}"

export PGPASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"

pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --username="${DB_USER}" \
  --dbname="${DB_NAME}" \
  --format=custom \
  --compress=6 \
  --verbose \
  --file="${BACKUP_FILE}" 2>&1

FILESIZE=$(stat -f%z "${BACKUP_FILE}" 2>/dev/null || stat -c%s "${BACKUP_FILE}" 2>/dev/null || echo "?")
echo "[$(date -Is)] Backup complete: ${BACKUP_FILE} (${FILESIZE} bytes)"

# Rotate old backups
DELETED=$(find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -mtime +"${BACKUP_RETAIN_DAYS}" -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  echo "[$(date -Is)] Rotated ${DELETED} backups older than ${BACKUP_RETAIN_DAYS} days"
fi

# Verify backup is readable
if pg_restore --list "${BACKUP_FILE}" > /dev/null 2>&1; then
  echo "[$(date -Is)] Backup verified OK"
else
  echo "[$(date -Is)] WARNING: Backup verification failed!" >&2
  exit 1
fi

echo "[$(date -Is)] Done. Backups in ${BACKUP_DIR}:"
ls -lht "${BACKUP_DIR}/${DB_NAME}_"*.sql.gz 2>/dev/null | head -5
