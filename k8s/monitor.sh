#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# OSF Monitor — Runs all tests (no deploy), emails on failure
# ════════════════════════════════════════════════════════════════════════════
# Usage:
#   ./monitor.sh              # Run once, email on failure
#   ./monitor.sh --dry-run    # Run once, no email
#   crontab: 0 */2 * * * /opt/osf-v8/k8s/monitor.sh >> /home/tlante/monitor-logs/cron.log 2>&1
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V8_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .env
if [[ -f "$V8_ROOT/.env" ]]; then
  set -a; source "$V8_ROOT/.env"; set +a
fi

FACTORY_NODE="192.168.178.150"
FACTORY_PORT="30888"
GATEWAY_PORT="30880"
MQTT_PORT="31883"

FERT_URL="http://${FACTORY_NODE}:${FACTORY_PORT}"
GW_URL="http://${FACTORY_NODE}:${GATEWAY_PORT}"

LOG_DIR="/home/tlante/monitor-logs"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
LOGFILE="$LOG_DIR/monitor-${TIMESTAMP}.log"

# Email config
RESEND_API_KEY="re_cjRt6FCT_LbzSHYLxpau4mmFCDNEy4vbe"
EMAIL_FROM="OpenShopFloor Monitor <noreply@zeroguess.ai>"

