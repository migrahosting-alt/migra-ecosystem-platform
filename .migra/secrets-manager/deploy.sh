#!/bin/bash
# Deploy Secrets Vault to mpanel-core (100.119.105.93)

set -e

HOST="root@100.119.105.93"
VAULT_DIR="/opt/secrets-vault"

echo "=== MigraHosting Secrets Vault Deployment ==="
echo ""

# 1. Create directory structure
echo "[1/6] Creating vault directories on mpanel-core..."
ssh $HOST "mkdir -p $VAULT_DIR/{cache,sync,logs} && chmod 700 $VAULT_DIR"

# 2. Copy sync agent
echo "[2/6] Deploying sync agent..."
scp sync-agent.js $HOST:$VAULT_DIR/sync/
ssh $HOST "chmod +x $VAULT_DIR/sync/sync-agent.js"

# 3. Copy schema
echo "[3/6] Deploying vault schema..."
scp vault-schema.json $HOST:$VAULT_DIR/

# 4. Generate encryption key if not exists
echo "[4/6] Checking encryption key..."
ssh $HOST "if [ ! -f /opt/mpanel/.env.secrets ]; then
  echo 'SECRETS_VAULT_KEY='$(openssl rand -hex 32) > /opt/mpanel/.env.secrets
  echo 'SECRETS_VAULT_URL=redis://127.0.0.1:6379' >> /opt/mpanel/.env.secrets
  echo 'SECRETS_SYNC_INTERVAL=10000' >> /opt/mpanel/.env.secrets
  chmod 600 /opt/mpanel/.env.secrets
  echo '✓ Generated new encryption key'
else
  echo '✓ Encryption key already exists'
fi"

# 5. Install dependencies
echo "[5/6] Installing dependencies..."
ssh $HOST "cd $VAULT_DIR/sync && npm install redis"

# 6. Start sync agent with PM2
echo "[6/6] Starting secrets sync agent..."
ssh $HOST "source /opt/mpanel/.env.secrets && pm2 start $VAULT_DIR/sync/sync-agent.js --name secrets-sync --update-env && pm2 save"

echo ""
echo "✓ Secrets Vault deployed successfully!"
echo ""
echo "Next steps:"
echo "1. Populate vault: ssh $HOST 'vi $VAULT_DIR/cache/fallback.json'"
echo "2. Encrypt vault: node encrypt-vault.js"
echo "3. Update mPanel to use SecretsManager"
echo ""
echo "Monitoring:"
echo "  pm2 logs secrets-sync"
echo "  tail -f $VAULT_DIR/logs/sync.log"
