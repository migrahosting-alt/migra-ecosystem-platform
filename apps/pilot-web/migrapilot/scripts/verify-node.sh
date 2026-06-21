#!/usr/bin/env bash
set -e

echo "=== MigraPilot Node Verification ==="

echo
echo "1. Running build..."
npm run build

echo
echo "2. Running audit..."
npm audit || true

echo
echo "3. Checking port 3399..."
lsof -i :3399 || echo "Port 3399 appears free"

echo
echo "Verification complete."