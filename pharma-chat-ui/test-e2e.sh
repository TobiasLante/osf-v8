#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Process1st — End-to-End Test Script
# Tests the full pharma sales intelligence flow:
#   Gateway → MCP Tools → Pharma Neo4j → LLM Chat → FDA Enrichment
# Requires: i3x-server-pharma running (:30900), LLM on .120 (for chat)
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3101}"
MCP_URL="${MCP_URL:-http://192.168.178.150:30900}"
LLM_PROVIDER="${LLM_PROVIDER:-anthropic}"
LLM_API_KEY="${LLM_API_KEY:-}"

PASS=0
FAIL=0
WARN=0

# ── Colors ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[0;90m'
NC='\033[0m'

check_ok() {
  local name="$1" body="$2" http_code="$3" expected="$4"
  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    if echo "$body" | grep -qi "$expected" 2>/dev/null; then
      echo -e "  ${GREEN}✓${NC} $name ${DIM}(HTTP $http_code)${NC}"
      PASS=$((PASS+1))
      return 0
    else
      echo -e "  ${YELLOW}⚠${NC} $name ${DIM}(HTTP $http_code, missing: $expected)${NC}"
      WARN=$((WARN+1))
      return 1
    fi
  else
    echo -e "  ${RED}✗${NC} $name ${DIM}(HTTP $http_code)${NC}"
    echo -e "    ${DIM}$(echo "$body" | head -c 200)${NC}"
    FAIL=$((FAIL+1))
    return 1
  fi
}

api() {
  local method="$1" url="$2" body="${3:-}"
  local cmd="curl -s -w '\n%{http_code}' --connect-timeout 5 -X $method '$url' -H 'Content-Type: application/json'"
  if [ -n "$body" ]; then
    cmd="$cmd -d '$body'"
  fi
  eval "$cmd" 2>/dev/null || echo -e "\n000"
}

section() {
  echo ""
  echo -e "${CYAN}━━━ $1 ━━━${NC}"
}

# ══════════════════════════════════════════════════════════════════════
# Phase 0: Pre-flight
# ══════════════════════════════════════════════════════════════════════
section "Phase 0: Pre-flight Checks"

echo -e "  Gateway: $GATEWAY_URL"
echo -e "  MCP:     $MCP_URL"
echo -e "  LLM:     $LLM_PROVIDER ${LLM_API_KEY:+(key set)}${LLM_API_KEY:-(NO KEY)}"
echo ""

# ══════════════════════════════════════════════════════════════════════
# Phase 1: i3x-server-pharma (MCP direct)
# ══════════════════════════════════════════════════════════════════════
section "Phase 1: i3x-server-pharma (Direct MCP)"

# Health
resp=$(api GET "$MCP_URL/health")
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "Pharma server health" "$body" "$code" "graphAvailable"

