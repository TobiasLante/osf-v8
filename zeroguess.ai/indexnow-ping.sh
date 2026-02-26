#!/bin/bash
# IndexNow ping — notifies Bing, Yandex, and other search engines about updated URLs
# Run after every deploy: bash zeroguess-landing/indexnow-ping.sh

INDEXNOW_KEY="53f051da71ad47a09ae6d0cee1fb7fa7"
HOST="www.zeroguess.ai"

URLS=(
  "https://www.zeroguess.ai/"
  "https://www.zeroguess.ai/use-cases"
  "https://www.zeroguess.ai/technology"
  "https://www.zeroguess.ai/faq"
  "https://www.zeroguess.ai/blog/"
  "https://www.zeroguess.ai/use-cases/oee-optimization"
  "https://www.zeroguess.ai/use-cases/on-time-delivery"
  "https://www.zeroguess.ai/use-cases/revenue-intelligence"
  "https://www.zeroguess.ai/use-cases/quality-optimization"
  "https://www.zeroguess.ai/use-cases/shopfloor-report"
  "https://www.zeroguess.ai/use-cases/strategic-planning"
  "https://www.zeroguess.ai/blog/why-dashboards-fail"
  "https://www.zeroguess.ai/blog/debate-protocol"
  "https://www.zeroguess.ai/blog/mcp-in-manufacturing"
  "https://www.zeroguess.ai/blog/on-premise-ai"
  "https://www.zeroguess.ai/blog/dashboard-to-decision"
  "https://www.zeroguess.ai/llms.txt"
  "https://www.zeroguess.ai/llms-full.txt"
  "https://www.zeroguess.ai/sitemap.xml"
)

# Build JSON payload
URL_JSON=$(printf ',"%s"' "${URLS[@]}")
URL_JSON="[${URL_JSON:1}]"

PAYLOAD=$(cat <<EOF
{
  "host": "$HOST",
  "key": "$INDEXNOW_KEY",
  "keyLocation": "https://$HOST/$INDEXNOW_KEY.txt",
  "urlList": $URL_JSON
}
EOF
)

echo "Pinging IndexNow with ${#URLS[@]} URLs..."

# Ping Bing (IndexNow)
echo -n "  Bing: "
curl -s -o /dev/null -w "%{http_code}" -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json" -d "$PAYLOAD"
echo ""

# Ping Yandex (IndexNow)
echo -n "  Yandex: "
curl -s -o /dev/null -w "%{http_code}" -X POST "https://yandex.com/indexnow" \
  -H "Content-Type: application/json" -d "$PAYLOAD"
echo ""

echo "Done."
