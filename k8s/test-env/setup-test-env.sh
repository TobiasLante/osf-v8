#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# setup-test-env.sh — Prepare OSF v9 test environment for .110
#
# Run this on a machine with kubectl access (e.g., k8sserv1).
# It dumps the production DB, builds images, and packages everything
# for deployment on 192.168.178.110 via Docker Compose.
#
# Usage:
#   ./setup-test-env.sh              # full setup: dump + build + package
#   ./setup-test-env.sh --dump-only  # just dump DB (skip image build)
#   ./setup-test-env.sh --no-dump    # skip DB dump (images + package only)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGISTRY="192.168.178.150:32000"
TARGET_HOST="192.168.178.110"
TARGET_DIR="/opt/osf-test"
DUMP_FILE="${SCRIPT_DIR}/osf-seed.sql"

DO_DUMP=true
DO_BUILD=true

for arg in "$@"; do
  case "$arg" in
    --dump-only) DO_BUILD=false ;;
    --no-dump)   DO_DUMP=false ;;
  esac
done

echo "═══════════════════════════════════════════════════════════"
echo "  OSF v9 Test Environment Setup"
echo "  Target: ${TARGET_HOST}:${TARGET_DIR}"
echo "═══════════════════════════════════════════════════════════"

# ─── Phase 1: Dump production DB ─────────────────────────────────────────────
if [ "$DO_DUMP" = true ]; then
  echo ""
  echo "── Phase 1: Dumping production DB from K8s ──"

  # Find the osf-postgres pod
  PG_POD=$(kubectl get pods -n osf -l app=osf-postgres-new -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [ -z "$PG_POD" ]; then
    echo "ERROR: osf-postgres pod not found. Is kubectl configured?"
    exit 1
  fi
  echo "  Found postgres pod: ${PG_POD}"

  # Dump via kubectl exec (pod has pg_dump)
  echo "  Dumping osf database..."
  kubectl exec -n osf "$PG_POD" -- \
    pg_dump -U osf_admin -d osf \
      --no-owner --no-privileges --no-comments \
      --data-only \
      --exclude-table='nodered_*' \
      --exclude-table='flow_run_events' \
      --exclude-table='flow_pending_inputs' \
      --exclude-table='code_agent_runs' \
      --exclude-table='code_agent_storage' \
      --exclude-table='oauth_states' \
      --exclude-table='email_tokens' \
      --exclude-table='schema_version' \
    > "$DUMP_FILE"

  DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  echo "  Dump complete: ${DUMP_FILE} (${DUMP_SIZE})"

  # Count rows in key tables
  echo "  Row counts:"
  for TABLE in users agents mcp_servers factory_roles tool_categories; do
    COUNT=$(kubectl exec -n osf "$PG_POD" -- \
      psql -U osf_admin -d osf -t -c "SELECT COUNT(*) FROM ${TABLE}" 2>/dev/null | tr -d ' ' || echo "?")
    echo "    ${TABLE}: ${COUNT}"
  done
fi

# ─── Phase 2: Build and push images ──────────────────────────────────────────
if [ "$DO_BUILD" = true ]; then
  echo ""
  echo "── Phase 2: Building images ──"
  OSF_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

  # Gateway
  echo "  Building osf-gateway..."
  docker build -t "${REGISTRY}/osf-gateway:latest" \
    -f "${OSF_ROOT}/osf-gateway/Dockerfile" \
    "${OSF_ROOT}/osf-gateway" --quiet
  docker push "${REGISTRY}/osf-gateway:latest" 2>/dev/null

  # Frontend (Next.js — with .110 API URL baked in)
  echo "  Building osf-frontend-test (API_URL=http://${TARGET_HOST}:8012)..."
  docker build -t "${REGISTRY}/osf-frontend-test:latest" \
    --build-arg "NEXT_PUBLIC_API_URL=http://${TARGET_HOST}:8012" \
    -f "${SCRIPT_DIR}/Dockerfile.frontend" \
    "${OSF_ROOT}/osf-frontend" --quiet
  docker push "${REGISTRY}/osf-frontend-test:latest" 2>/dev/null

  # Chat UI
  if [ -f "${OSF_ROOT}/chat-ui/Dockerfile" ]; then
    echo "  Building osf-chat-ui..."
    docker build -t "${REGISTRY}/osf-chat-ui:latest" \
      -f "${OSF_ROOT}/chat-ui/Dockerfile" \
      "${OSF_ROOT}/chat-ui" --quiet
    docker push "${REGISTRY}/osf-chat-ui:latest" 2>/dev/null
  fi

  # Historian
  if [ -f "${OSF_ROOT}/historian/Dockerfile" ]; then
    echo "  Building osf-historian..."
    docker build -t "${REGISTRY}/osf-historian:2.0.0" \
      -f "${OSF_ROOT}/historian/Dockerfile" \
      "${OSF_ROOT}/historian" --quiet
    docker push "${REGISTRY}/osf-historian:2.0.0" 2>/dev/null
  fi

  # Governance Agent
  if [ -f "${OSF_ROOT}/governance-agent/Dockerfile" ]; then
    echo "  Building osf-governance-agent..."
    docker build -t "${REGISTRY}/osf-governance-agent:1.0.0" \
      -f "${OSF_ROOT}/governance-agent/Dockerfile" \
      "${OSF_ROOT}/governance-agent" --quiet
    docker push "${REGISTRY}/osf-governance-agent:1.0.0" 2>/dev/null
  fi

  echo "  All images built and pushed."
fi

# ─── Phase 3: Package for .110 ───────────────────────────────────────────────
echo ""
echo "── Phase 3: Packaging ──"

# Create the restore script
cat > "${SCRIPT_DIR}/restore-db.sh" << 'RESTORE_EOF'
#!/usr/bin/env bash
# restore-db.sh — Load seed data into local test Postgres
# Run AFTER docker compose up -d (postgres must be healthy)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DUMP_FILE="${SCRIPT_DIR}/osf-seed.sql"

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: ${DUMP_FILE} not found. Run setup-test-env.sh first."
  exit 1
fi

echo "Waiting for postgres to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U osf_admin -d osf >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Restoring seed data..."
# The gateway's initSchema() already created tables on first boot.
# We just need to load the data. Disable triggers during restore to avoid FK issues.
docker compose exec -T postgres psql -U osf_admin -d osf -c "SET session_replication_role = replica;" 2>/dev/null
docker compose exec -T postgres psql -U osf_admin -d osf < "$DUMP_FILE"
docker compose exec -T postgres psql -U osf_admin -d osf -c "SET session_replication_role = DEFAULT;" 2>/dev/null

# Verify
echo ""
echo "Verification:"
for TABLE in users agents mcp_servers factory_roles tool_categories audit_log; do
  COUNT=$(docker compose exec -T postgres psql -U osf_admin -d osf -t -c "SELECT COUNT(*) FROM ${TABLE}" 2>/dev/null | tr -d ' ' || echo "0")
  echo "  ${TABLE}: ${COUNT} rows"
done

echo ""
echo "Done! Test environment ready at http://192.168.178.110:8080 (Chat UI)"
echo "  Gateway API: http://192.168.178.110:8012"
echo "  Admin login: see .env (ADMIN_EMAIL / ADMIN_PASSWORD)"
RESTORE_EOF
chmod +x "${SCRIPT_DIR}/restore-db.sh"

# Create the sync script (one-way: prod -> test)
cat > "${SCRIPT_DIR}/sync-from-prod.sh" << 'SYNC_EOF'
#!/usr/bin/env bash
# sync-from-prod.sh — One-way sync: K8s prod DB → .110 test DB
# Run on a machine with kubectl access. Syncs selected tables.
# IMPORTANT: This TRUNCATES test data before inserting prod data.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Syncing production data to test environment..."

# Tables to sync (read-only reference data + users)
SYNC_TABLES="users agents agent_chains mcp_servers factory_roles tool_categories tool_classifications role_permissions user_roles news banner"

PG_POD=$(kubectl get pods -n osf -l app=osf-postgres-new -o jsonpath='{.items[0].metadata.name}')

for TABLE in $SYNC_TABLES; do
  echo -n "  ${TABLE}... "
  # Dump single table data
  kubectl exec -n osf "$PG_POD" -- \
    pg_dump -U osf_admin -d osf --data-only --table="$TABLE" --no-owner --no-privileges 2>/dev/null \
    > "/tmp/sync_${TABLE}.sql"

  # Truncate + restore on test
  docker compose exec -T postgres psql -U osf_admin -d osf -c "SET session_replication_role = replica; TRUNCATE ${TABLE} CASCADE;" 2>/dev/null
  docker compose exec -T postgres psql -U osf_admin -d osf < "/tmp/sync_${TABLE}.sql" 2>/dev/null
  docker compose exec -T postgres psql -U osf_admin -d osf -c "SET session_replication_role = DEFAULT;" 2>/dev/null

  COUNT=$(docker compose exec -T postgres psql -U osf_admin -d osf -t -c "SELECT COUNT(*) FROM ${TABLE}" 2>/dev/null | tr -d ' ')
  echo "${COUNT} rows"
  rm -f "/tmp/sync_${TABLE}.sql"
done

echo "Sync complete."
SYNC_EOF
chmod +x "${SCRIPT_DIR}/sync-from-prod.sh"

echo "  Created: restore-db.sh, sync-from-prod.sh"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Setup complete! Next steps:"
echo ""
echo "  1. Copy to .110:"
echo "     scp -r ${SCRIPT_DIR} ${TARGET_HOST}:${TARGET_DIR}"
echo ""
echo "  2. On .110 — first time:"
echo "     cd ${TARGET_DIR}"
echo "     cp .env.template .env"
echo "     docker compose up -d"
echo "     # Wait ~30s for gateway to init schema"
echo "     ./restore-db.sh"
echo ""
echo "  3. Access:"
echo "     Frontend:    http://${TARGET_HOST}:3000  (Next.js — alle v9 Pages)"
echo "     Chat UI:     http://${TARGET_HOST}:8080  (standalone Chat)"
echo "     Gateway API: http://${TARGET_HOST}:8012"
echo "     PG direct:   psql -h ${TARGET_HOST} -p 5433 -U osf_admin osf"
echo ""
echo "  4. Sync data later (from machine with kubectl):"
echo "     cd ${TARGET_DIR} && ./sync-from-prod.sh"
echo ""
echo "  Docker insecure registry (if not configured yet on .110):"
echo "     echo '{\"insecure-registries\":[\"192.168.178.150:32000\"]}' | sudo tee /etc/docker/daemon.json"
echo "     sudo systemctl restart docker"
echo "═══════════════════════════════════════════════════════════"
