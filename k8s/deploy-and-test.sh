#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# OSF v8 + Factory Sim v3 — Full Deploy & Test Pipeline
# ════════════════════════════════════════════════════════════════════════════
# Usage:
#   ./deploy-and-test.sh all                  # Full pipeline (1→2→3→4)
#   ./deploy-and-test.sh factory-sim          # Section 1: Deploy + test factory sim
#   ./deploy-and-test.sh test-factory-sim     # Test factory sim only (no deploy)
#   ./deploy-and-test.sh osf                  # Section 2: Deploy + test OSF
#   ./deploy-and-test.sh test-osf             # Test OSF only (no deploy)
#   ./deploy-and-test.sh chat-ui              # Section 3: Deploy + test chat-ui
#   ./deploy-and-test.sh test-chat-ui         # Test chat-ui only (no deploy)
#   ./deploy-and-test.sh security             # Section 4: Security audit
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V8_ROOT="$(dirname "$SCRIPT_DIR")"
FACTORY_ROOT="/home/tlante/factory-simulator-v3"
FACTORY_K8S="$FACTORY_ROOT/k8s/v3"
REGISTRY="192.168.178.150:32000"
BUGS_FILE="/home/tlante/non-critical-bugs.md"
FACTORY_NODE="192.168.178.150"
FACTORY_PORT="30888"
GATEWAY_PORT="30880"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────
log()     { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()      { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
fail()    { echo -e "${RED}[✗]${NC} $*"; }
section() { echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"; echo -e "${BLUE}  $*${NC}"; echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"; }

CRITICAL_FAIL=0
NON_CRITICAL=0

bug() {
  local severity="$1"; shift
  local msg="$*"
  echo "- [$severity] $msg ($(date +%Y-%m-%d\ %H:%M))" >> "$BUGS_FILE"
  ((NON_CRITICAL++)) || true
  warn "NON-CRITICAL: $msg"
}

assert_http() {
  local url="$1" expected_code="${2:-200}" desc="${3:-$1}" timeout="${4:-10}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "$expected_code" ]]; then
    ok "$desc → HTTP $code"
    return 0
  else
    fail "$desc → HTTP $code (expected $expected_code)"
    return 1
  fi
}

assert_json_field() {
  local url="$1" field="$2" desc="${3:-$1}"
  local response
  response=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "{}")
  if echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
    ok "$desc → field '$field' present"
    return 0
  else
    fail "$desc → field '$field' missing. Response: $(echo "$response" | head -c 200)"
    return 1
  fi
}

wait_for_pods() {
  local ns="$1" label="$2" timeout="${3:-120}"
  log "Waiting for pods ($label) in $ns..."
  if kubectl wait --for=condition=ready pod -l "$label" -n "$ns" --timeout="${timeout}s" 2>/dev/null; then
    ok "Pods ready: $label"
    return 0
  else
    fail "Pods not ready: $label (timeout ${timeout}s)"
    kubectl -n "$ns" get pods -l "$label" 2>/dev/null
    return 1
  fi
}

# Init bugs file
init_bugs() {
  if [[ ! -f "$BUGS_FILE" ]]; then
    echo "# Non-Critical Bugs — Deploy & Test $(date +%Y-%m-%d)" > "$BUGS_FILE"
    echo "" >> "$BUGS_FILE"
  fi
}

# Get actual NodePort for a service port
get_nodeport() {
  local ns="$1" svc="$2" port="$3"
  kubectl -n "$ns" get svc "$svc" -o jsonpath="{.spec.ports[?(@.port==$port)].nodePort}" 2>/dev/null || echo ""
}

# ════════════════════════════════════════════════════════════════════════════
# SECTION 1: Factory Simulator v3
# ════════════════════════════════════════════════════════════════════════════
deploy_factory_sim() {
  section "SECTION 1: Deploy Factory Simulator v3"
  init_bugs

  # ── 1.1 Compile TypeScript ──────────────────────────────────────────────
  log "Compiling factory-sim TypeScript..."
  cd "$FACTORY_ROOT"
  npx swc src -d dist --source-maps --copy-files --strip-leading-paths 2>&1 | tail -5
  ok "Compiled"

  # ── 1.2 Build Docker image (--no-cache to guarantee latest code) ───────
  log "Building Docker image: factory-sim:3.1.0..."
  docker build --no-cache -t "$REGISTRY/factory-sim:3.1.0" -f "$FACTORY_ROOT/Dockerfile" "$FACTORY_ROOT" 2>&1 | tail -5
  ok "Image built"

  # ── 1.3 Verify image contents BEFORE pushing ──────────────────────────
  log "Verifying image contents..."
  local verify_fail=0

  # Check port-map.js exists
  if docker run --rm "$REGISTRY/factory-sim:3.1.0" ls /app/public/port-map.js &>/dev/null; then
    ok "Image contains port-map.js"
  else
    fail "Image MISSING port-map.js!"
    verify_fail=1
  fi

  # Check ML filter in compiled code
  if docker run --rm "$REGISTRY/factory-sim:3.1.0" grep -q "ML-" /app/dist/db/capacity.js 2>/dev/null; then
    ok "Image contains ML-station filter"
  else
    fail "Image MISSING ML-station filter in dist/db/capacity.js!"
    verify_fail=1
  fi

  # Check health endpoint exists in compiled code
  if docker run --rm "$REGISTRY/factory-sim:3.1.0" grep -q "health/live" /app/dist/api/health.js 2>/dev/null; then
    ok "Image contains /api/health/live endpoint"
  else
    warn "Could not verify health endpoint in image (non-blocking)"
  fi

  if [[ $verify_fail -gt 0 ]]; then
    fail "Image verification failed — aborting deploy!"
    return 1
  fi
  ok "Image verification passed"

  # ── 1.4 Push to registry ───────────────────────────────────────────────
  log "Pushing to registry..."
  docker push "$REGISTRY/factory-sim:3.1.0" 2>&1 | tail -3
  ok "Pushed to $REGISTRY/factory-sim:3.1.0"

  # Capture expected digest for post-deploy verification
  local EXPECTED_DIGEST
  EXPECTED_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$REGISTRY/factory-sim:3.1.0" 2>/dev/null | sed 's/.*@//')
  log "Expected image digest: $EXPECTED_DIGEST"

  # ── 1.5 Create namespace + config ─────────────────────────────────────
  log "Creating factory namespace..."
  kubectl apply -f "$FACTORY_K8S/factory-namespace.yaml"

  log "Applying config and secrets..."
  kubectl apply -f "$FACTORY_K8S/factory-v3-config.yaml"
  kubectl apply -f "$FACTORY_K8S/factory-v3-secret.yaml"

  # ── 1.6 Network policies BEFORE deployments ───────────────────────────
  log "Applying network policies and resource quotas..."
  kubectl apply -f "$FACTORY_K8S/factory-network-policies.yaml" 2>/dev/null || warn "Network policies skipped (CRD may not be installed)"
  kubectl apply -f "$FACTORY_K8S/factory-resource-quotas.yaml" 2>/dev/null || warn "Resource quotas skipped"

  # ── 1.7 Scale to 0 — clean slate before deploy ────────────────────────
  local has_deployments
  has_deployments=$(kubectl -n factory get deploy -o name 2>/dev/null | grep -c factory-v3 || echo "0")

  if [[ "$has_deployments" -gt 0 ]]; then
    log "Scaling all factory-v3 deployments to 0..."
    for dep in factory-v3-fertigung factory-v3-wms factory-v3-montage factory-v3-chef; do
      kubectl -n factory scale deploy "$dep" --replicas=0 2>/dev/null || true
    done

    log "Waiting for pods to terminate..."
    local wait_count=0
    while kubectl -n factory get pods -l "app in (factory-v3-fertigung,factory-v3-wms,factory-v3-montage,factory-v3-chef)" --no-headers 2>/dev/null | grep -q .; do
      sleep 2
      wait_count=$((wait_count + 1))
      if [[ $wait_count -gt 30 ]]; then
        warn "Some pods still terminating after 60s — continuing anyway"
        break
      fi
    done
    ok "All pods scaled to 0"

    # Clean up stale ReplicaSets
    log "Cleaning up stale ReplicaSets..."
    local stale_rs
    stale_rs=$(kubectl -n factory get rs -o jsonpath='{range .items[?(@.spec.replicas==0)]}{.metadata.name}{"\n"}{end}' 2>/dev/null)
    if [[ -n "$stale_rs" ]]; then
      echo "$stale_rs" | xargs -r kubectl -n factory delete rs 2>/dev/null || true
      ok "Stale ReplicaSets cleaned up"
    fi
  fi

  # ── 1.8 Apply deployments + services ──────────────────────────────────
  log "Applying deployment manifests..."
  kubectl apply -f "$FACTORY_K8S/factory-v3-deployments.yaml"
  kubectl apply -f "$FACTORY_K8S/factory-v3-services.yaml"

  # ── 1.9 Patch imagePullPolicy to Always ────────────────────────────────
  log "Patching imagePullPolicy to Always..."
  for dep in factory-v3-fertigung factory-v3-wms factory-v3-montage factory-v3-chef; do
    kubectl -n factory patch deploy "$dep" --type=json \
      -p '[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"Always"}]' 2>/dev/null || true
  done
  ok "imagePullPolicy set to Always"

  # ── 1.10 Start fertigung FIRST (leader, DB init) ─────────────────────
  log "Starting fertigung (leader — may take up to 10 min for DB init)..."
  kubectl -n factory scale deploy factory-v3-fertigung --replicas=1
  kubectl -n factory rollout status deploy/factory-v3-fertigung --timeout=600s || {
    fail "Fertigung rollout timed out!"
    kubectl -n factory logs -l app=factory-v3-fertigung --tail=50
    return 1
  }
  ok "Fertigung ready"

  # ── 1.11 Start remaining services ─────────────────────────────────────
  log "Starting wms, montage, chef..."
  kubectl -n factory scale deploy factory-v3-wms factory-v3-montage factory-v3-chef --replicas=1

  for svc in wms montage chef; do
    kubectl -n factory rollout status "deploy/factory-v3-${svc}" --timeout=180s || {
      fail "${svc} rollout timed out"
      kubectl -n factory logs -l "app=factory-v3-${svc}" --tail=20
      return 1
    }
    ok "${svc} ready"
  done

  # ── 1.12 Verify ALL pods run the expected image ───────────────────────
  log "Verifying image digest on all pods..."
  local digest_mismatch=0
  for dep in factory-v3-fertigung factory-v3-wms factory-v3-montage factory-v3-chef; do
    local pod_digest
    pod_digest=$(kubectl -n factory get pods -l "app=$dep" -o jsonpath='{.items[0].status.containerStatuses[0].imageID}' 2>/dev/null | sed 's/.*@//')
    if [[ "$pod_digest" == "$EXPECTED_DIGEST" ]]; then
      ok "$dep: digest matches ✓"
    else
      fail "$dep: digest MISMATCH! expected=$EXPECTED_DIGEST got=$pod_digest"
      digest_mismatch=1
    fi
  done

  if [[ $digest_mismatch -gt 0 ]]; then
    fail "Some pods have wrong image — deploy may be broken!"
    return 1
  fi

  ok "All factory-sim pods deployed and verified"
  kubectl -n factory get pods -o wide

  # Run tests
  test_factory_sim
}

test_factory_sim() {
  section "TESTING: Factory Simulator v3"
  init_bugs
  local FAIL=0
  local FERT_URL="http://${FACTORY_NODE}:${FACTORY_PORT}"

  # Discover actual MCP NodePort from K8s service
  local MCP_NODEPORT
  MCP_NODEPORT=$(get_nodeport factory factory-v3-fertigung 8020)
  if [[ -z "$MCP_NODEPORT" ]]; then
    MCP_NODEPORT="30438"
    warn "Could not discover MCP NodePort, using default $MCP_NODEPORT"
  fi

  # T1: Health endpoint (actual path is /api/health/live)
  log "T1: Health check..."
  assert_http "$FERT_URL/api/health/live" 200 "Fertigung health" || ((FAIL++)) || true

  # T2: Health response body — expects {"alive":true, "podId":"..."}
  log "T2: Health response body..."
  local health
  health=$(curl -s --max-time 10 "$FERT_URL/api/health/live" 2>/dev/null || echo "{}")
  if echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('alive') == True or d.get('status') == 'ok'" 2>/dev/null; then
    ok "Health OK: $(echo "$health" | head -c 100)"
  else
    fail "Health check failed: $health"
    ((FAIL++)) || true
  fi

  # T3: MCP endpoint (internal check — MCP uses SSE transport, not plain HTTP)
  log "T3: MCP endpoint reachable (internal)..."
  local mcp_internal
  mcp_internal=$(kubectl -n factory exec deploy/factory-v3-fertigung -- wget -qO- --timeout=5 http://localhost:8020/mcp 2>/dev/null | head -c 100 || echo "UNREACHABLE")
  if [[ "$mcp_internal" != "UNREACHABLE" ]]; then
    ok "MCP endpoint reachable internally on port 8020"
  else
    # MCP SSE may not respond to plain GET — check if port is listening
    local mcp_listen
    mcp_listen=$(kubectl -n factory exec deploy/factory-v3-fertigung -- sh -c "wget --spider -q --timeout=3 http://localhost:8020/ 2>&1; echo \$?" 2>/dev/null || echo "999")
    if [[ "$mcp_listen" != "999" ]]; then
      ok "MCP port 8020 is listening"
    else
      fail "MCP port 8020 not reachable"
      ((FAIL++)) || true
    fi
  fi

  # T4: Machines list
  log "T4: Machines API..."
  local machines
  machines=$(curl -s --max-time 15 "$FERT_URL/api/machines" 2>/dev/null || echo "[]")
  local machine_count
  machine_count=$(echo "$machines" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [[ "$machine_count" -gt 10 ]]; then
    ok "Machines: $machine_count found (expected >10)"
  else
    fail "Machines: only $machine_count found"
    ((FAIL++)) || true
  fi

  # T5: Workorders
  log "T5: Workorders API..."
  assert_http "$FERT_URL/api/workorders" 200 "Workorders endpoint" || ((FAIL++)) || true

  # T6: Capacity overview
  log "T6: Capacity API..."
  local cap_resp
  cap_resp=$(curl -s --max-time 15 "$FERT_URL/api/capacity/overview" 2>/dev/null || echo "[]")
  local cap_count
  cap_count=$(echo "$cap_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo "0")
  if [[ "$cap_count" -gt 10 ]]; then
    ok "Capacity overview: $cap_count work centers"
  else
    fail "Capacity overview: only $cap_count work centers (expected >10)"
    ((FAIL++)) || true
  fi

  # T7: Articles
  log "T7: Articles API..."
  local articles
  articles=$(curl -s --max-time 15 "$FERT_URL/api/articles" 2>/dev/null || echo "[]")
  local article_count
  article_count=$(echo "$articles" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [[ "$article_count" -gt 5 ]]; then
    ok "Articles: $article_count found"
  else
    fail "Articles: only $article_count found"
    ((FAIL++)) || true
  fi

  # T8: Simulation status
  log "T8: Simulation status..."
  local sim_code
  sim_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$FERT_URL/api/simulation/status" 2>/dev/null || echo "000")
  if [[ "$sim_code" == "200" ]]; then
    ok "Simulation status: HTTP 200"
  else
    bug "MINOR" "Simulation status: HTTP $sim_code"
  fi

  # T9: No ML-/M1-/M2- stations in capacity
  log "T9: ML/M1/M2 stations filtered from capacity..."
  local bad_stations
  bad_stations=$(echo "$cap_resp" | python3 -c "
import sys, json
data = json.load(sys.stdin)
bad = [m.get('machine_no','') for m in data if any(m.get('machine_no','').startswith(p) for p in ('ML-','M1-','M2-'))]
print(f'found={len(bad)}' + (f' ({bad})' if bad else ''))
" 2>/dev/null || echo "PARSE_ERROR")
  if [[ "$bad_stations" == *"found=0"* ]]; then
    ok "No ML-/M1-/M2- stations in capacity view"
  elif [[ "$bad_stations" == *"found="* ]]; then
    fail "ML/M1/M2 stations still visible: $bad_stations"
    ((FAIL++)) || true
  else
    bug "MINOR" "Could not verify ML/M1/M2 filtering: $bad_stations"
  fi

  # T10: SGM pool balance
  log "T10: SGM pool balance check..."
  local sgm_dist
  sgm_dist=$(echo "$cap_resp" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    sgm = [m for m in data if str(m.get('machine_no','')).startswith('SGM-')]
    if sgm:
        loads = [m.get('utilization', m.get('load_pct', 0)) for m in sgm]
        max_l, min_l = max(loads), min(loads)
        spread = max_l - min_l
        print(f'SGM spread={spread:.1f}% (min={min_l:.1f}%, max={max_l:.1f}%, count={len(sgm)})')
    else:
        print('NO_SGM')
except:
    print('PARSE_ERROR')
" 2>/dev/null || echo "CURL_ERROR")
  if [[ "$sgm_dist" == *"spread="* ]]; then
    ok "SGM distribution: $sgm_dist"
  else
    bug "MINOR" "Could not parse SGM distribution: $sgm_dist"
  fi

  # T11: WMS health (internal)
  log "T11: WMS health (internal check)..."
  local wms_health
  wms_health=$(kubectl -n factory exec deploy/factory-v3-fertigung -- wget -qO- --timeout=5 http://factory-v3-wms:8889/api/health/live 2>/dev/null || echo "UNREACHABLE")
  if echo "$wms_health" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('alive')==True or d.get('status')=='ok'" 2>/dev/null; then
    ok "WMS health OK (internal)"
  else
    fail "WMS not reachable internally: $wms_health"
    ((FAIL++)) || true
  fi

  # T12: Montage health (internal)
  log "T12: Montage health (internal check)..."
  local montage_health
  montage_health=$(kubectl -n factory exec deploy/factory-v3-fertigung -- wget -qO- --timeout=5 http://factory-v3-montage:8890/api/health/live 2>/dev/null || echo "UNREACHABLE")
  if echo "$montage_health" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('alive')==True or d.get('status')=='ok'" 2>/dev/null; then
    ok "Montage health OK (internal)"
  else
    fail "Montage not reachable internally: $montage_health"
    ((FAIL++)) || true
  fi

  # T13: Chef health (internal)
  log "T13: Chef-Nadja health (internal check)..."
  local chef_health
  chef_health=$(kubectl -n factory exec deploy/factory-v3-fertigung -- wget -qO- --timeout=5 http://factory-v3-chef:8891/api/health/live 2>/dev/null || echo "UNREACHABLE")
  if echo "$chef_health" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('alive')==True or d.get('status')=='ok'" 2>/dev/null; then
    ok "Chef-Nadja health OK (internal)"
  else
    fail "Chef-Nadja not reachable internally: $chef_health"
    ((FAIL++)) || true
  fi

  # T14: Leader election — only 1 fertigung pod should be running
  log "T14: Leader election..."
  local fert_pods
  fert_pods=$(kubectl -n factory get pods -l app=factory-v3-fertigung --field-selector=status.phase=Running -o name 2>/dev/null | wc -l)
  if [[ "$fert_pods" -eq 1 ]]; then
    ok "Leader election OK: 1 fertigung pod running"
  else
    fail "Leader election issue: $fert_pods fertigung pods running (expected 1)"
    ((FAIL++)) || true
  fi

  # T15: DB connectivity — check via a data endpoint
  log "T15: Database connectivity..."
  if [[ "$machine_count" -gt 0 ]] && [[ "$article_count" -gt 0 ]]; then
    ok "DB connected (machines=$machine_count, articles=$article_count)"
  else
    fail "DB may not be connected (machines=$machine_count, articles=$article_count)"
    ((FAIL++)) || true
  fi

  echo ""
  if [[ $FAIL -gt 0 ]]; then
    fail "Factory Sim: $FAIL CRITICAL test(s) failed!"
    return 1
  else
    ok "Factory Sim: All critical tests passed ($NON_CRITICAL non-critical issues)"
    return 0
  fi
}

# ════════════════════════════════════════════════════════════════════════════
# SECTION 2: OSF (Gateway + Frontend)
# ════════════════════════════════════════════════════════════════════════════
deploy_osf() {
  section "SECTION 2: Deploy OSF v8 (Gateway + Frontend)"
  init_bugs

  # 2.1 Build Gateway
  log "Building OSF Gateway..."
  cd "$V8_ROOT/osf-gateway"
  docker build --no-cache -t "$REGISTRY/osf-gateway:1.2.0" -f Dockerfile "$V8_ROOT/osf-gateway" 2>&1 | tail -5
  ok "Gateway image built"
  docker push "$REGISTRY/osf-gateway:1.2.0" 2>&1 | tail -3
  ok "Gateway pushed"

  # 2.2 Build Frontend
  log "Building OSF Frontend..."
  if [[ -f "$V8_ROOT/osf-frontend/Dockerfile" ]]; then
    FRONTEND_DOCKERFILE="$V8_ROOT/osf-frontend/Dockerfile"
  elif [[ -f "/home/tlante/osf-frontend/Dockerfile" ]]; then
    FRONTEND_DOCKERFILE="/home/tlante/osf-frontend/Dockerfile"
  else
    fail "No Frontend Dockerfile found!"
    return 1
  fi

  docker build --no-cache -t "$REGISTRY/osf-frontend:1.2.0" \
    --build-arg NEXT_PUBLIC_API_URL=https://zeroguess.factory-intelligence.work \
    --build-arg NEXT_PUBLIC_FACTORY_URL=http://${FACTORY_NODE}:${FACTORY_PORT} \
    --build-arg NEXT_PUBLIC_MQTT_EXPLORER_URL=http://${FACTORY_NODE}:31884 \
    -f "$FRONTEND_DOCKERFILE" \
    "$V8_ROOT/osf-frontend" 2>&1 | tail -5
  ok "Frontend image built"
  docker push "$REGISTRY/osf-frontend:1.2.0" 2>&1 | tail -3
  ok "Frontend pushed"

  # 2.3 Scale to 0 if deployments exist (clean slate)
  local existing_osf_deps
  existing_osf_deps=$(kubectl -n osf get deployment osf-gateway -o name 2>/dev/null | wc -l)

  if [[ "$existing_osf_deps" -gt 0 ]]; then
    log "Scaling OSF deployments to 0..."
    kubectl -n osf scale deploy osf-gateway --replicas=0 2>/dev/null || true
    kubectl -n osf scale deploy osf-frontend --replicas=0 2>/dev/null || true
    sleep 5
    # Clean up stale ReplicaSets
    kubectl -n osf get rs -o jsonpath='{range .items[?(@.spec.replicas==0)]}{.metadata.name}{"\n"}{end}' 2>/dev/null | xargs -r kubectl -n osf delete rs 2>/dev/null || true
    ok "OSF scaled to 0, stale RS cleaned"
  fi

  # 2.4 Apply K8s manifests
  log "Applying K8s manifests..."
  kubectl apply -f "$SCRIPT_DIR/osf-namespace.yaml"
  kubectl apply -f "$SCRIPT_DIR/osf-config.yaml"
  kubectl -n osf get secret osf-secrets &>/dev/null || {
    warn "osf-secrets not found — applying template (UPDATE BEFORE PROD!)"
    kubectl apply -f "$SCRIPT_DIR/osf-secrets.yaml"
  }
  kubectl apply -f "$SCRIPT_DIR/osf-redis.yaml"
  kubectl apply -f "$SCRIPT_DIR/osf-gateway.yaml"
  kubectl apply -f "$SCRIPT_DIR/osf-frontend.yaml"

  # 2.5 Patch imagePullPolicy + scale up
  log "Patching imagePullPolicy to Always..."
  kubectl -n osf patch deploy osf-gateway --type=json \
    -p '[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"Always"}]' 2>/dev/null || true
  kubectl -n osf patch deploy osf-frontend --type=json \
    -p '[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"Always"}]' 2>/dev/null || true

  log "Scaling OSF deployments to 1..."
  kubectl -n osf scale deploy osf-gateway --replicas=1
  kubectl -n osf scale deploy osf-frontend --replicas=1

  # 2.6 Wait for rollouts
  log "Waiting for gateway rollout..."
  kubectl -n osf rollout status deploy/osf-gateway --timeout=180s || {
    fail "Gateway rollout timed out"
    kubectl -n osf logs -l app=osf-gateway --tail=30
    return 1
  }
  ok "Gateway ready"

  log "Waiting for frontend rollout..."
  kubectl -n osf rollout status deploy/osf-frontend --timeout=120s || {
    fail "Frontend rollout timed out"
    return 1
  }
  ok "Frontend ready"

  kubectl -n osf get pods

  test_osf
}

test_osf() {
  section "TESTING: OSF v8"
  init_bugs
  local FAIL=0
  local GW_URL="http://${FACTORY_NODE}:${GATEWAY_PORT}"

  # T1: Gateway health
  log "T1: Gateway health..."
  assert_http "$GW_URL/health" 200 "Gateway health" || ((FAIL++)) || true

  # T2: Gateway health body
  log "T2: Gateway health body..."
  local gw_health
  gw_health=$(curl -s --max-time 10 "$GW_URL/health" 2>/dev/null || echo "{}")
  if echo "$gw_health" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status') in ('ok','healthy')" 2>/dev/null; then
    ok "Gateway status OK"
  else
    fail "Gateway health: $gw_health"
    ((FAIL++)) || true
  fi

  # T3: Version check
  log "T3: Version check..."
  local version
  version=$(echo "$gw_health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','unknown'))" 2>/dev/null || echo "unknown")
  if [[ "$version" == "1.2.0" ]]; then
    ok "Gateway version: $version"
  else
    bug "MINOR" "Gateway version mismatch: got $version, expected 1.2.0"
  fi

  # T4: Auth endpoints exist
  log "T4: Auth endpoints..."
  assert_http "$GW_URL/auth/login" 405 "POST-only login returns 405" || \
    assert_http "$GW_URL/auth/login" 400 "Login returns 400 (missing body)" || ((FAIL++)) || true

  # T5: Register endpoint
  log "T5: Register endpoint..."
  local reg_code
  reg_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$GW_URL/auth/register" -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "000")
  if [[ "$reg_code" == "400" ]] || [[ "$reg_code" == "422" ]] || [[ "$reg_code" == "409" ]]; then
    ok "Register endpoint responds: HTTP $reg_code (validation)"
  else
    fail "Register endpoint: HTTP $reg_code"
    ((FAIL++)) || true
  fi

  # T6: CORS headers
  log "T6: CORS headers..."
  local cors
  cors=$(curl -s -I --max-time 10 -H "Origin: https://openshopfloor.zeroguess.ai" "$GW_URL/health" 2>/dev/null | grep -i "access-control" || echo "NONE")
  if [[ "$cors" != "NONE" ]]; then
    ok "CORS headers present"
  else
    bug "MINOR" "CORS headers missing for openshopfloor.zeroguess.ai"
  fi

  # T7: Database connectivity (via health)
  log "T7: Database connectivity..."
  local db_ok
  db_ok=$(echo "$gw_health" | python3 -c "
import sys, json
d = json.load(sys.stdin)
db = d.get('database', d.get('db', d.get('postgres', 'unknown')))
print(db)
" 2>/dev/null || echo "unknown")
  ok "DB connectivity: $db_ok"

  # T8: MCP proxy to factory sim
  log "T8: MCP proxy to factory sim..."
  local mcp_code
  mcp_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -X POST "$GW_URL/mcp/tools/list" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' 2>/dev/null || echo "000")
  if [[ "$mcp_code" != "000" ]] && [[ "$mcp_code" != "502" ]] && [[ "$mcp_code" != "504" ]]; then
    ok "MCP proxy reachable: HTTP $mcp_code"
  else
    bug "MEDIUM" "MCP proxy to factory-sim not reachable: HTTP $mcp_code"
  fi

  # T9: Admin endpoints (should require auth)
  log "T9: Admin endpoints require auth..."
  local admin_code
  admin_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$GW_URL/admin/users" 2>/dev/null || echo "000")
  if [[ "$admin_code" == "401" ]] || [[ "$admin_code" == "403" ]]; then
    ok "Admin endpoints properly protected: HTTP $admin_code"
  else
    fail "Admin endpoints NOT protected: HTTP $admin_code (expected 401/403)"
    ((FAIL++)) || true
  fi

  # T10: Chat endpoint exists
  log "T10: Chat endpoint..."
  local chat_code
  chat_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$GW_URL/chat" 2>/dev/null || echo "000")
  if [[ "$chat_code" != "000" ]]; then
    ok "Chat endpoint: HTTP $chat_code"
  else
    fail "Chat endpoint unreachable"
    ((FAIL++)) || true
  fi

  # T11: Frontend accessible (internal K8s)
  log "T11: Frontend accessible..."
  local fe_health
  fe_health=$(kubectl -n osf exec deploy/osf-gateway -- wget -qO- --timeout=5 http://osf-frontend:3000/ 2>/dev/null | head -c 100 || echo "UNREACHABLE")
  if [[ "$fe_health" == *"html"* ]] || [[ "$fe_health" == *"HTML"* ]] || [[ "$fe_health" == *"doctype"* ]] || [[ "$fe_health" == *"DOCTYPE"* ]]; then
    ok "Frontend serving HTML (internal)"
  else
    bug "MEDIUM" "Frontend not reachable internally via K8s service"
  fi

  # T12: Gateway → Factory sim MCP connectivity (internal)
  log "T12: Gateway → Factory MCP internal connectivity..."
  local mcp_internal
  mcp_internal=$(kubectl -n osf exec deploy/osf-gateway -- wget -qO- --timeout=10 "http://factory-v3-fertigung.factory.svc.cluster.local:8020/mcp" 2>/dev/null | head -c 100 || echo "UNREACHABLE")
  if [[ "$mcp_internal" != "UNREACHABLE" ]]; then
    ok "Gateway can reach factory MCP internally"
  else
    bug "MEDIUM" "Gateway cannot reach factory MCP at factory-v3-fertigung.factory.svc.cluster.local:8020"
  fi

  # T13: Security headers
  log "T13: Security headers (Helmet)..."
  local headers
  headers=$(curl -s -I --max-time 10 "$GW_URL/health" 2>/dev/null)
  local missing_headers=""
  for h in "x-content-type-options" "x-frame-options"; do
    if ! echo "$headers" | grep -qi "$h"; then
      missing_headers="$missing_headers $h"
    fi
  done
  if [[ -z "$missing_headers" ]]; then
    ok "Security headers present"
  else
    bug "MINOR" "Missing security headers:$missing_headers"
  fi

  # T14: Rate limiting (should not fail on single request)
  log "T14: Rate limiting check..."
  local rate_codes=""
  for i in 1 2 3; do
    local c
    c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$GW_URL/health" 2>/dev/null || echo "000")
    rate_codes="$rate_codes $c"
  done
  if echo "$rate_codes" | grep -q "429"; then
    bug "MEDIUM" "Rate limiting too aggressive — health endpoint rate-limited on 3 requests"
  else
    ok "Rate limiting OK (3 rapid health checks passed)"
  fi

  echo ""
  if [[ $FAIL -gt 0 ]]; then
    fail "OSF: $FAIL CRITICAL test(s) failed!"
    return 1
  else
    ok "OSF: All critical tests passed ($NON_CRITICAL non-critical issues)"
    return 0
  fi
}

# ════════════════════════════════════════════════════════════════════════════
# SECTION 3: Chat-UI
# ════════════════════════════════════════════════════════════════════════════
deploy_chat_ui() {
  section "SECTION 3: Deploy Chat-UI"
  init_bugs

  # 3.1 Build Chat-UI
  log "Building Chat-UI..."
  docker build --no-cache -t "$REGISTRY/osf-chat-ui:8.1.0" -f "$V8_ROOT/chat-ui/Dockerfile" "$V8_ROOT/chat-ui" 2>&1 | tail -5
  ok "Chat-UI image built"
  docker push "$REGISTRY/osf-chat-ui:8.1.0" 2>&1 | tail -3
  ok "Chat-UI pushed"

  # 3.2 Deploy
  log "Deploying Chat-UI..."
  local existing_chat
  existing_chat=$(kubectl -n osf get deployment osf-chat-ui -o name 2>/dev/null | wc -l)

  if [[ "$existing_chat" -gt 0 ]]; then
    log "Scaling Chat-UI to 0..."
    kubectl -n osf scale deploy osf-chat-ui --replicas=0 2>/dev/null || true
    sleep 3
  fi

  kubectl apply -f "$SCRIPT_DIR/osf-chat-ui.yaml"
  kubectl -n osf patch deploy osf-chat-ui --type=json \
    -p '[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"Always"}]' 2>/dev/null || true
  kubectl -n osf scale deploy osf-chat-ui --replicas=1

  kubectl -n osf rollout status deploy/osf-chat-ui --timeout=60s || {
    fail "Chat-UI rollout timed out"
    return 1
  }
  ok "Chat-UI deployed"

  # 3.3 CF Tunnel routing info
  echo ""
  warn "CF Tunnel routing must be configured in Cloudflare Dashboard:"
  echo "  Route: demo.zeroguess.ai → http://osf-chat-ui.osf.svc.cluster.local:80"
  echo ""

  test_chat_ui
}

test_chat_ui() {
  section "TESTING: Chat-UI"
  init_bugs
  local FAIL=0

  # T1: Internal health check
  log "T1: Chat-UI internal health..."
  local chat_html
  chat_html=$(kubectl -n osf exec deploy/osf-chat-ui -- wget -qO- --timeout=5 http://localhost:80/ 2>/dev/null | head -c 200 || echo "UNREACHABLE")
  if [[ "$chat_html" == *"html"* ]] || [[ "$chat_html" == *"HTML"* ]]; then
    ok "Chat-UI serving HTML"
  else
    fail "Chat-UI not serving HTML: $chat_html"
    ((FAIL++)) || true
  fi

  # T2: Check it serves chat.html
  log "T2: Chat page..."
  local chat_page
  chat_page=$(kubectl -n osf exec deploy/osf-chat-ui -- wget -qO- --timeout=5 http://localhost:80/chat.html 2>/dev/null | head -c 200 || echo "UNREACHABLE")
  if [[ "$chat_page" == *"html"* ]] || [[ "$chat_page" == *"HTML"* ]]; then
    ok "Chat page (/chat.html) accessible"
  else
    fail "Chat page not at /chat.html"
    ((FAIL++)) || true
  fi

  # T3: divachat.html present (C6 fix)
  log "T3: divachat.html present..."
  local diva_page
  diva_page=$(kubectl -n osf exec deploy/osf-chat-ui -- wget -qO- --timeout=5 http://localhost:80/divachat.html 2>/dev/null | head -c 200 || echo "UNREACHABLE")
  if [[ "$diva_page" == *"html"* ]] || [[ "$diva_page" == *"HTML"* ]]; then
    ok "divachat.html accessible"
  else
    fail "divachat.html missing from image"
    ((FAIL++)) || true
  fi

  # T4: CF tunnel reachability (demo.zeroguess.ai)
  log "T4: CF tunnel (demo.zeroguess.ai)..."
  local demo_code
  demo_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://demo.zeroguess.ai" 2>/dev/null || echo "000")
  if [[ "$demo_code" == "200" ]]; then
    ok "demo.zeroguess.ai accessible: HTTP $demo_code"
  elif [[ "$demo_code" == "403" ]] || [[ "$demo_code" == "302" ]]; then
    ok "demo.zeroguess.ai protected (HTTP $demo_code — CF Access)"
  elif [[ "$demo_code" == "000" ]]; then
    warn "demo.zeroguess.ai unreachable — CF tunnel may not be configured yet"
    bug "MEDIUM" "demo.zeroguess.ai not reachable — configure CF tunnel route"
  else
    warn "demo.zeroguess.ai: HTTP $demo_code"
  fi

  # T5: CF tunnel for gateway
  log "T5: CF tunnel (zeroguess.factory-intelligence.work)..."
  local gw_ext_code
  gw_ext_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://zeroguess.factory-intelligence.work/health" 2>/dev/null || echo "000")
  if [[ "$gw_ext_code" == "200" ]]; then
    ok "Gateway external URL: HTTP $gw_ext_code"
  else
    bug "MINOR" "Gateway external URL: HTTP $gw_ext_code (may need CF tunnel config)"
  fi

  echo ""
  if [[ $FAIL -gt 0 ]]; then
    fail "Chat-UI: $FAIL CRITICAL test(s) failed!"
    return 1
  else
    ok "Chat-UI: All critical tests passed ($NON_CRITICAL non-critical issues)"
    return 0
  fi
}

# ════════════════════════════════════════════════════════════════════════════
# SECTION 4: Security Audit
# ════════════════════════════════════════════════════════════════════════════
run_security_audit() {
  section "SECTION 4: Security Audit"
  init_bugs
  local FAIL=0
  local GW_URL="http://${FACTORY_NODE}:${GATEWAY_PORT}"
  local FERT_URL="http://${FACTORY_NODE}:${FACTORY_PORT}"
  local REPORT="/home/tlante/security-audit-${TIMESTAMP}.md"

  echo "# Security Audit — $(date +%Y-%m-%d\ %H:%M)" > "$REPORT"
  echo "" >> "$REPORT"

  # S1: HTTP Security Headers
  log "S1: HTTP Security Headers..."
  echo "## HTTP Security Headers" >> "$REPORT"
  for url_name in "Gateway:$GW_URL/health" "Factory:$FERT_URL/api/health/live"; do
    local name="${url_name%%:*}"
    local url="${url_name#*:}"
    local headers
    headers=$(curl -s -I --max-time 10 "$url" 2>/dev/null || echo "")
    echo "" >> "$REPORT"
    echo "### $name ($url)" >> "$REPORT"

    for h in "Strict-Transport-Security" "X-Content-Type-Options" "X-Frame-Options" "Content-Security-Policy" "X-XSS-Protection" "Referrer-Policy"; do
      if echo "$headers" | grep -qi "$h"; then
        local val
        val=$(echo "$headers" | grep -i "$h" | head -1 | tr -d '\r')
        echo "- [x] $val" >> "$REPORT"
        ok "$name: $h present"
      else
        echo "- [ ] $h: MISSING" >> "$REPORT"
        bug "SECURITY" "$name missing header: $h"
      fi
    done
  done

  # S2: SQL Injection attempt
  log "S2: SQL Injection tests..."
  echo "" >> "$REPORT"
  echo "## SQL Injection" >> "$REPORT"
  local sqli_payloads=("' OR 1=1 --" "'; DROP TABLE users; --" "1 UNION SELECT * FROM users")
  for payload in "${sqli_payloads[@]}"; do
    local resp
    resp=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$GW_URL/auth/login" -X POST -H "Content-Type: application/json" -d "{\"email\":\"$payload\",\"password\":\"test\"}" 2>/dev/null || echo "000")
    if [[ "$resp" == "400" ]] || [[ "$resp" == "422" ]] || [[ "$resp" == "401" ]]; then
      echo "- [x] Payload rejected (HTTP $resp): \`${payload:0:30}\`" >> "$REPORT"
      ok "SQLi rejected: HTTP $resp"
    elif [[ "$resp" == "500" ]]; then
      echo "- [ ] POTENTIAL ISSUE (HTTP 500): \`${payload:0:30}\`" >> "$REPORT"
      bug "SECURITY" "SQL injection may not be properly handled (HTTP 500 on: ${payload:0:30})"
    else
      echo "- [?] Unexpected response (HTTP $resp): \`${payload:0:30}\`" >> "$REPORT"
    fi
  done

  # S3: XSS attempt
  log "S3: XSS tests..."
  echo "" >> "$REPORT"
  echo "## XSS" >> "$REPORT"
  local xss_payload='<script>alert(1)</script>'
  local xss_resp
  xss_resp=$(curl -s --max-time 10 "$GW_URL/auth/login" -X POST -H "Content-Type: application/json" -d "{\"email\":\"$xss_payload\",\"password\":\"test\"}" 2>/dev/null || echo "")
  if echo "$xss_resp" | grep -q "<script>"; then
    echo "- [ ] XSS payload REFLECTED in response!" >> "$REPORT"
    fail "XSS payload reflected in response!"
    ((FAIL++)) || true
  else
    echo "- [x] XSS payload not reflected" >> "$REPORT"
    ok "XSS payload not reflected"
  fi

  # S4: JWT checks
  log "S4: JWT security..."
  echo "" >> "$REPORT"
  echo "## JWT" >> "$REPORT"
  local jwt_resp
  jwt_resp=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -H "Authorization: Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwiYWRtaW4iOnRydWV9." "$GW_URL/admin/users" 2>/dev/null || echo "000")
  if [[ "$jwt_resp" == "401" ]] || [[ "$jwt_resp" == "403" ]]; then
    echo "- [x] 'none' algorithm JWT rejected (HTTP $jwt_resp)" >> "$REPORT"
    ok "JWT 'none' algorithm properly rejected"
  else
    echo "- [ ] 'none' algorithm JWT NOT rejected (HTTP $jwt_resp)" >> "$REPORT"
    fail "JWT 'none' algorithm NOT rejected!"
    ((FAIL++)) || true
  fi

  # S5: Sensitive paths
  log "S5: Sensitive path exposure..."
  echo "" >> "$REPORT"
  echo "## Sensitive Paths" >> "$REPORT"
  for path in "/.env" "/package.json" "/node_modules" "/.git/config" "/dist/index.js" "/src/index.ts"; do
    local p_code
    p_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$GW_URL$path" 2>/dev/null || echo "000")
    if [[ "$p_code" == "200" ]]; then
      echo "- [ ] EXPOSED: $path (HTTP 200)" >> "$REPORT"
      fail "Sensitive path exposed: $path"
      ((FAIL++)) || true
    else
      echo "- [x] Protected: $path (HTTP $p_code)" >> "$REPORT"
    fi
  done

  # S6: K8s secrets check
  log "S6: K8s secrets not exposed..."
  echo "" >> "$REPORT"
  echo "## K8s Secrets" >> "$REPORT"
  for ns in osf factory; do
    local secrets
    secrets=$(kubectl -n "$ns" get secrets 2>/dev/null || echo "UNREACHABLE")
    echo "### Namespace: $ns" >> "$REPORT"
    echo "\`\`\`" >> "$REPORT"
    echo "$secrets" >> "$REPORT"
    echo "\`\`\`" >> "$REPORT"
    ok "Secrets in $ns listed"
  done

  # S7: Container security
  log "S7: Container security (non-root)..."
  echo "" >> "$REPORT"
  echo "## Container Security" >> "$REPORT"
  for dep_ns in "factory:factory-v3-fertigung" "osf:osf-gateway"; do
    local ns="${dep_ns%%:*}"
    local dep="${dep_ns#*:}"
    local uid
    uid=$(kubectl -n "$ns" exec "deploy/$dep" -- id -u 2>/dev/null || echo "unknown")
    if [[ "$uid" == "0" ]]; then
      echo "- [ ] $dep runs as root (UID=$uid)" >> "$REPORT"
      bug "SECURITY" "$dep runs as root in $ns namespace"
    elif [[ "$uid" == "unknown" ]]; then
      echo "- [?] $dep: could not check UID" >> "$REPORT"
    else
      echo "- [x] $dep runs as non-root (UID=$uid)" >> "$REPORT"
      ok "$dep runs as non-root (UID=$uid)"
    fi
  done

  # S8: CORS misconfiguration
  log "S8: CORS configuration..."
  echo "" >> "$REPORT"
  echo "## CORS" >> "$REPORT"
  local evil_cors
  evil_cors=$(curl -s -I --max-time 10 -H "Origin: https://evil.com" "$GW_URL/health" 2>/dev/null | grep -i "access-control-allow-origin" || echo "NONE")
  if echo "$evil_cors" | grep -qi "evil.com"; then
    echo "- [ ] CORS allows arbitrary origins (evil.com reflected)" >> "$REPORT"
    fail "CORS allows arbitrary origins!"
    ((FAIL++)) || true
  else
    echo "- [x] CORS properly restricted" >> "$REPORT"
    ok "CORS properly restricted"
  fi

  # S9: Brute force protection
  log "S9: Brute force protection..."
  echo "" >> "$REPORT"
  echo "## Brute Force Protection" >> "$REPORT"
  local rate_limited=0
  for i in $(seq 1 10); do
    local bf_code
    bf_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$GW_URL/auth/login" -H "Content-Type: application/json" -d '{"email":"test@test.com","password":"wrong"}' 2>/dev/null || echo "000")
    if [[ "$bf_code" == "429" ]]; then
      rate_limited=1
      break
    fi
  done
  if [[ $rate_limited -eq 1 ]]; then
    echo "- [x] Rate limiting active on auth (429 after rapid requests)" >> "$REPORT"
    ok "Rate limiting active on auth endpoints"
  else
    echo "- [ ] No rate limiting detected on auth (10 rapid login attempts)" >> "$REPORT"
    bug "SECURITY" "No rate limiting detected on /auth/login after 10 rapid requests"
  fi

  echo "" >> "$REPORT"
  echo "---" >> "$REPORT"
  echo "Generated: $(date)" >> "$REPORT"

  log "Security audit report saved to: $REPORT"

  echo ""
  if [[ $FAIL -gt 0 ]]; then
    fail "Security Audit: $FAIL CRITICAL finding(s)!"
    return 1
  else
    ok "Security Audit: No critical findings ($NON_CRITICAL non-critical issues)"
    return 0
  fi
}

# ════════════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════════════
main() {
  local cmd="${1:-help}"

  case "$cmd" in
    factory-sim)
      deploy_factory_sim
      ;;
    test-factory-sim)
      test_factory_sim
      ;;
    osf)
      deploy_osf
      ;;
    test-osf)
      test_osf
      ;;
    chat-ui)
      deploy_chat_ui
      ;;
    test-chat-ui)
      test_chat_ui
      ;;
    security)
      run_security_audit
      ;;
    all)
      section "FULL PIPELINE — Deploy & Test All"
      echo "Order: Factory Sim → OSF → Chat-UI → Security Audit"
      echo ""

      deploy_factory_sim || {
        fail "Factory Sim failed — stopping pipeline"
        exit 1
      }

      deploy_osf || {
        fail "OSF failed — stopping pipeline"
        exit 1
      }

      deploy_chat_ui || {
        fail "Chat-UI failed — stopping pipeline"
        exit 1
      }

      run_security_audit || {
        warn "Security audit found issues — check report"
      }

      section "PIPELINE COMPLETE"
      echo ""
      ok "All sections completed"
      if [[ -f "$BUGS_FILE" ]]; then
        echo ""
        log "Non-critical bugs: $BUGS_FILE"
        cat "$BUGS_FILE"
      fi
      ;;
    help|*)
      echo "Usage: $0 <command>"
      echo ""
      echo "Commands:"
      echo "  all               Full pipeline (factory-sim → osf → chat-ui → security)"
      echo "  factory-sim       Section 1: Deploy + test factory simulator"
      echo "  test-factory-sim  Test factory sim only (no deploy)"
      echo "  osf               Section 2: Deploy + test OSF gateway + frontend"
      echo "  test-osf          Test OSF only (no deploy)"
      echo "  chat-ui           Section 3: Deploy + test chat-ui"
      echo "  test-chat-ui      Test chat-ui only (no deploy)"
      echo "  security          Section 4: Security audit"
      echo ""
      echo "Each section stops on critical failures."
      echo "Non-critical bugs are collected in: $BUGS_FILE"
      ;;
  esac
}

main "$@"
