#!/usr/bin/env node
/**
 * MigraHosting Secrets Sync Agent
 * 
 * Auto-syncs secrets from central vault to local cache every 10 seconds.
 * Falls back to cached values if vault is unreachable.
 * 
 * Usage:
 *   pm2 start sync-agent.js --name secrets-sync
 */

import fs from 'fs/promises';
import { createClient } from 'redis';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
  VAULT_REDIS_URL: process.env.SECRETS_VAULT_URL || 'redis://100.97.213.11:6379',
  VAULT_KEY: process.env.SECRETS_VAULT_KEY || null,
  CACHE_DIR: process.env.SECRETS_CACHE_DIR || '/opt/secrets-vault/cache',
  SYNC_INTERVAL: parseInt(process.env.SECRETS_SYNC_INTERVAL || '10000'), // 10 seconds
  LOG_FILE: '/opt/secrets-vault/logs/sync.log',
  FALLBACK_FILE: '/opt/secrets-vault/cache/fallback.json',
};

// Redis client
let redisClient;
let lastSyncTime = null;
let syncFailures = 0;
let cachedSecrets = null;

/**
 * Initialize Redis connection
 */
async function initRedis() {
  try {
    redisClient = createClient({ url: CONFIG.VAULT_REDIS_URL });
    
    redisClient.on('error', (err) => {
      logError('Redis connection error', err);
    });

    redisClient.on('reconnecting', () => {
      log('Reconnecting to Redis...');
    });

    await redisClient.connect();
    log('✓ Connected to secrets vault (Redis)');
    return true;
  } catch (err) {
    logError('Failed to connect to Redis', err);
    return false;
  }
}

/**
 * Decrypt secrets using AES-256-GCM
 */
function decrypt(encryptedData) {
  if (!CONFIG.VAULT_KEY) {
    throw new Error('SECRETS_VAULT_KEY not set');
  }

  const { iv, authTag, encrypted } = JSON.parse(encryptedData);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(CONFIG.VAULT_KEY, 'hex'),
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

/**
 * Fetch secrets from Redis vault
 */
async function fetchFromVault() {
  try {
    const encrypted = await redisClient.get('secrets:vault:master');
    
    if (!encrypted) {
      log('⚠ No secrets in vault, using fallback');
      return await loadFallback();
    }

    const secrets = decrypt(encrypted);
    secrets._synced_at = new Date().toISOString();
    return secrets;
  } catch (err) {
    logError('Failed to fetch from vault', err);
    return null;
  }
}

/**
 * Load fallback from local file
 */
async function loadFallback() {
  try {
    const data = await fs.readFile(CONFIG.FALLBACK_FILE, 'utf8');
    const secrets = JSON.parse(data);
    log('✓ Loaded fallback secrets from cache');
    return secrets;
  } catch (err) {
    logError('Failed to load fallback', err);
    return null;
  }
}

/**
 * Save secrets to cache files
 */
async function saveToCache(secrets) {
  try {
    // Ensure cache directory exists
    await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });

    // Save master fallback
    await fs.writeFile(
      CONFIG.FALLBACK_FILE,
      JSON.stringify(secrets, null, 2),
      'utf8'
    );

    // Save individual service caches
    if (secrets.services) {
      for (const [service, config] of Object.entries(secrets.services)) {
        const cachePath = path.join(CONFIG.CACHE_DIR, `${service}.json`);
        await fs.writeFile(
          cachePath,
          JSON.stringify({ [service]: config, _synced_at: secrets._synced_at }, null, 2),
          'utf8'
        );
      }
    }

    // Save database creds
    if (secrets.database) {
      await fs.writeFile(
        path.join(CONFIG.CACHE_DIR, 'database.json'),
        JSON.stringify({ database: secrets.database, _synced_at: secrets._synced_at }, null, 2),
        'utf8'
      );
    }

    log(`✓ Saved ${Object.keys(secrets.services || {}).length} service configs to cache`);
  } catch (err) {
    logError('Failed to save to cache', err);
  }
}

/**
 * Sync secrets from vault to local cache
 */
async function syncSecrets() {
  try {
    const secrets = await fetchFromVault();
    
    if (!secrets) {
      syncFailures++;
      log(`⚠ Sync failed (${syncFailures} consecutive failures)`);
      
      // If too many failures, use cached secrets
      if (syncFailures >= 6) { // 6 failures = 1 minute
        log('⚠ Too many failures, falling back to cached secrets');
        cachedSecrets = await loadFallback();
      }
      return;
    }

    // Sync successful
    syncFailures = 0;
    cachedSecrets = secrets;
    lastSyncTime = new Date();
    
    await saveToCache(secrets);
    log(`✓ Synced ${Object.keys(secrets.services || {}).length} services at ${lastSyncTime.toISOString()}`);
    
  } catch (err) {
    syncFailures++;
    logError('Sync error', err);
  }
}

/**
 * Start sync loop
 */
async function startSyncLoop() {
  log(`Starting secrets sync (interval: ${CONFIG.SYNC_INTERVAL}ms)`);
  
  // Initial sync
  await syncSecrets();
  
  // Periodic sync
  setInterval(async () => {
    await syncSecrets();
  }, CONFIG.SYNC_INTERVAL);
}

/**
 * Logging helpers
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} [INFO] ${message}\n`;
  console.log(logLine.trim());
  appendLog(logLine);
}

function logError(message, err) {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} [ERROR] ${message}: ${err?.message || err}\n`;
  console.error(logLine.trim());
  appendLog(logLine);
}

async function appendLog(line) {
  try {
    await fs.mkdir(path.dirname(CONFIG.LOG_FILE), { recursive: true });
    await fs.appendFile(CONFIG.LOG_FILE, line);
  } catch (err) {
    // Ignore log write errors
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  log('Shutting down secrets sync agent...');
  if (redisClient) {
    await redisClient.quit();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Main
 */
async function main() {
  log('=== MigraHosting Secrets Sync Agent ===');
  
  const connected = await initRedis();
  
  if (!connected) {
    log('⚠ Redis unavailable, using fallback mode');
    cachedSecrets = await loadFallback();
  }
  
  await startSyncLoop();
}

main().catch((err) => {
  logError('Fatal error', err);
  process.exit(1);
});
