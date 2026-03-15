#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Build + Deploy OSF Frontend to Cloudflare Pages
#
# Usage:
#   ./deploy.sh              # pull, build, deploy, verify
#   ./deploy.sh --no-pull    # skip git pull (use current state)
#   ./deploy.sh --test-env   # also rebuild .110 Docker frontend
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CF_TOKEN="${CLOUDFLARE_API_TOKEN:-xk3QEj9DkzXiykqV8nEhxXM9hg0MrM0vuMywHfdj}"
CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-16df0d14dc010bf4ee8cba95574060b9}"
CF_PROJECT="openshopfloor"
PROD_URL="https://openshopfloor.zeroguess.ai"
TEST_HOST="192.168.178.110"

DO_PULL=true
DO_TEST_ENV=false

for arg in "$@"; do
  case "$arg" in
    --no-pull)    DO_PULL=false ;;
    --test-env)   DO_TEST_ENV=true ;;
  esac
done

PASS=0; FAIL=0
green()  { printf "\033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
red()    { printf "\033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
step()   { printf "\n\033[34m── %s ──\033[0m\n" "$1"; }

# ─── 1. Git Pull ──────────────────────────────────────────────────────────────
if [ "$DO_PULL" = true ]; then
  step "Git Pull"
  if ! git diff --quiet 2>/dev/null; then
    echo "  Stashing local changes..."
    git stash
  fi
  git pull origin main 2>&1 | tail -3
  green "Git up to date"
fi

# ─── 2. Build ─────────────────────────────────────────────────────────────────
step "Build (npm run build)"
npm run build 2>&1 | tail -5

if [ ! -f out/index.html ]; then
  red "Build failed — out/index.html missing"
  exit 1
fi

# Required pages — add new pages here when they are created
REQUIRED_PAGES="index admin login chat flows chains dashboard settings uns agents i3x onboarding register news"
MISSING=0
FOUND=0
for PAGE in $REQUIRED_PAGES; do
  if [ -f "out/${PAGE}.html" ]; then
    FOUND=$((FOUND+1))
  else
    red "Missing: ${PAGE}.html"
    MISSING=$((MISSING+1))
  fi
done
# Show what extra pages exist beyond the required list
EXTRA=$(ls out/*.html 2>/dev/null | sed 's|out/||;s|\.html||' | while read p; do
  echo "$REQUIRED_PAGES" | grep -qw "$p" || echo "$p"
done)
if [ -n "$EXTRA" ]; then
  echo "  Extra pages: $EXTRA"
fi
PAGE_COUNT=$(ls out/*.html 2>/dev/null | wc -l)
if [ "$MISSING" -eq 0 ]; then
  green "Build OK — ${FOUND}/${FOUND} required + ${PAGE_COUNT} total pages"
else
  red "${MISSING} required pages missing (${FOUND} found, ${PAGE_COUNT} total)"
  exit 1
fi

# ─── 3. Deploy to Cloudflare ──────────────────────────────────────────────────
step "Deploy to Cloudflare Pages"
DEPLOY_OUT=$(CLOUDFLARE_API_TOKEN="$CF_TOKEN" \
  CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT" \
  npx wrangler pages deploy out \
    --project-name="$CF_PROJECT" \
    --commit-dirty=true 2>&1)

if echo "$DEPLOY_OUT" | grep -q "Deployment complete"; then
  DEPLOY_URL=$(echo "$DEPLOY_OUT" | grep -oP 'https://[a-z0-9]+\.openshopfloor\.pages\.dev' | head -1)
  green "Deployed: ${DEPLOY_URL}"
else
  echo "$DEPLOY_OUT"
  red "Deploy failed"
  exit 1
fi

# ─── 4. Verify Production ─────────────────────────────────────────────────────
step "Verify Production Pages"
sleep 3

for PAGE in "" uns admin login chat flows i3x agents dashboard settings; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${PROD_URL}/${PAGE}" 2>/dev/null)
  if [ "$CODE" = "200" ]; then
    green "${PROD_URL}/${PAGE} → HTTP ${CODE}"
  else
    red "${PROD_URL}/${PAGE} → HTTP ${CODE}"
  fi
done

# ─── 4b. Verify API + Login ──────────────────────────────────────────────────
step "Verify API (osf-api.zeroguess.ai)"
API_URL="https://osf-api.zeroguess.ai"

# Health check
HEALTH=$(curl -s --connect-timeout 5 "${API_URL}/health" 2>/dev/null)
if echo "$HEALTH" | grep -qE '"(overall|status)"'; then
  green "API Health OK"
else
  red "API Health failed"
fi

# Login test (production may not have v9 auth yet — just warn)
cat > /tmp/_osf_login.json << 'LOGINEOF'
{"email":"admin@osf.local","password":"admin123!"}
LOGINEOF
LOGIN_RESP=$(curl -s --connect-timeout 5 -X POST "${API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d @/tmp/_osf_login.json 2>/dev/null)
rm -f /tmp/_osf_login.json
if echo "$LOGIN_RESP" | grep -q '"token"'; then
  green "Login OK (admin@osf.local)"
  PROD_TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
  for EP in "/admin/health" "/admin/agents/status" "/admin/dashboard/snapshot"; do
    EP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
      -H "Authorization: Bearer ${PROD_TOKEN}" "${API_URL}${EP}" 2>/dev/null)
    [ "$EP_CODE" = "200" ] && green "API ${EP} → ${EP_CODE}" || red "API ${EP} → ${EP_CODE}"
  done
else
  echo "  (Login skipped — prod may not have v9 auth)"
fi

# ─── 5. Optional: Rebuild .110 test environment ───────────────────────────────
if [ "$DO_TEST_ENV" = true ]; then
  step "Rebuild .110 Test Frontend"
  if ! ssh -o ConnectTimeout=3 tlante@${TEST_HOST} "echo ok" >/dev/null 2>&1; then
    red "SSH to ${TEST_HOST} failed — skip"
  else
    # Rebuild with correct API URL
    NEXT_PUBLIC_API_URL="http://${TEST_HOST}:8012" npm run build 2>&1 | tail -3
    rsync -az --delete out/ tlante@${TEST_HOST}:/opt/osf-v8/osf-frontend/out/
    ssh tlante@${TEST_HOST} "cd /opt/osf-v8/k8s/test-env && docker compose restart frontend 2>&1"
    sleep 2

    # Check pages
    for PAGE in "" admin login chat uns agents dashboard; do
      CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${TEST_HOST}:3001/${PAGE}" 2>/dev/null)
      [ "$CODE" = "200" ] && green ".110:3001/${PAGE} → ${CODE}" || red ".110:3001/${PAGE} → ${CODE}"
    done

    # Login + API checks
    step "Verify .110 API + Login"
    TEST_API="http://${TEST_HOST}:8012"
    cat > /tmp/_osf_test_login.json << 'LOGINEOF'
{"email":"admin@test.local","password":"Test1234!"}
LOGINEOF
    TEST_LOGIN=$(curl -s --connect-timeout 5 -X POST "${TEST_API}/auth/login" \
      -H "Content-Type: application/json" \
      -d @/tmp/_osf_test_login.json 2>/dev/null)
    rm -f /tmp/_osf_test_login.json
    if echo "$TEST_LOGIN" | grep -q '"token"'; then
      green ".110 Login OK (admin@test.local)"
      TEST_TOKEN=$(echo "$TEST_LOGIN" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
      for EP in "/admin/health" "/admin/agents/status" "/admin/dashboard/snapshot" "/admin/tool-classifications" "/admin/roles" "/admin/tool-categories"; do
        EP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
          -H "Authorization: Bearer ${TEST_TOKEN}" "${TEST_API}${EP}" 2>/dev/null)
        [ "$EP_CODE" = "200" ] && green ".110 API ${EP} → ${EP_CODE}" || red ".110 API ${EP} → ${EP_CODE}"
      done
    else
      red ".110 Login failed — ${TEST_LOGIN}"
    fi
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
printf "  Result: \033[32m%d passed\033[0m" "$PASS"
[ "$FAIL" -gt 0 ] && printf ", \033[31m%d failed\033[0m" "$FAIL"
echo ""
echo "═══════════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
