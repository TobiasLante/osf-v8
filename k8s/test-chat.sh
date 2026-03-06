#!/bin/bash
# ═══════════════════════════════════════════════════════
# OSF Chat API Test — sends a prompt through the full pipeline
# Usage: ./test-chat.sh "Wie ist die OEE von Maschine 1001?"
#        ./test-chat.sh -v "Frage"    # verbose: show all SSE events
# ═══════════════════════════════════════════════════════
set -euo pipefail

VERBOSE=false
if [[ "${1:-}" == "-v" ]]; then VERBOSE=true; shift; fi

MESSAGE="${1:-Wie ist die aktuelle OEE der Maschine 1001?}"
TIMEOUT="${2:-600}"

# Generate JWT token from gateway pod
TOKEN=$(kubectl exec -n osf deploy/osf-gateway -- node -e "
const jwt = require('jsonwebtoken');
process.stdout.write(jwt.sign(
  {userId:'8e4b6c14-5846-4eab-8774-ad915bc8387e', email:'tobias.lante@ttpsc.com', tier:'premium', role:'admin'},
  process.env.JWT_SECRET, {algorithm:'HS256', expiresIn:'1h'}
));" 2>/dev/null)

echo "📤 Prompt: $MESSAGE"
echo "─────────────────────────────────────────"

# Collect SSE stream and parse events
RAW=$(timeout "$TIMEOUT" curl -s -N \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\":$(echo "$MESSAGE" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))')}" \
  "https://osf-api.zeroguess.ai/chat/completions" 2>/dev/null || true)

if [[ -z "$RAW" ]]; then
  echo "❌ No response (timeout after ${TIMEOUT}s)"
  exit 1
fi

# Parse SSE events with python
python3 -c "
import json, sys

raw = sys.stdin.read()
verbose = '$VERBOSE' == 'true'
answer = []
tools = []
events = []

for line in raw.split('\n'):
    if not line.startswith('data: '):
        continue
    try:
        ev = json.loads(line[6:])
    except:
        continue

    t = ev.get('type','')
    events.append(t)

    if t == 'session':
        if verbose: print(f'📋 Session: {ev.get(\"sessionId\",\"?\")[:8]}')
    elif t == 'tool_start':
        tools.append(ev.get('name','?'))
        if verbose: print(f'🔧 Tool: {ev.get(\"name\")} ({json.dumps(ev.get(\"arguments\",{}))})')
    elif t == 'tool_result':
        if verbose:
            res = ev.get('result','')
            preview = res[:200] + '...' if len(res) > 200 else res
            print(f'   → Result: {preview}')
    elif t == 'content':
        answer.append(ev.get('text',''))
    elif t in ('kg_traversal_start','kg_nodes_discovered','kg_traversal_end','kg_summary'):
        if verbose: print(f'🌐 KG: {t}')
    elif t.startswith('specialist_') or t.startswith('discussion_') or t.startswith('debate_'):
        if verbose: print(f'🗣️  {t}')
    elif t == 'done':
        pass

# Summary
if tools:
    print(f'🔧 Tools: {\", \".join(tools)}')
print()
print(''.join(answer))
print()
print(f'─── {len(events)} events, {len(tools)} tool calls ───')
" <<< "$RAW"
