#!/bin/bash
# OSF v8 — K8s Deploy Script
# Usage: bash deploy-osf.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="192.168.178.150:32000"
V8_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== OSF v8 — K8s Deploy ==="

# 1. Build & push images
echo "[1/6] Building and pushing images..."

echo "  → osf-gateway..."
docker build -t "$REGISTRY/osf-gateway:v8" -f "$V8_ROOT/osf-gateway/Dockerfile.gateway" "$V8_ROOT/osf-gateway"
docker push "$REGISTRY/osf-gateway:v8"

echo "  → osf-frontend..."
docker build -t "$REGISTRY/osf-frontend:v8" \
  --build-arg NEXT_PUBLIC_API_URL=https://zeroguess.factory-intelligence.work \
  --build-arg NEXT_PUBLIC_FACTORY_URL=http://192.168.178.150:30888 \
  --build-arg NEXT_PUBLIC_MQTT_EXPLORER_URL=http://192.168.178.150:31884 \
  "$V8_ROOT/osf-frontend"
docker push "$REGISTRY/osf-frontend:v8"

echo "  → osf-chat-ui..."
docker build -t "$REGISTRY/osf-chat-ui:v8" -f "$V8_ROOT/chat-ui/Dockerfile" "$V8_ROOT/chat-ui"
docker push "$REGISTRY/osf-chat-ui:v8"

# 2. Namespace
echo "[2/6] Creating namespace..."
kubectl apply -f "$SCRIPT_DIR/osf-namespace.yaml"

# 3. Secrets + Config
echo "[3/6] Applying secrets and config..."
kubectl apply -f "$SCRIPT_DIR/osf-secrets.yaml"
kubectl apply -f "$SCRIPT_DIR/osf-config.yaml"

# 4. Redis (must be up before gateway)
echo "[4/6] Deploying Redis..."
kubectl apply -f "$SCRIPT_DIR/osf-redis.yaml"
kubectl rollout status deployment/osf-redis -n osf --timeout=60s

# 5. Gateway + Frontend + Chat-UI
echo "[5/6] Deploying Gateway, Frontend, Chat-UI..."
kubectl apply -f "$SCRIPT_DIR/osf-gateway.yaml"
kubectl apply -f "$SCRIPT_DIR/osf-frontend.yaml"
kubectl apply -f "$SCRIPT_DIR/osf-chat-ui.yaml"

# 6. Wait for rollouts
echo "[6/6] Waiting for rollouts..."
for svc in osf-gateway osf-frontend osf-chat-ui; do
  kubectl rollout status "deployment/$svc" -n osf --timeout=120s || \
    echo "WARNING: $svc rollout timed out"
done

echo ""
echo "=== Deploy complete ==="
kubectl -n osf get pods
kubectl -n osf get svc
echo ""
echo "CF Tunnel routes needed:"
echo "  demo.zeroguess.ai      → http://osf-chat-ui.osf.svc.cluster.local:80"
echo "  zeroguess.factory-intelligence.work → http://osf-gateway.osf.svc.cluster.local:8012"
echo "  openshopfloor.zeroguess.ai → CF Pages (no tunnel needed)"
