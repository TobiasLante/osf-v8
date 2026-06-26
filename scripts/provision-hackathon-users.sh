#!/usr/bin/env bash
# Provision N Hackathon-User auf osf-postgres-new (K8s namespace osf).
# Generates random emails, passwords, API-Keys; writes one credential file per user.
# Idempotent: re-runs UPDATE-or-INSERT.
#
# Usage:
#   ./provision-hackathon-users.sh                    # default 10 users, prefix hk
#   ./provision-hackathon-users.sh --count 20         # 20 users
#   ./provision-hackathon-users.sh --prefix demo      # email = demo01@hackathon.zeroguess.ai
#   ./provision-hackathon-users.sh --dry-run          # print SQL, do not exec
#
# Output: /tmp/hackathon-creds/USER.txt per user (email + password + API-Key + sample curl)

set -euo pipefail

COUNT=10
PREFIX="hk"
DOMAIN="hackathon.zeroguess.ai"
TIER="hackathon"
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --count)    COUNT="$2"; shift 2 ;;
    --prefix)   PREFIX="$2"; shift 2 ;;
    --domain)   DOMAIN="$2"; shift 2 ;;
    --tier)     TIER="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

OUT_DIR="/tmp/hackathon-creds"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

# Postgres connection (cluster-internal, run via kubectl exec)
PG_POD=$(kubectl -n osf get pods -l app=osf-postgres-new -o jsonpath="{.items[0].metadata.name}" 2>/dev/null || true)
if [ -z "$PG_POD" ]; then
  echo "ERR: osf-postgres-new pod not found" >&2
  exit 1
fi

# Helpers
randhex()  { openssl rand -hex "$1"; }
sha256hex() { printf %s "$1" | sha256sum | awk '{print $1}'; }
bcrypt_hash() {
  # osf-gateway image has bcryptjs (not bcrypt); use hashSync via kubectl exec.
  local pw="$1"
  kubectl -n osf exec deploy/osf-gateway -- node -e 'const b=require("bcryptjs");process.stdout.write(b.hashSync(process.argv[1],12))' "$pw"
}

echo "Provisioning $COUNT users (prefix=$PREFIX, tier=$TIER) ..."
echo "Postgres pod: $PG_POD"

for i in $(seq 1 "$COUNT"); do
  PADDED=$(printf "%02d" "$i")
  EMAIL="${PREFIX}${PADDED}@${DOMAIN}"
  PASSWORD="$(randhex 8)"     # 16-char hex password
  API_KEY="osf_hk_$(randhex 16)"   # 32-char hex token
  API_KEY_HASH=$(sha256hex "$API_KEY")
  PWD_HASH=$(bcrypt_hash "$PASSWORD")

  SQL="
    INSERT INTO users (email, password_hash, name, tier, role, api_key, api_key_hash, email_verified, created_at)
    VALUES ('${EMAIL}', '${PWD_HASH}', 'Hackathon User ${PADDED}', '${TIER}', 'user', '${API_KEY}', '${API_KEY_HASH}', true, NOW())
    ON CONFLICT (email) DO UPDATE
      SET api_key = EXCLUDED.api_key, api_key_hash = EXCLUDED.api_key_hash, tier = EXCLUDED.tier, password_hash = EXCLUDED.password_hash;
  "

  if [ "$DRY_RUN" = true ]; then
    echo "--- $EMAIL ---"
    echo "  password: $PASSWORD"
    echo "  api-key:  $API_KEY"
    continue
  fi

  echo "$SQL" | kubectl -n osf exec -i "$PG_POD" -- psql -U osf_admin -d osf -v ON_ERROR_STOP=1 >/dev/null

  CRED_FILE="$OUT_DIR/${EMAIL}.txt"
  cat > "$CRED_FILE" <<CREDS
sim-v5 Hackathon — Zugangsdaten
================================
Email:    $EMAIL
Password: $PASSWORD
API-Key:  $API_KEY
Portal:   https://openshopfloor.zeroguess.ai/hackathon
Docs:     https://osf-api.zeroguess.ai/api/sim-v5/docs

Login via Browser:  https://openshopfloor.zeroguess.ai/login
oder via API:
  curl -H "X-API-Key: $API_KEY" \\
    https://osf-api.zeroguess.ai/api/sim-v5/opcua/machines | jq

Rate-Limit: 60 req/min/Key. GET-only. Read-only.
Support: tobias.lante74@gmail.com
CREDS
  chmod 600 "$CRED_FILE"
  echo "  $EMAIL -> $CRED_FILE"
done

echo ""
echo "Done. Files in $OUT_DIR (chmod 600)."
echo "Per-User email-out: e.g. mutt -s Hackathon Zugang you@addr < $OUT_DIR/${PREFIX}01@${DOMAIN}.txt"
