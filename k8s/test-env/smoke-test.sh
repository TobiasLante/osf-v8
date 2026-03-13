#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# smoke-test.sh — Automated health check for OSF v9 test environment on .110
#
# Usage:
#   ./smoke-test.sh              # run from .110 directly
#   ssh tlante@192.168.178.110 /opt/osf-v8/k8s/test-env/smoke-test.sh
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HOST="${TEST_HOST:-192.168.178.110}"
GW="http://${HOST}:8012"
PASS=0
FAIL=0
WARN=0

green()  { printf "\033[32m✓ %-40s %s\033[0m\n" "$1" "$2"; PASS=$((PASS+1)); }
red()    { printf "\033[31m✗ %-40s %s\033[0m\n" "$1" "$2"; FAIL=$((FAIL+1)); }
yellow() { printf "\033[33m⚠ %-40s %s\033[0m\n" "$1" "$2"; WARN=$((WARN+1)); }

check_http() {
  local label="$1" url="$2" expect="${3:-200}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 10 "$url" 2>/dev/null)
  if [ "$code" = "$expect" ]; then
    green "$label" "HTTP $code"
  else
    red "$label" "HTTP $code (expected $expect)"
  fi
}

check_json_field() {
  local label="$1" url="$2" field="$3" expect="$4" auth="${5:-}"
  local headers=(-H 'Content-Type: application/json')
  [ -n "$auth" ] && headers+=(-H "Authorization: Bearer $auth")
  local val
  val=$(curl -s --connect-timeout 3 --max-time 10 "${headers[@]}" "$url" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d${field})" 2>/dev/null)
  if [ "$val" = "$expect" ]; then
    green "$label" "$val"
  else
    red "$label" "got '$val' (expected '$expect')"
  fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  OSF v9 Smoke Test — ${HOST}"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── 1. Docker containers ─────────────────────────────────────────────────────
echo "── Docker Containers ──"
COMPOSE_DIR="/opt/osf-v8/k8s/test-env"
if [ -f "${COMPOSE_DIR}/docker-compose.yml" ]; then
  for SVC in postgres gateway frontend chat-ui historian governance-agent; do
    STATUS=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" ps --format json 2>/dev/null \
      | python3 -c "
import sys, json
for line in sys.stdin:
    d = json.loads(line)
    if '${SVC}' in d.get('Name','') or '${SVC}' in d.get('Service',''):
        print(d.get('State','unknown'))
        break
" 2>/dev/null)
    if [ "$STATUS" = "running" ]; then
      green "Container: ${SVC}" "running"
    elif [ -n "$STATUS" ]; then
      red "Container: ${SVC}" "$STATUS"
    else
      red "Container: ${SVC}" "not found"
    fi
  done
else
  yellow "Docker Compose" "not found at ${COMPOSE_DIR} — skipping container checks"
fi
echo ""

# ─── 2. Service health endpoints ──────────────────────────────────────────────
echo "── Service Health ──"
check_http "Gateway /health" "${GW}/health"
check_http "Historian /health" "http://${HOST}:8030/health"
check_http "Governance Agent /health" "http://${HOST}:8031/health"
check_http "Frontend (nginx)" "http://${HOST}:3001/"
check_http "Chat UI (nginx)" "http://${HOST}:8080/"
echo ""

# ─── 3. Login ─────────────────────────────────────────────────────────────────
echo "── Authentication ──"
LOGIN_JSON='{"email":"admin@test.local","password":"Test1234!"}'
LOGIN_RESP=$(curl -s --connect-timeout 3 --max-time 10 -X POST \
  "${GW}/auth/login" -H 'Content-Type: application/json' \
  --data-binary "$LOGIN_JSON" 2>/dev/null)
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -n "$TOKEN" ] && [ ${#TOKEN} -gt 50 ]; then
  green "Admin login" "token OK (${#TOKEN} chars)"
else
  red "Admin login" "failed — ${LOGIN_RESP:0:80}"
  echo ""
  echo "Cannot continue without auth token."
  echo "Result: PASS=$PASS FAIL=$FAIL WARN=$WARN"
  exit 1
fi
echo ""

# ─── 4. Admin endpoints ───────────────────────────────────────────────────────
echo "── Admin API ──"
AUTH=(-H "Authorization: Bearer $TOKEN")

# Roles
ROLE_COUNT=$(curl -s "${AUTH[@]}" "${GW}/admin/roles" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('roles',d if isinstance(d,list) else [])))" 2>/dev/null)
[ "$ROLE_COUNT" -ge 5 ] 2>/dev/null && green "Factory Roles" "${ROLE_COUNT} roles" || red "Factory Roles" "${ROLE_COUNT:-0} roles (expected >=5)"

# Tool Categories
CAT_COUNT=$(curl -s "${AUTH[@]}" "${GW}/admin/tool-categories" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('categories',d if isinstance(d,list) else [])))" 2>/dev/null)
[ "$CAT_COUNT" -ge 10 ] 2>/dev/null && green "Tool Categories" "${CAT_COUNT} categories" || red "Tool Categories" "${CAT_COUNT:-0} categories (expected >=10)"

