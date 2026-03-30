#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

REGISTRY="${REGISTRY:-192.168.178.150:32000}"
VERSION=$(node -p "require('./package.json').version")
NAMESPACE="${NAMESPACE:-osf}"

echo "═══ Process1st Gateway — K8s Deploy ═══"
echo "  Registry:  $REGISTRY"
echo "  Version:   $VERSION"
echo "  Namespace: $NAMESPACE"
echo ""

# Build & push gateway image
echo "Building gateway image..."
docker build -f Dockerfile.gateway -t "$REGISTRY/p1-gateway:$VERSION" -t "$REGISTRY/p1-gateway:latest" .
docker push "$REGISTRY/p1-gateway:$VERSION"
docker push "$REGISTRY/p1-gateway:latest"

# Apply K8s manifests
echo "Applying K8s manifests..."
kubectl apply -f k8s/gateway.yaml -n "$NAMESPACE"

# Restart deployment to pick up new image
kubectl rollout restart deployment/p1-gateway -n "$NAMESPACE"
kubectl rollout status deployment/p1-gateway -n "$NAMESPACE" --timeout=60s

# Verify
echo ""
echo "Verifying..."
sleep 3
GATEWAY_IP="192.168.178.150"
HEALTH=$(curl -sf "http://$GATEWAY_IP:31101/health" 2>/dev/null || echo "FAILED")
echo "  Health: $HEALTH"

echo ""
echo "═══ Done! ═══"
echo "  Gateway: http://$GATEWAY_IP:31101"
echo "  Next: Set up Cloudflare Tunnel to expose as process1st-api.zeroguess.ai"
