#!/bin/bash
# Deploy Guardian Unified Schema Migration
# Run this script on mpanel-core (100.119.105.93)

set -e

echo "=== Guardian Unified Schema Migration ==="
echo ""

# Configuration
DB_NAME="mpanel"
DB_USER="postgres"
BACKUP_DIR="/opt/mpanel/backups"
MIGRATION_SQL="/tmp/001-create-guardian-unified.sql"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[1/6] Creating database backup..."
BACKUP_FILE="$BACKUP_DIR/mpanel_pre_guardian_$(date +%Y%m%d_%H%M%S).sql.gz"
su - postgres -c "pg_dump $DB_NAME | gzip > $BACKUP_FILE"
echo "✓ Backup created: $BACKUP_FILE"
echo ""

echo "[2/6] Checking if guardian_instances table already exists..."
TABLE_EXISTS=$(su - postgres -c "psql -d $DB_NAME -tAc \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='guardian_instances');\"")

if [ "$TABLE_EXISTS" = "t" ]; then
  echo "⚠ Table guardian_instances already exists. Skipping creation."
  echo "  If you need to recreate, manually drop it first:"
  echo "  psql -d $DB_NAME -c 'DROP TABLE guardian_instances CASCADE;'"
  exit 1
fi

echo "✓ Table does not exist, proceeding..."
echo ""

echo "[3/6] Running migration SQL..."
su - postgres -c "psql -d $DB_NAME -f $MIGRATION_SQL"
echo "✓ Migration SQL executed"
echo ""

echo "[4/6] Verifying table structure..."
su - postgres -c "psql -d $DB_NAME -c \"\\d guardian_instances\"" | head -50
echo ""

echo "[5/6] Updating Prisma schema..."
cd /opt/mpanel

# Backup current schema
cp prisma/schema.prisma prisma/schema.prisma.bak-$(date +%Y%m%d_%H%M%S)

# Note: Prisma schema update must be done manually or via sed/script
echo "⚠ Manual step required: Update GuardianInstance model in prisma/schema.prisma"
echo "  See: /tmp/guardian-prisma-model.txt for the new model definition"
echo ""

echo "[6/6] Ready to generate Prisma client..."
echo "  After updating schema.prisma, run:"
echo "    cd /opt/mpanel && npx prisma generate"
echo "    npm run build"
echo "    pm2 restart mpanel-api"
echo ""

echo "✅ Migration completed successfully!"
echo ""
echo "Verification:"
echo "  psql -U postgres -d mpanel -c 'SELECT COUNT(*) FROM guardian_instances;'"
echo ""
echo "Rollback (if needed):"
echo "  psql -U postgres -d mpanel -c 'DROP TABLE guardian_instances CASCADE;'"
echo "  zcat $BACKUP_FILE | psql -U postgres -d mpanel"