# MCP Servers
MCP_DATA=$(curl -s "${AUTH[@]}" "${GW}/admin/mcp-servers" 2>/dev/null)
MCP_COUNT=$(echo "$MCP_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('servers',d if isinstance(d,list) else [])))" 2>/dev/null)
MCP_ONLINE=$(echo "$MCP_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for s in d.get('servers',[]) if s.get('status')=='online'))" 2>/dev/null)
[ "$MCP_COUNT" -ge 1 ] 2>/dev/null && green "MCP Servers" "${MCP_COUNT} registered, ${MCP_ONLINE} online" || red "MCP Servers" "${MCP_COUNT:-0} (expected >=1)"

# Users
USER_COUNT=$(curl -s "${AUTH[@]}" "${GW}/admin/users" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total', len(d.get('users',[]))))" 2>/dev/null)
[ "$USER_COUNT" -ge 1 ] 2>/dev/null && green "Users" "${USER_COUNT} users" || red "Users" "${USER_COUNT:-0} (expected >=1)"

# Admin Stats (need auth header)
for EP in stats health connectivity; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 10 "${AUTH[@]}" "${GW}/admin/${EP}" 2>/dev/null)
  [ "$CODE" = "200" ] && green "Admin ${EP}" "HTTP 200" || red "Admin ${EP}" "HTTP $CODE"
done

# Agents Status
AGENT_DATA=$(curl -s "${AUTH[@]}" "${GW}/admin/agents/status" 2>/dev/null)
AGENT_COUNT=$(echo "$AGENT_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('agents',[])))" 2>/dev/null)
[ "$AGENT_COUNT" -ge 1 ] 2>/dev/null && green "Agent Status" "${AGENT_COUNT} agents" || yellow "Agent Status" "${AGENT_COUNT:-0} agents"

# Dashboard Snapshot
check_http "Dashboard Snapshot" "${GW}/admin/dashboard/snapshot" 200
echo ""

# ─── 5. v9 Features ───────────────────────────────────────────────────────────
echo "── v9 Features ──"

# API Versioning
V1_HEADER=$(curl -sI -X GET "${GW}/v1/health" 2>/dev/null | grep -i "x-api-version" | tr -d '\r')
if echo "$V1_HEADER" | grep -qi "v1"; then
  green "API Versioning /v1/" "$V1_HEADER"
else
  red "API Versioning /v1/" "X-API-Version header missing"
fi

# Audit Export CSV
AUDIT_CSV=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" \
  "${GW}/admin/audit/export?from=$(date -d '7 days ago' '+%Y-%m-%d')&to=$(date '+%Y-%m-%d')&format=csv" 2>/dev/null)
