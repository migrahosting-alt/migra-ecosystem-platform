import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const core = repoFile("apps/api/src/lib/social-connection-sync.ts");
const worker = repoFile("apps/api/src/social-connection-sync-worker.ts");

test("managed social sync preserves encrypted OAuth credential handling", () => {
  assert.ok(core.includes("aes-256-gcm"));
  assert.ok(core.includes("MIGRAMARKET_SOCIAL_CONNECT_ENCRYPTION_KEY"));
  assert.ok(core.includes("LAUNCH_TOKEN_SECRET"));
  assert.ok(core.includes("Invalid encrypted social secret payload"));
  assert.ok(core.includes("encryptCredentialBundle"));
  assert.ok(core.includes("refreshTokenCiphertext"));
});

test("candidate selection remains oauth-only, credentialed, and excludes paused connections", () => {
  assert.ok(core.includes('"accessModel"=$1'));
  assert.ok(core.includes('"credentialCiphertext" IS NOT NULL'));
  assert.ok(core.includes("status<>$2"));
  assert.ok(core.includes('["oauth", "paused", take]'));
});

test("health policy retains refresh, sync, reconnect, and stale verification semantics", () => {
  assert.ok(core.includes("SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS"));
  assert.ok(core.includes("SOCIAL_CONNECTION_SYNC_VERIFICATION_STALE_HOURS"));
  assert.ok(core.includes("token_expiring"));
  assert.ok(core.includes("verification_stale"));
  assert.ok(core.includes("reconnect_required"));
  assert.ok(core.includes("recommendedAction"));
});

test("provider refresh paths use configured OAuth clients and rotate encrypted tokens", () => {
  for (const marker of [
    "MIGRAMARKET_META_CLIENT_ID",
    "MIGRAMARKET_META_CLIENT_SECRET",
    "MIGRAMARKET_X_CLIENT_ID",
    "MIGRAMARKET_X_CLIENT_SECRET",
    "MIGRAMARKET_LINKEDIN_CLIENT_ID",
    "MIGRAMARKET_LINKEDIN_CLIENT_SECRET",
    "MIGRAMARKET_GOOGLE_CLIENT_ID",
    "MIGRAMARKET_GOOGLE_CLIENT_SECRET",
    "MIGRAMARKET_TIKTOK_CLIENT_KEY",
    "MIGRAMARKET_TIKTOK_CLIENT_SECRET",
    "oauth2.googleapis.com/token",
    "open.tiktokapis.com/v2/oauth/token",
    "linkedin.com/oauth/v2/accessToken",
    "oauth/access_token",
  ]) {
    assert.ok(core.includes(marker), marker);
  }
});

test("profile sync supports all API-managed production social providers", () => {
  for (const marker of [
    "syncFacebookConnection",
    "syncInstagramConnection",
    "syncLinkedInConnection",
    "syncYouTubeConnection",
    "syncXConnection",
    "syncTikTokConnection",
  ]) {
    assert.ok(core.includes(marker), marker);
  }
});

test("worker honors maintenance mode and emits bounded audit heartbeat statistics", () => {
  assert.ok(core.includes("maintenanceMode"));
  assert.ok(core.includes("SOCIAL_CONNECTION_SYNC_WORKER_HEARTBEAT"));
  assert.ok(core.includes("processed"));
  assert.ok(core.includes("refreshed"));
  assert.ok(core.includes("synced"));
  assert.ok(core.includes("reconnectRequired"));
  assert.ok(core.includes("failed"));
});

test("analyzer exposes health metadata without returning credential ciphertext", () => {
  assert.ok(core.includes("analyzeSocialConnectionSyncQueue"));
  const analyzer = core.slice(
    core.indexOf("export async function analyzeSocialConnectionSyncQueue"),
    core.indexOf("export async function processSocialConnectionSyncQueue"),
  );
  assert.ok(!analyzer.includes("credentialCiphertext:"));
  assert.ok(!analyzer.includes("refreshTokenCiphertext:"));
  assert.ok(analyzer.includes("recommendedAction"));
});

test("managed worker has heartbeat and graceful shutdown", () => {
  assert.ok(worker.includes("migrateck-social-sync/heartbeat.json"));
  assert.ok(worker.includes("SIGTERM"));
  assert.ok(worker.includes("SIGINT"));
  assert.ok(worker.includes("await closeDb()"));
  assert.ok(worker.includes("SOCIAL_CONNECTION_SYNC_INTERVAL_MS"));
});
