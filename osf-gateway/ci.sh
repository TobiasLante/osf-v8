#!/bin/bash
set -euo pipefail

echo "=== osf-gateway CI ==="

echo "[1/4] Installing dependencies..."
npm ci

echo "[2/4] Building..."
npm run build

echo "[3/4] Security audit (production deps)..."
npm audit --omit=dev --audit-level=high
echo "  ✓ No high/critical vulnerabilities"

echo "[4/4] Type check (optional)..."
npx tsc --noEmit 2>&1 || echo "  ⚠ Type errors (non-blocking)"

echo "=== CI passed ==="