# Fetch admin emails from osf DB (dynamic — never misses a new admin)
get_admin_emails() {
  kubectl -n osf exec deploy/osf-gateway -- node -e "
const {Pool}=require('pg');
const p=new Pool({host:'osf-postgres',port:5432,user:'osf_admin',password:process.env.DB_PASSWORD,database:'osf',max:1});
p.query(\"SELECT email FROM users WHERE role='admin'\").then(r=>{r.rows.forEach(x=>console.log(x.email));p.end()}).catch(()=>p.end());
" 2>/dev/null
}

ADMIN_EMAILS=""
load_admin_emails() {
  ADMIN_EMAILS=$(get_admin_emails | tr '\n' ',' | sed 's/,$//')
  if [[ -z "$ADMIN_EMAILS" ]]; then
    ADMIN_EMAILS="tobias.lante74@gmail.com"
    log "Could not fetch admin emails from DB, using fallback"
  else
    log "Admin emails: $ADMIN_EMAILS"
  fi
}

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ─── Helpers ──────────────────────────────────────────────────────────────

PASS=0
FAIL=0
WARN=0
FAILURES=""

log()  { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOGFILE"; }
ok()   { echo "[OK] $*" | tee -a "$LOGFILE"; ((PASS++)); }
warn() { echo "[!]  $*" | tee -a "$LOGFILE"; ((WARN++)); }
fail() { echo "[FAIL] $*" | tee -a "$LOGFILE"; ((FAIL++)); FAILURES="${FAILURES}\n- $*"; }

assert_http() {
  local url="$1" expected="${2:-200}" desc="${3:-$1}" timeout="${4:-10}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "$expected" ]]; then
    ok "$desc -> HTTP $code"
  else
    fail "$desc -> HTTP $code (expected $expected)"
  fi
}

assert_http_not() {
  local url="$1" bad_code="$2" desc="${3:-$1}" timeout="${4:-10}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null || echo "000")
  if [[ "$code" != "$bad_code" ]] && [[ "$code" != "000" ]]; then
    ok "$desc -> HTTP $code"
  else
    fail "$desc -> HTTP $code"
  fi
}

get_jwt() {
  node -e "const jwt=require('/opt/osf-v8/osf-gateway/node_modules/jsonwebtoken');console.log(jwt.sign({userId:'186da896-707e-4de4-a617-e6b3c6b90d34',email:'tobias.lante74@gmail.com',role:'admin'},'v7-production-jwt-secret-change-this',{expiresIn:'1h'}))" 2>/dev/null || echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# TESTS
# ═══════════════════════════════════════════════════════════════════════════

run_all_tests() {
  log "=== OSF Monitor Run — $(date) ==="
  log ""

  # ─── 1. Factory Sim ──────────────────────────────────────────────────
  log "--- Factory Simulator ---"

  assert_http "$FERT_URL/api/health/live" 200 "Factory health"

  # Machines count (slow endpoint — 30s timeout)
  local machines
  machines=$(curl -s --max-time 30 "$FERT_URL/api/machines" 2>/dev/null || echo "[]")
  local machine_count
  machine_count=$(echo "$machines" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [[ "$machine_count" -gt 10 ]]; then
    ok "Machines: $machine_count"
  else
    fail "Machines: only $machine_count (expected >10)"
  fi

  # Articles count
  local articles
  articles=$(curl -s --max-time 30 "$FERT_URL/api/articles" 2>/dev/null || echo "[]")
  local article_count
  article_count=$(echo "$articles" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [[ "$article_count" -gt 0 ]]; then
    ok "Articles: $article_count"
  else
    fail "Articles: 0 returned"
  fi

  # Workorders (can 500 if DB has issues — critical)
  local wo_code
  wo_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$FERT_URL/api/workorders" 2>/dev/null || echo "000")
  if [[ "$wo_code" == "200" ]]; then
    ok "Workorders: HTTP $wo_code"
  else
    fail "Workorders: HTTP $wo_code (DB issue?)"
  fi

  # Capacity overview
  local cap_code
  cap_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$FERT_URL/api/capacity/overview" 2>/dev/null || echo "000")
  if [[ "$cap_code" == "200" ]]; then
    local cap_count
    cap_count=$(curl -s --max-time 30 "$FERT_URL/api/capacity/overview" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo "0")
    ok "Capacity: $cap_count work centers"
  else
    fail "Capacity overview: HTTP $cap_code"
  fi

  # Partners
  local partners_code
  partners_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$FERT_URL/api/partners" 2>/dev/null || echo "000")
  if [[ "$partners_code" == "200" ]]; then
    ok "Partners: HTTP $partners_code"
  else
    fail "Partners: HTTP $partners_code"
  fi

  # Materials
  local materials_code
  materials_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$FERT_URL/api/materials" 2>/dev/null || echo "000")
  if [[ "$materials_code" == "200" ]]; then
    ok "Materials: HTTP $materials_code"
  else
    fail "Materials: HTTP $materials_code"
  fi

  # BOM + Suppliers (reliable endpoints)
  assert_http "$FERT_URL/api/bom" 200 "BOM" 15
  assert_http "$FERT_URL/api/suppliers" 200 "Suppliers" 15

  # Internal services (via kubectl)
  for svc_port in "factory-v3-wms:8889" "factory-v3-montage:8890" "factory-v3-chef:8891"; do
    local svc="${svc_port%%:*}"
    local port="${svc_port#*:}"
    local health
    health=$(kubectl -n factory exec deploy/factory-v3-fertigung -- wget -qO- --timeout=5 "http://${svc}:${port}/api/health/live" 2>/dev/null || echo "UNREACHABLE")
    if echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('alive')==True or d.get('status')=='ok'" 2>/dev/null; then
      ok "$svc health OK"
    else
      fail "$svc unreachable: $health"
    fi
  done

  # Pod count
  local fert_pods
  fert_pods=$(kubectl -n factory get pods -l app=factory-v3-fertigung --field-selector=status.phase=Running -o name 2>/dev/null | wc -l)
  if [[ "$fert_pods" -ge 1 ]]; then
    ok "Fertigung pods: $fert_pods running"
  else
    fail "Fertigung: 0 pods running!"
  fi

  log ""

  # ─── 2. Gateway ─────────────────────────────────────────────────────
  log "--- OSF Gateway ---"

  assert_http "$GW_URL/health" 200 "Gateway health"

  # Version
  local gw_health
  gw_health=$(curl -s --max-time 10 "$GW_URL/health" 2>/dev/null || echo "{}")
  local version
  version=$(echo "$gw_health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")
  log "Gateway version: $version"

  # Auth protection
  local auth_code
  auth_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$GW_URL/admin/users" 2>/dev/null || echo "000")
  if [[ "$auth_code" == "401" ]] || [[ "$auth_code" == "403" ]]; then
    ok "Admin endpoints protected: HTTP $auth_code"
  else
    fail "Admin endpoints NOT protected: HTTP $auth_code"
  fi

  # Chat completions requires auth
  local chat_code
  chat_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$GW_URL/chat/completions" -H "Content-Type: application/json" -d '{"message":"test"}' 2>/dev/null || echo "000")
  if [[ "$chat_code" == "401" ]]; then
    ok "Chat completions requires auth"
  else
    fail "Chat completions without auth: HTTP $chat_code"
  fi

  # Demo-UI
  assert_http "$GW_URL/demo-ui/chat.html" 200 "Demo chat.html"
  assert_http "$GW_URL/demo-ui/analysis.html" 200 "Analysis console"

  # Entities endpoint (new)
  local TOKEN
  TOKEN=$(get_jwt)
  if [[ -n "$TOKEN" ]]; then
    local entities_code
    entities_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -H "Authorization: Bearer $TOKEN" "$GW_URL/chat/entities" 2>/dev/null || echo "000")
    if [[ "$entities_code" == "200" ]]; then
      local entity_count
      entity_count=$(curl -s --max-time 15 -H "Authorization: Bearer $TOKEN" "$GW_URL/chat/entities" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('entities',[])))" 2>/dev/null || echo "0")
      ok "Entities endpoint: $entity_count entities"
    else
      warn "Entities endpoint: HTTP $entities_code (new endpoint, may not be deployed yet)"
    fi
  fi

  # MCP proxy
  local mcp_code
  mcp_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -X POST "$GW_URL/mcp/tools/list" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' 2>/dev/null || echo "000")
  if [[ "$mcp_code" != "000" ]] && [[ "$mcp_code" != "502" ]] && [[ "$mcp_code" != "504" ]]; then
    ok "MCP proxy: HTTP $mcp_code"
  else
    fail "MCP proxy unreachable: HTTP $mcp_code"
  fi

  # Gateway pods
  local gw_pods
  gw_pods=$(kubectl -n osf get pods -l app=osf-gateway --field-selector=status.phase=Running -o name 2>/dev/null | wc -l)
  if [[ "$gw_pods" -ge 1 ]]; then
    ok "Gateway pods: $gw_pods running"
  else
    fail "Gateway: 0 pods running!"
  fi

  log ""

  # ─── 3. External URLs (Cloudflare) ─────────────────────────────────
  log "--- External URLs ---"

  # Cloudflare Pages frontend
  local cf_pages_code
  cf_pages_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://openshopfloor.zeroguess.ai" 2>/dev/null || echo "000")
  if [[ "$cf_pages_code" == "200" ]]; then
    ok "Cloudflare Pages (openshopfloor.zeroguess.ai): HTTP $cf_pages_code"
  else
    fail "Cloudflare Pages unreachable: HTTP $cf_pages_code"
  fi

  # API tunnel
  local cf_api_code
  cf_api_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://osf-api.zeroguess.ai/health" 2>/dev/null || echo "000")
  if [[ "$cf_api_code" == "200" ]]; then
    ok "API tunnel (osf-api.zeroguess.ai): HTTP $cf_api_code"
  else
    fail "API tunnel unreachable: HTTP $cf_api_code"
  fi

  log ""

  # ─── 4. MQTT Broker ────────────────────────────────────────────────
  log "--- MQTT ---"

  # Check MQTT port is open
  if timeout 3 bash -c "echo > /dev/tcp/${FACTORY_NODE}/${MQTT_PORT}" 2>/dev/null; then
    ok "MQTT broker port $MQTT_PORT open"
  else
    fail "MQTT broker port $MQTT_PORT not reachable"
  fi

  log ""

  # ─── 5. Database ───────────────────────────────────────────────────
  log "--- Database ---"

  local db_check
  db_check=$(PGPASSWORD=Kohlgrub.123 psql -h "$FACTORY_NODE" -p 30432 -U admin -d bigdata_homelab -t -c "SELECT 'db_ok'" 2>/dev/null | tr -d ' \n' || echo "FAIL")
  if [[ "$db_check" == "db_ok" ]]; then
    ok "PostgreSQL reachable"
  else
    fail "PostgreSQL unreachable"
  fi

  # Check key schemas in bigdata_homelab
  for schema in llm_test_v3 public; do
    local schema_exists
    schema_exists=$(PGPASSWORD=Kohlgrub.123 psql -h "$FACTORY_NODE" -p 30432 -U admin -d bigdata_homelab -t -c "SELECT 1 FROM information_schema.schemata WHERE schema_name='$schema'" 2>/dev/null | tr -d ' \n' || echo "")
    if [[ "$schema_exists" == "1" ]]; then
      ok "Schema bigdata_homelab.$schema"
    else
      warn "Schema missing: bigdata_homelab.$schema"
    fi
  done

  # Check separate domain DBs are reachable
  for db_port in "erpdb:30431" "qmsdb:30433"; do
    local db="${db_port%%:*}"
    local port="${db_port#*:}"
    local db_ok
    db_ok=$(PGPASSWORD=Kohlgrub.123 psql -h "$FACTORY_NODE" -p "$port" -U admin -d "$db" -t -c "SELECT 'ok'" 2>/dev/null | tr -d ' \n' || echo "")
    if [[ "$db_ok" == "ok" ]]; then
      ok "DB $db (port $port) reachable"
    else
      fail "DB $db (port $port) unreachable"
    fi
  done

  log ""

  # ─── 6. Smoke Chat (quick) ────────────────────────────────────────
  log "--- Smoke Chat ---"

  if [[ -n "$TOKEN" ]]; then
    local smoke_resp
    smoke_resp=$(curl -s --max-time 90 \
      -X POST "https://osf-api.zeroguess.ai/chat/completions" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"message":"Wie viele Maschinen haben wir?","language":"de"}' \
      2>/dev/null || echo "")

    if echo "$smoke_resp" | grep -q '"type":"content"'; then
      ok "Smoke chat: got content response"
    elif echo "$smoke_resp" | grep -q '"type":"error"'; then
      local err_msg
      err_msg=$(echo "$smoke_resp" | grep '"type":"error"' | head -1 | sed 's/.*"message":"\([^"]*\)".*/\1/')
      fail "Smoke chat error: $err_msg"
    elif [[ -z "$smoke_resp" ]]; then
      fail "Smoke chat: no response (timeout)"
    else
      warn "Smoke chat: unexpected response format"
    fi
  else
    warn "Smoke chat skipped: could not generate JWT"
  fi

  log ""

  # ─── 7. K8s Pod Health ─────────────────────────────────────────────
  log "--- K8s Pods ---"

  # Check for CrashLoopBackOff or Error pods
  for ns in factory osf; do
    local bad_pods
    bad_pods=$(kubectl -n "$ns" get pods --no-headers 2>/dev/null | grep -E "CrashLoop|Error|ImagePull" || echo "")
    if [[ -n "$bad_pods" ]]; then
      fail "Bad pods in $ns:\n$bad_pods"
    else
      ok "All pods healthy in $ns"
    fi
  done

  # Cloudflared tunnel pod
  local cf_pod
  cf_pod=$(kubectl -n demo get pods -l app=cloudflared --field-selector=status.phase=Running -o name 2>/dev/null | wc -l)
  if [[ "$cf_pod" -ge 1 ]]; then
    ok "Cloudflared tunnel pod running"
  else
    fail "Cloudflared tunnel pod not running!"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# EMAIL NOTIFICATION
# ═══════════════════════════════════════════════════════════════════════════

send_failure_email() {
  local subject="[OSF Monitor] $FAIL failure(s) detected — $(date +%Y-%m-%d\ %H:%M)"

  local html="<div style=\"font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;\">
<h2 style=\"color: #ef4444;\">OSF Monitor Alert</h2>
<p style=\"color: #a0aec0;\"><strong>$FAIL</strong> failure(s), <strong>$WARN</strong> warning(s), <strong>$PASS</strong> passed</p>
<p style=\"color: #a0aec0;\">Time: $(date)</p>
<h3 style=\"color: #ef4444;\">Failures:</h3>
<div style=\"background: #1e1e2e; padding: 16px; border-radius: 8px; border-left: 4px solid #ef4444;\">
<pre style=\"color: #e2e8f0; font-size: 13px; margin: 0; white-space: pre-wrap;\">$(echo -e "$FAILURES")</pre>
</div>
<p style=\"color: #64748b; font-size: 12px; margin-top: 24px;\">Full log: $LOGFILE</p>
<p style=\"color: #64748b; font-size: 12px;\">Run manually: <code>/opt/osf-v8/k8s/monitor.sh --dry-run</code></p>
</div>"

  # Send to each admin
  IFS=',' read -ra EMAILS <<< "$ADMIN_EMAILS"
  for email in "${EMAILS[@]}"; do
    email=$(echo "$email" | tr -d ' ')
    [[ -z "$email" ]] && continue
    curl -s -X POST "https://api.resend.com/emails" \
      -H "Authorization: Bearer $RESEND_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c "
import json
print(json.dumps({
    'from': '$EMAIL_FROM',
    'to': '$email',
    'subject': '''$subject''',
    'html': '''$html'''
}))
")" >/dev/null 2>&1
    log "Alert email sent to $email"
  done
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

load_admin_emails
run_all_tests

log ""
log "=== Summary: $PASS passed, $FAIL failed, $WARN warnings ==="

if [[ $FAIL -gt 0 ]]; then
  log "FAILURES:$(echo -e "$FAILURES")"
  if [[ "$DRY_RUN" == "false" ]]; then
    send_failure_email
  else
    log "(dry-run: email skipped)"
  fi
  exit 1
else
  log "All checks passed."
  exit 0
fi
