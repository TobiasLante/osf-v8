#!/bin/bash
# Bug D Captain — daily diagnostic for the osf-v8 discussion-runner pipeline.
# Runs quality-optimize against the gateway, counts pipeline-phase events,
# greps gateway logs for specialist/critique parse failures, and appends
# a dated entry to /opt/osf-v8/bug-d-captain.md.
#
# Cron: 0 19 * * * /opt/osf-v8/scripts/bug-d-captain.sh

set -uo pipefail

LOG_FILE="/opt/osf-v8/bug-d-captain.md"
KUBECONFIG="/home/tlante/.kube/config"
GATEWAY="http://192.168.178.150:30880"
LLM_URL="http://192.168.178.120:5001"
SSE_OUT="/tmp/captain-run.sse"
NOW="$(date '+%Y-%m-%d %H:%M')"

# Ensure markdown file exists with heading
if [[ ! -f "$LOG_FILE" ]]; then
  echo "# Bug D Captain — Discussion-Pipeline Parse-Fail Tracker" > "$LOG_FILE"
  echo "" >> "$LOG_FILE"
fi

append() { echo "$1" >> "$LOG_FILE"; }

# 0. Pre-flight: LLM premium tier reachable?
if ! curl -sS -m 5 -o /dev/null -w '%{http_code}' "$LLM_URL/v1/models" 2>/dev/null | grep -q '^200$'; then
  append ""
  append "## $NOW"
  append "- skipped: LLM down ($LLM_URL not 200)"
  exit 0
fi

# 1. Mint 1h admin JWT inside gateway pod
POD="$(kubectl --kubeconfig=$KUBECONFIG get pods -n osf -l app=osf-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
if [[ -z "$POD" ]]; then
  append ""
  append "## $NOW"
  append "- skipped: no osf-gateway pod found"
  exit 0
fi

TOKEN="$(kubectl --kubeconfig=$KUBECONFIG exec -n osf "$POD" -- node -e \
  "const jwt=require('jsonwebtoken');console.log(jwt.sign({userId:'8e4b6c14-5846-4eab-8774-ad915bc8387e',email:'tobias.lante@ttpsc.com',tier:'premium',role:'admin'},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'1h'}))" 2>/dev/null)"

if [[ -z "$TOKEN" ]]; then
  append ""
  append "## $NOW"
  append "- skipped: JWT mint failed"
  exit 0
fi

# 2. Baseline: capture timestamp before run for log filtering
BASELINE_EPOCH=$(date +%s)

# 3. Run quality-optimize, 20-min timeout
START=$(date +%s)
curl -sS -N -m 1200 -X POST "$GATEWAY/api/agents/run/quality-optimize" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"userMessage":"Maschine: SGM-003","params":{"sessionId":"captain-d","language":"de","machineId":"SGM-003"}}' \
  > "$SSE_OUT" 2>&1
DURATION=$(($(date +%s) - START))
BYTES=$(wc -c < "$SSE_OUT" 2>/dev/null || echo 0)

# 4. Count SSE events
count_event() { grep -oE "\"type\":\"$1\"" "$SSE_OUT" 2>/dev/null | wc -l; }

SPEC_OK=$(count_event specialist_complete)
SPEC_ERR=$(count_event specialist_error)
QA=$(count_event discussion_answer)
QQ=$(count_event discussion_question)
CRIT=$(count_event debate_critique)
REPORT=$(count_event report_ready)
DONE=$(count_event done)

# 5. Pull gateway logs since baseline (use --since-time would need RFC3339; --since=25m is close enough)
LOGS=$(kubectl --kubeconfig=$KUBECONFIG logs -n osf -l app=osf-gateway --since=25m 2>/dev/null \
  | grep -E "parse failed after repair|Specialist failed|Critique failed" \
  | grep -v "PodManager")
PARSE_FAILS=$(echo "$LOGS" | grep -c "parse failed after repair" || true)
[[ -z "$PARSE_FAILS" ]] && PARSE_FAILS=0

# Extract distinct error positions
PATTERNS=$(echo "$LOGS" | grep -oE 'at position [0-9]+' | sort -u | tr '\n' ',' | sed 's/,$//')

# Extract first failing raw output snippet
FIRST_RAW=$(echo "$LOGS" | grep "parse failed after repair" | head -1 \
  | grep -oE '"raw":"[^"]{0,200}' | head -c 250 | sed 's/^"raw":"//')

# 6+7. Decide: green or detailed entry
GREEN_OK=true
[[ "$SPEC_OK" -ne 4 ]] && GREEN_OK=false
[[ "$SPEC_ERR" -ne 0 ]] && GREEN_OK=false
[[ "$QA" -ne 6 ]] && GREEN_OK=false
[[ "$QQ" -ne 6 ]] && GREEN_OK=false
[[ "$CRIT" -ne 6 ]] && GREEN_OK=false
[[ "$DONE" -ne 1 ]] && GREEN_OK=false
[[ "$PARSE_FAILS" -ne 0 ]] && GREEN_OK=false

append ""
if [[ "$GREEN_OK" == "true" ]]; then
  append "## $NOW — all green (${DURATION}s)"
else
  append "## $NOW"
  append "- run duration: ${DURATION}s | bytes: ${BYTES}"
  append "- specialists: ${SPEC_OK}/4 (errors: ${SPEC_ERR}) | Q&A: ${QA}/6 | critiques: ${CRIT}/6 | done: ${DONE}"
  append "- parse failures: ${PARSE_FAILS}"
  if [[ -n "$PATTERNS" ]]; then
    append "- error positions: ${PATTERNS}"
  fi
  if [[ -n "$FIRST_RAW" ]]; then
    append "- first failing raw (200c):"
    append '  ```'
    append "  $FIRST_RAW"
    append '  ```'
  fi
fi

# 8. Recurrence detection: same parse-fail pattern in 3 consecutive runs?
if [[ -n "$PATTERNS" ]]; then
  # Get patterns from last 3 entries (excluding the one we just wrote, so look at last 4)
  RECENT_PATTERNS=$(grep -oE 'error positions: [^$]+' "$LOG_FILE" | tail -3)
  RECENT_COUNT=$(echo "$RECENT_PATTERNS" | grep -c "$PATTERNS" || true)
  if [[ "$RECENT_COUNT" -ge 3 ]]; then
    append ""
    append "**⚠ RECURRING PATTERN: \`${PATTERNS}\` seen in 3+ runs in a row**"
  fi
fi

exit 0
