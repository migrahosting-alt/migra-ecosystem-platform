# MigraHosting Secrets Manager

**Centralized, auto-syncing secrets and configuration management for the entire MigraHosting ecosystem.**

## Purpose
Single source of truth for:
- API keys (Stripe, SendGrid, Twilio, AWS, etc.)
- Database credentials
- Service tokens (JWT secrets, encryption keys)
- Third-party integrations
- Auto-sync across all services every 10 seconds
- Fault-tolerant with fallback to cached values

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Secrets Vault (Redis + File-based fallback)            │
│  Location: mpanel-core:/opt/secrets-vault/              │
└─────────────────────────────────────────────────────────┘
                        ↓ Pull every 10s
┌─────────────┬─────────────┬────────────────────────────┐
│ mpanel-api  │  srv1-web   │      dns-mail-core         │
│ (Express)   │  (NGINX)    │      (Mail + PowerDNS)     │
└─────────────┴─────────────┴────────────────────────────┘
```

## Structure

```
/opt/secrets-vault/
├── vault.json              # Master encrypted vault (Redis-backed)
├── cache/
│   ├── api-keys.json       # Cached API keys (5min TTL)
│   ├── db-credentials.json # Cached DB creds (10min TTL)
│   └── service-tokens.json # Cached tokens (15min TTL)
├── sync/
│   ├── sync-agent.js       # Auto-sync daemon
│   └── sync-config.json    # Sync settings (interval: 10s)
└── logs/
    └── sync.log            # Sync operations log
```

## Features

1. **Auto-Sync**: Every 10 seconds, all services pull latest config
2. **Fallback**: If vault unreachable, use local cache (TTL-based)
3. **Hot-Reload**: Services reload config without restart
4. **Audit Trail**: All secret access logged to Guardian AI
5. **Encryption**: AES-256-GCM for secrets at rest
6. **Access Control**: RBAC for secret read/write/rotate

## Usage

### In mPanel API:
```typescript
import { SecretsManager } from '@migra/secrets-manager';

const secrets = await SecretsManager.get('stripe.secret_key');
const dbUrl = await SecretsManager.get('database.url');
```

### In NGINX (via Lua):
```lua
local secrets = require "migra.secrets"
local stripe_key = secrets:get("stripe.secret_key")
```

### Auto-Sync Client (runs on each service):
```bash
# Start sync daemon (auto-restart on failure)
pm2 start /opt/secrets-vault/sync/sync-agent.js --name secrets-sync
```

## Files to Create

1. `/opt/secrets-vault/vault.json` - Master vault
2. `/opt/secrets-vault/sync/sync-agent.js` - Auto-sync daemon
3. `migra-panel/src/lib/secrets-manager.ts` - Client library
4. `migra-panel/src/config/secrets.schema.json` - Validation schema

## Environment Variables (Bootstrap Only)

```bash
SECRETS_VAULT_URL=redis://100.119.105.93:6379
SECRETS_VAULT_KEY=<32-byte-hex-encryption-key>
SECRETS_FALLBACK_FILE=/opt/secrets-vault/cache/fallback.json
SECRETS_SYNC_INTERVAL=10000  # 10 seconds
```

## Migration Plan

1. Deploy secrets-vault to mpanel-core
2. Migrate existing .env vars to vault
3. Deploy sync-agent to all services
4. Update application code to use SecretsManager
5. Remove hardcoded credentials from codebase
6. Enable auto-sync monitoring in Guardian AI
