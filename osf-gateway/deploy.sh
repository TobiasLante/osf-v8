#!/bin/bash
set -euo pipefail

# osf-gateway deploy script
# Build locally with SWC, rsync to 120, Docker build, push to 150:32000, kubectl set image

VERSION="${1:-v1}"
BUILD_HOST="192.168.178.120"
REGISTRY="192.168.178.150:32000"
IMAGE_NAME="osf-gateway"
NAMESPACE="osf"

echo "=== osf-gateway deploy ${VERSION} ==="

# 1. Build with SWC
echo "[1/6] Building with SWC..."
npm run build

# 2. Install production deps
echo "[2/6] Installing production dependencies..."
npm ci --omit=dev

# 3. rsync to build host
echo "[3/6] Syncing to ${BUILD_HOST}..."
rsync -az --delete \
  --exclude='.git' \
  --exclude='src' \
  --exclude='.env' \
  /opt/openshopfloor-gateway/ \
  ${BUILD_HOST}:/tmp/osf-gateway-build/

# 4. Docker build on build host
echo "[4/6] Building Docker image on ${BUILD_HOST}..."
ssh ${BUILD_HOST} "cd /tmp/osf-gateway-build && docker build -t ${REGISTRY}/${IMAGE_NAME}:${VERSION} ."

# 5. Push to registry
echo "[5/6] Pushing to ${REGISTRY}..."
ssh ${BUILD_HOST} "docker push ${REGISTRY}/${IMAGE_NAME}:${VERSION}"

# 6. kubectl set image
echo "[6/6] Rolling out in k8s..."
kubectl set image deployment/osf-gateway \
  osf-gateway=${REGISTRY}/${IMAGE_NAME}:${VERSION} \
  -n ${NAMESPACE}

echo "=== Deploy complete: ${IMAGE_NAME}:${VERSION} ==="
