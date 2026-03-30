#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GATEWAY_URL="${NEXT_PUBLIC_GATEWAY_URL:-https://process1st-api.zeroguess.ai}"
CF_PROJECT="${CF_PROJECT:-process1st-chat}"
CUSTOM_DOMAIN="${CF_CUSTOM_DOMAIN:-process1st.zeroguess.ai}"

echo "═══ Process1st Chat-UI — Cloudflare Deploy ═══"
echo "  Gateway URL: $GATEWAY_URL"
echo "  CF Project:  $CF_PROJECT"
echo "  Domain:      $CUSTOM_DOMAIN"
echo ""

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi

# Build static export
echo "Building web..."
cd packages/web
NEXT_PUBLIC_GATEWAY_URL="$GATEWAY_URL" NEXT_CF_EXPORT=true npx next build

if [ ! -d out ]; then
  echo "ERROR: 'out' directory not found — build failed"
  exit 1
fi

# Deploy
echo "Deploying to Cloudflare Pages..."
npx wrangler pages deploy out --project-name "$CF_PROJECT"

echo ""
echo "═══ Done! ═══"
echo "  URL: https://$CUSTOM_DOMAIN"
echo ""
echo "  First deploy? Set up custom domain in CF Dashboard:"
echo "    Pages → $CF_PROJECT → Custom domains → Add: $CUSTOM_DOMAIN"