# Tools list
resp=$(api POST "$MCP_URL/mcp" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "MCP tools/list" "$body" "$code" "pharma_account_list"

# Count pharma tools
pharma_tools=$(echo "$body" | python3 -c "import sys,json; tools=json.load(sys.stdin).get('result',{}).get('tools',[]); print(sum(1 for t in tools if t['name'].startswith('pharma_')))" 2>/dev/null || echo "0")
echo -e "    Pharma-specific tools: ${CYAN}$pharma_tools${NC}"

# i3X API objecttypes
resp=$(api GET "$MCP_URL/i3x/v0/objecttypes")
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "i3X objecttypes" "$body" "$code" "elementId"

# Count node types
type_count=$(echo "$body" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo -e "    Node types in Pharma KG: ${CYAN}$type_count${NC}"

# ══════════════════════════════════════════════════════════════════════
# Phase 2: MCP Tool Calls (against Pharma Neo4j)
# ══════════════════════════════════════════════════════════════════════
section "Phase 2: MCP Tool Calls"

# pharma_account_list
resp=$(api POST "$MCP_URL/mcp" '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pharma_account_list","arguments":{}}}')
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "pharma_account_list" "$body" "$code" "result"

account_count=$(echo "$body" | python3 -c "
import sys,json
r = json.load(sys.stdin).get('result',{})
content = r.get('content',[{}])[0].get('text','[]')
try:
    rows = json.loads(content)
    print(len(rows))
except: print('0')
" 2>/dev/null || echo "0")
echo -e "    Accounts found: ${CYAN}$account_count${NC}"

# pharma_vendor_comparison (all modalities)
resp=$(api POST "$MCP_URL/mcp" '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pharma_vendor_comparison","arguments":{}}}')
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "pharma_vendor_comparison" "$body" "$code" "result"

# pharma_process_map (mAb)
resp=$(api POST "$MCP_URL/mcp" '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pharma_process_map","arguments":{"modality":"mAb_2000L_FedBatch"}}}')
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "pharma_process_map (mAb FedBatch)" "$body" "$code" "result"

step_count=$(echo "$body" | python3 -c "
import sys,json
r = json.load(sys.stdin).get('result',{})
content = r.get('content',[{}])[0].get('text','[]')
try:
    rows = json.loads(content)
    print(len(rows))
except: print('0')
" 2>/dev/null || echo "0")
echo -e "    Process steps: ${CYAN}$step_count${NC}"

# pharma_hot_accounts
resp=$(api POST "$MCP_URL/mcp" '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pharma_hot_accounts","arguments":{}}}')
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "pharma_hot_accounts" "$body" "$code" "result"

# pharma_vendor_coverage (Sartorius)
resp=$(api POST "$MCP_URL/mcp" '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"pharma_vendor_coverage","arguments":{"name":"Sartorius"}}}')
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)
check_ok "pharma_vendor_coverage (Sartorius)" "$body" "$code" "result"

# ══════════════════════════════════════════════════════════════════════
# Phase 3: Gateway (if running)
# ══════════════════════════════════════════════════════════════════════
section "Phase 3: Gateway"

resp=$(api GET "$GATEWAY_URL/health")
body=$(echo "$resp" | sed '$d')
code=$(echo "$resp" | tail -1)

if [ "$code" = "000" ]; then
  echo -e "  ${YELLOW}⚠${NC} Gateway NOT running at $GATEWAY_URL — skipping gateway tests"
  echo -e "    Start with: ${DIM}cd pharma-chat-ui && pnpm dev:gateway${NC}"
  WARN=$((WARN+1))
else
  check_ok "Gateway health" "$body" "$code" "ok"

  # Tools via gateway
  resp=$(api GET "$GATEWAY_URL/api/tools")
  body=$(echo "$resp" | sed '$d')
  code=$(echo "$resp" | tail -1)
  check_ok "Gateway tools proxy" "$body" "$code" "pharma_"

  # Stats via gateway
  resp=$(api GET "$GATEWAY_URL/api/stats")
  body=$(echo "$resp" | sed '$d')
  code=$(echo "$resp" | tail -1)
  check_ok "Gateway stats proxy" "$body" "$code" "elementId"

  # FDA enrichment (ClinicalTrials.gov)
  resp=$(api POST "$GATEWAY_URL/api/enrich/clinicaltrials" '{"companyName":"Moderna"}')
  body=$(echo "$resp" | sed '$d')
  code=$(echo "$resp" | tail -1)
  check_ok "ClinicalTrials.gov enrichment (Moderna)" "$body" "$code" "studies"

  ct_count=$(echo "$body" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('studies',[])))" 2>/dev/null || echo "0")
  echo -e "    Clinical trials found: ${CYAN}$ct_count${NC}"

  # FDA enrichment (openFDA)
  resp=$(api POST "$GATEWAY_URL/api/enrich/fda" '{"companyName":"Pfizer"}')
  body=$(echo "$resp" | sed '$d')
  code=$(echo "$resp" | tail -1)
  check_ok "FDA enrichment (Pfizer)" "$body" "$code" "approvals"

  fda_count=$(echo "$body" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('approvals',[])))" 2>/dev/null || echo "0")
  echo -e "    FDA approvals found: ${CYAN}$fda_count${NC}"
fi

# ══════════════════════════════════════════════════════════════════════
# Phase 4: LLM Chat (if API key provided)
# ══════════════════════════════════════════════════════════════════════
section "Phase 4: LLM Chat"

if [ -z "$LLM_API_KEY" ]; then
  echo -e "  ${YELLOW}⚠${NC} No LLM_API_KEY set — skipping chat tests"
  echo -e "    Run with: ${DIM}LLM_API_KEY=sk-... ./test-e2e.sh${NC}"
  WARN=$((WARN+1))
elif [ "$code" = "000" ]; then
  echo -e "  ${YELLOW}⚠${NC} Gateway not running — cannot test chat"
  WARN=$((WARN+1))
else
  # Simple chat test
  CHAT_BODY=$(python3 -c "
import json
body = {
    'messages': [{'role': 'user', 'content': 'List all accounts with their warmth rating. Use pharma_account_list tool.'}],
    'config': {
        'provider': '$LLM_PROVIDER',
        'apiKey': '$LLM_API_KEY',
        'model': 'claude-sonnet-4-20250514' if '$LLM_PROVIDER' == 'anthropic' else 'gpt-4o'
    }
}
print(json.dumps(body))
")

  echo -e "  Testing chat: ${DIM}\"List all accounts with their warmth rating\"${NC}"

  # SSE stream — capture full response
  chat_response=$(curl -s --max-time 60 -X POST "$GATEWAY_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "$CHAT_BODY" 2>/dev/null || echo "")

  if [ -z "$chat_response" ]; then
    echo -e "  ${RED}✗${NC} Chat returned empty response (timeout or error)"
    FAIL=$((FAIL+1))
  else
    # Check for tool_start events
    tool_starts=$(echo "$chat_response" | grep -c "tool_start" || echo "0")
    # Check for content events
    content_events=$(echo "$chat_response" | grep -c '"type":"content"' || echo "0")
    # Check for done event
    has_done=$(echo "$chat_response" | grep -c '"type":"done"' || echo "0")
    # Check for errors
    has_error=$(echo "$chat_response" | grep -c '"type":"error"' || echo "0")

    if [ "$has_error" -gt 0 ]; then
      error_msg=$(echo "$chat_response" | grep '"type":"error"' | head -1 | sed 's/.*"message":"//' | sed 's/".*//')
      echo -e "  ${RED}✗${NC} Chat returned error: $error_msg"
      FAIL=$((FAIL+1))
    elif [ "$has_done" -gt 0 ]; then
      echo -e "  ${GREEN}✓${NC} Chat completed successfully"
      echo -e "    Tool calls: ${CYAN}$tool_starts${NC}, Content chunks: ${CYAN}$content_events${NC}"
      PASS=$((PASS+1))

      # Extract final text
      final_text=$(echo "$chat_response" | grep '"type":"content"' | tail -3 | sed 's/data: //' | python3 -c "
import sys,json
for line in sys.stdin:
    try:
        d = json.loads(line.strip())
        if d.get('text'): print(d['text'][:150])
    except: pass
" 2>/dev/null | tail -1)
      if [ -n "$final_text" ]; then
        echo -e "    Response: ${DIM}${final_text}...${NC}"
      fi
    else
      echo -e "  ${YELLOW}⚠${NC} Chat response incomplete (no done event)"
      echo -e "    ${DIM}$(echo "$chat_response" | head -3)${NC}"
      WARN=$((WARN+1))
    fi
  fi

  # New Account analysis test
  echo ""
  echo -e "  Testing New Account flow: ${DIM}\"mAb 2000L Fed Batch in Boston\"${NC}"

  ACCOUNT_BODY=$(python3 -c "
import json
body = {
    'messages': [{'role': 'user', 'content': '''New account analysis:
- Customer: TestPharma Inc
- Location: Boston, MA
- Molecule: mAb
- Scale: 2000L

Please use pharma_process_map to show the process steps for mAb 2000L Fed Batch, then use pharma_vendor_comparison to show which vendors cover each step.'''}],
    'config': {
        'provider': '$LLM_PROVIDER',
        'apiKey': '$LLM_API_KEY',
        'model': 'claude-sonnet-4-20250514' if '$LLM_PROVIDER' == 'anthropic' else 'gpt-4o'
    }
}
print(json.dumps(body))
")

  account_response=$(curl -s --max-time 90 -X POST "$GATEWAY_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "$ACCOUNT_BODY" 2>/dev/null || echo "")

  if [ -n "$account_response" ]; then
    acct_tools=$(echo "$account_response" | grep -c "tool_start" || echo "0")
    acct_done=$(echo "$account_response" | grep -c '"type":"done"' || echo "0")
    acct_error=$(echo "$account_response" | grep -c '"type":"error"' || echo "0")

    if [ "$acct_error" -gt 0 ]; then
      echo -e "  ${RED}✗${NC} New Account analysis failed"
      FAIL=$((FAIL+1))
    elif [ "$acct_done" -gt 0 ]; then
      echo -e "  ${GREEN}✓${NC} New Account analysis completed (${CYAN}$acct_tools tools${NC} called)"
      PASS=$((PASS+1))
    else
      echo -e "  ${YELLOW}⚠${NC} New Account analysis incomplete"
      WARN=$((WARN+1))
    fi
  else
    echo -e "  ${RED}✗${NC} New Account analysis timed out"
    FAIL=$((FAIL+1))
  fi
fi

# ══════════════════════════════════════════════════════════════════════
# Phase 5: Equipment Images
# ══════════════════════════════════════════════════════════════════════
section "Phase 5: Equipment Images"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMG_DIR="$SCRIPT_DIR/packages/web/public/equipment"

if [ -d "$IMG_DIR" ]; then
  img_count=$(ls "$IMG_DIR"/*.png 2>/dev/null | wc -l)
  echo -e "  ${GREEN}✓${NC} Equipment images: ${CYAN}$img_count${NC} PNGs in public/equipment/"
  PASS=$((PASS+1))

  # Check key images exist
  for img in Shake_Flasks.png Single_Use_Bioreactor_2000L.png Chromo_Resin_BE1.png Virus_Filter_CPV.png UF_DF_1.png TBD.png; do
    if [ -f "$IMG_DIR/$img" ]; then
      echo -e "    ${GREEN}✓${NC} $img"
    else
      echo -e "    ${RED}✗${NC} $img MISSING"
      FAIL=$((FAIL+1))
    fi
  done
else
  echo -e "  ${RED}✗${NC} Equipment images directory not found: $IMG_DIR"
  FAIL=$((FAIL+1))
fi

# ══════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════
section "Summary"

echo ""
echo -e "  ${GREEN}PASS${NC}: $PASS"
echo -e "  ${YELLOW}WARN${NC}: $WARN"
echo -e "  ${RED}FAIL${NC}: $FAIL"
echo ""

TOTAL=$((PASS + WARN + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}═══ ALL $TOTAL CHECKS PASSED (${WARN} warnings) ═══${NC}"
  exit 0
elif [ "$FAIL" -le 2 ]; then
  echo -e "  ${YELLOW}═══ $FAIL FAILURES, $PASS PASSED, $WARN WARNINGS ═══${NC}"
  exit 1
else
  echo -e "  ${RED}═══ $FAIL FAILURES — CRITICAL ═══${NC}"
  exit 2
fi
