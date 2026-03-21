#!/usr/bin/env bash
set -euo pipefail

# ─── OSF Database Backup ──────────────────────────────────────────────────────
# Usage: ./scripts/backup.sh
# Env vars: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, BACKUP_DIR, BACKUP_RETAIN_DAYS
#
# Backs up all OSF databases: osf, bigdata_homelab, erpdb, qmsdb, historian_db
# Also backs up Neo4j (Knowledge Graph) via neo4j-admin.
# Creates timestamped pg_dump backups with rotation.
# Designed for cron: 0 2 * * * /opt/osf-v8/scripts/backup.sh >> /var/log/osf-backup.log 2>&1

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-osf_admin}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/osf}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

# All databases to back up
DATABASES=("osf" "bigdata_homelab" "erpdb" "qmsdb" "historian_db")

# Neo4j config
NEO4J_HOST="${NEO4J_HOST:-192.168.178.154}"
NEO4J_CONTAINER="${NEO4J_CONTAINER:-neo4j}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "${BACKUP_DIR}"

export PGPASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"

TOTAL_FAIL=0

for DB_NAME in "${DATABASES[@]}"; do
  BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

  echo "[$(date -Is)] Starting backup: ${DB_NAME}@${DB_HOST}:${DB_PORT}"

  if ! pg_dump \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --dbname="${DB_NAME}" \
    --format=custom \
    --compress=6 \
    --verbose \
    --file="${BACKUP_FILE}" 2>&1; then
    echo "[$(date -Is)] ERROR: pg_dump failed for ${DB_NAME}" >&2
    ((TOTAL_FAIL++)) || true
    continue
  fi

  FILESIZE=$(stat -f%z "${BACKUP_FILE}" 2>/dev/null || stat -c%s "${BACKUP_FILE}" 2>/dev/null || echo "?")
  echo "[$(date -Is)] Backup complete: ${BACKUP_FILE} (${FILESIZE} bytes)"

  # Rotate old backups for this database
  DELETED=$(find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -mtime +"${BACKUP_RETAIN_DAYS}" -delete -print | wc -l)
  if [ "${DELETED}" -gt 0 ]; then
    echo "[$(date -Is)] Rotated ${DELETED} old backups for ${DB_NAME} (older than ${BACKUP_RETAIN_DAYS} days)"
  fi

  # Verify backup is readable
  if pg_restore --list "${BACKUP_FILE}" > /dev/null 2>&1; then
    echo "[$(date -Is)] Backup verified OK: ${DB_NAME}"
  else
    echo "[$(date -Is)] WARNING: Backup verification failed for ${DB_NAME}!" >&2
    ((TOTAL_FAIL++)) || true
  fi
done

# ─── Neo4j Backup ────────────────────────────────────────────────────────────
NEO4J_BACKUP_FILE="${BACKUP_DIR}/neo4j_${TIMESTAMP}.dump"
echo "[$(date -Is)] Starting Neo4j backup on ${NEO4J_HOST}..."

if ssh "${NEO4J_HOST}" "docker exec ${NEO4J_CONTAINER} neo4j-admin database dump neo4j --to-path=/tmp" 2>&1; then
  if scp "${NEO4J_HOST}:/tmp/neo4j.dump" "${NEO4J_BACKUP_FILE}" 2>&1; then
    ssh "${NEO4J_HOST}" "rm -f /tmp/neo4j.dump"
    FILESIZE=$(stat -c%s "${NEO4J_BACKUP_FILE}" 2>/dev/null || echo "?")
    echo "[$(date -Is)] Neo4j backup complete: ${NEO4J_BACKUP_FILE} (${FILESIZE} bytes)"

    # Rotate old Neo4j backups
    DELETED=$(find "${BACKUP_DIR}" -name "neo4j_*.dump" -mtime +"${BACKUP_RETAIN_DAYS}" -delete -print | wc -l)
    if [ "${DELETED}" -gt 0 ]; then
      echo "[$(date -Is)] Rotated ${DELETED} old Neo4j backups"
    fi
  else
    echo "[$(date -Is)] ERROR: Failed to copy Neo4j dump from ${NEO4J_HOST}" >&2
    ((TOTAL_FAIL++)) || true
  fi
else
  echo "[$(date -Is)] ERROR: Neo4j dump failed on ${NEO4J_HOST}" >&2
  ((TOTAL_FAIL++)) || true
fi

echo ""
echo "[$(date -Is)] Done. All backups in ${BACKUP_DIR}:"
ls -lht "${BACKUP_DIR}"/*_"${TIMESTAMP}".* 2>/dev/null

if [ "${TOTAL_FAIL}" -gt 0 ]; then
  echo "[$(date -Is)] WARNING: ${TOTAL_FAIL} database(s) had errors!" >&2
  exit 1
fi
