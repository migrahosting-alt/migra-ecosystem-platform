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

  for (const fragment of [
    "/run/migrateck-provisioning/heartbeat.json",
    "/run/migrateck-entitlement-expiry/heartbeat.json",
    "/run/migrateck-usage/heartbeat.json",
    "/run/migrateck-webhook/heartbeat.json",
  ]) {
    assert.ok(health.includes(fragment), fragment);
  }

  assert.match(webhook, /WEBHOOK_WORKER_HEARTBEAT_FILE/);
  assert.match(webhook, /lastSeenAt/);
  assert.match(webhook, /removeHeartbeat/);
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