[ "$AUDIT_CSV" = "200" ] && green "Audit Export (CSV)" "HTTP 200" || red "Audit Export (CSV)" "HTTP $AUDIT_CSV"

# Audit Export JSON
AUDIT_JSON=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" \
  "${GW}/admin/audit/export?from=$(date -d '7 days ago' '+%Y-%m-%d')&to=$(date '+%Y-%m-%d')&format=json" 2>/dev/null)
[ "$AUDIT_JSON" = "200" ] && green "Audit Export (JSON)" "HTTP 200" || red "Audit Export (JSON)" "HTTP $AUDIT_JSON"
echo ""

# ─── 6. External connectivity (K8s NodePorts) ─────────────────────────────────
echo "── External Services (K8s NodePorts) ──"
check_http "MCP ERP (30438)" "http://192.168.178.150:30438/health"
check_http "MCP UNS (31972)" "http://192.168.178.150:31972/health"

# MQTT check (just TCP connect)
if timeout 2 bash -c "echo > /dev/tcp/192.168.178.150/31883" 2>/dev/null; then
  green "MQTT Broker (31883)" "TCP reachable"
else
  red "MQTT Broker (31883)" "TCP unreachable"
fi

# Factory DB
if timeout 2 bash -c "echo > /dev/tcp/192.168.178.150/30432" 2>/dev/null; then
  green "Factory DB (30432)" "TCP reachable"
else
  red "Factory DB (30432)" "TCP unreachable"
fi
echo ""

# ─── 7. Historian deep check ──────────────────────────────────────────────────
echo "── Historian ──"
HIST_DATA=$(curl -s --connect-timeout 3 "http://${HOST}:8030/health" 2>/dev/null)
MQTT_OK=$(echo "$HIST_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['mqtt']['connected'])" 2>/dev/null)
INSERTED=$(echo "$HIST_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['flush']['inserted'])" 2>/dev/null)
RECEIVED=$(echo "$HIST_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['mqtt']['received'])" 2>/dev/null)

[ "$MQTT_OK" = "True" ] && green "Historian MQTT" "connected" || red "Historian MQTT" "disconnected"
[ "${INSERTED:-0}" -gt 0 ] 2>/dev/null && green "Historian DB writes" "${INSERTED} rows inserted" || yellow "Historian DB writes" "0 rows"
[ "${RECEIVED:-0}" -gt 0 ] 2>/dev/null && green "Historian MQTT msgs" "${RECEIVED} received" || yellow "Historian MQTT msgs" "0 received"
echo ""

# ─── 8. CORS check ────────────────────────────────────────────────────────────
echo "── CORS ──"
CORS_HEADER=$(curl -sI -X OPTIONS "${GW}/auth/login" \
  -H "Origin: http://${HOST}:3001" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" 2>/dev/null \
  | grep -i "access-control-allow-origin" | tr -d '\r')
if echo "$CORS_HEADER" | grep -q "${HOST}"; then
  green "CORS (Frontend :3001)" "$CORS_HEADER"
else
  red "CORS (Frontend :3001)" "missing or wrong origin — ${CORS_HEADER:-none}"
fi

CORS_8080=$(curl -sI -X OPTIONS "${GW}/auth/login" \
  -H "Origin: http://${HOST}:8080" \
  -H "Access-Control-Request-Method: POST" 2>/dev/null \
  | grep -i "access-control-allow-origin" | tr -d '\r')
if echo "$CORS_8080" | grep -q "${HOST}"; then
  green "CORS (Chat UI :8080)" "OK"
else
  red "CORS (Chat UI :8080)" "missing — ${CORS_8080:-none}"
fi
echo ""

# ─── Summary ──────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
printf "  Result: \033[32m%d passed\033[0m" "$PASS"
[ "$FAIL" -gt 0 ] && printf ", \033[31m%d failed\033[0m" "$FAIL"
[ "$WARN" -gt 0 ] && printf ", \033[33m%d warnings\033[0m" "$WARN"
echo ""
echo "═══════════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
