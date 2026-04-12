#!/bin/bash
# Quick fix for remaining module tenantId issues

set -e

HOST="root@100.119.105.93"
DIST="/opt/mpanel/dist"

echo "=== Scanning for tenantId issues in all modules ==="
echo ""

# Find all service/controller files that might have tenantId issues
ssh $HOST "cd $DIST && find modules -name '*.service.js' -o -name '*.controller.js' | head -20" | while read file; do
  echo "Checking: $file"
  
  # Check if file has Prisma queries without tenantId guard
  ssh $HOST "grep -l 'prisma\.' $DIST/$file 2>/dev/null || true" | while read match; do
    echo "  → Found Prisma usage, checking for tenantId guard..."
    
    # Check if it has tenantId validation
    if ssh $HOST "grep -q 'tenantId.*null' $DIST/$file"; then
      echo "  ✓ Has tenantId guard"
    else
      echo "  ⚠ MISSING tenantId guard - needs patching"
    fi
  done
done

echo ""
echo "=== Checking Guardian module specifically ==="
ssh $HOST "ls -la $DIST/modules/guardian/*.js" || echo "Guardian module not in modules/"
ssh $HOST "head -50 $DIST/controllers/guardianController.js 2>/dev/null | grep -A2 'async.*req.*res' | head -20" || echo "guardianController.js not found"

echo ""
echo "=== Checking auth middleware on all routers ==="
ssh $HOST "cd $DIST/modules && find . -name '*.router.js' -exec sh -c 'echo \"File: {}\"; grep -n \"authMiddleware\\|authenticate\\|requireAuth\" {} | head -3 || echo \"  ⚠ No auth middleware found\"' \;" | head -60
