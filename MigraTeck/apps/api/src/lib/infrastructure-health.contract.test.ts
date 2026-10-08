import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workerStateForAge } from "./infrastructure-health.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("worker heartbeat classification is fail-closed", () => {
  assert.equal(workerStateForAge(0, 45), "healthy");
  assert.equal(workerStateForAge(45, 45), "healthy");
  assert.equal(workerStateForAge(46, 45), "stale");
  assert.equal(workerStateForAge(null, 45), "stale");
});

test("infrastructure health requires MigraAuth platform-operator authority", () => {
  const route = repoFile("apps/api/src/routes/v1/modules/infrastructure.ts");
  assert.match(route, /requirePlatformAuthority\(request, \[\s*"platform\.self\.read"/);
  assert.doesNotMatch(route, /requireOrganizationPrincipal/);
});

test("all background workers publish or consume dedicated heartbeat paths", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const webhook = repoFile("apps/api/src/webhook-worker.ts");
  const social = repoFile("apps/api/src/social-connection-sync-worker.ts");
  const socialUnit = repoFile("deploy/migrateck-social-sync-worker.service");

  for (const fragment of [
    "/run/migrateck-provisioning/heartbeat.json",
    "/run/migrateck-entitlement-expiry/heartbeat.json",
    "/run/migrateck-usage/heartbeat.json",
    "/run/migrateck-social-sync/heartbeat.json",
    "/run/migrateck-webhook/heartbeat.json",
  ]) {
    assert.ok(health.includes(fragment), fragment);
  }

  assert.match(webhook, /WEBHOOK_WORKER_HEARTBEAT_FILE/);
  assert.match(webhook, /lastSeenAt/);
  assert.match(webhook, /removeHeartbeat/);

  assert.match(social, /SOCIAL_CONNECTION_SYNC_HEARTBEAT_FILE/);
  assert.match(social, /lastSeenAt/);
  assert.match(social, /removeHeartbeat/);
  assert.match(socialUnit, /dist\/social-connection-sync-worker\.js/);
  assert.match(socialUnit, /RuntimeDirectory=migrateck-social-sync/);
});

test("usage health reads the real UsageEvent export lifecycle", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  assert.match(health, /FROM "UsageEvent"/);
  assert.match(health, /"exportStatus"='PENDING_EXPORT'/);
  assert.match(health, /"exportStatus"='RUNNING'/);
  assert.match(health, /"exportStatus"='RETRY'/);
  assert.match(health, /"exportStatus"='FAILED'/);
  assert.doesNotMatch(health, /UsageExportJob/);
});


test("social infrastructure health includes uncredentialed reconnect-required connections", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  assert.match(health, /FROM "MigraMarketSocialConnection"/);
  assert.match(health, /"credentialCiphertext" IS NULL/);
  assert.match(health, /"missingCredentialReconnect"/);
  assert.match(health, /missingCredentialReconnect/);
  assert.match(health, /socialConnectionHealth/);
});
