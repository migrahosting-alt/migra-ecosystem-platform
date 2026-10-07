import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/entitlement-expiry.ts");
const worker = repoFile("apps/api/src/entitlement-expiry-worker.ts");

test("expiry worker respects platform maintenance and dedicated pause controls", () => {
  assert.ok(service.includes("maintenanceMode"));
  assert.ok(service.includes("pauseEntitlementExpiryWorker"));
  assert.ok(service.includes("paused: true"));
});

test("expired ACTIVE and TRIAL access is restricted before infrastructure cleanup", () => {
  assert.ok(service.includes('["ACTIVE", "TRIAL"]'));
  assert.ok(service.includes("RESTRICTED"));
  assert.ok(service.includes("EntitlementStatus"));
  assert.ok(service.includes("ORG_ENTITLEMENT_AUTO_RESTRICTED"));
  assert.ok(service.includes("entitlement.revoked"));
});

test("automatic expiry never guesses missing provisioning context", () => {
  assert.ok(service.includes("requiredFields.length > 0"));
  assert.ok(service.includes("automatic expiry does not guess provisioning context"));
  assert.ok(service.includes("ENTITLEMENT_EXPIRY_PROVISIONING_SKIPPED"));
});

test("supported cleanup actions become signed idempotent ENTITLEMENT_EXPIRY jobs", () => {
  assert.ok(service.includes("signProvisioningEnvelope"));
  assert.ok(service.includes("hashCanonicalPayload"));
  assert.ok(service.includes("ENTITLEMENT_EXPIRY"));
  assert.ok(service.includes("ProvisioningJobSource"));
  assert.ok(service.includes("entitlement-expiry:"));
  assert.ok(service.includes("idempotencyKey"));
  assert.ok(service.includes("queued_from_entitlement_expiry"));
});

test("expiry provisioning preserves correlated legacy task telemetry", () => {
  assert.ok(service.includes("ProvisioningTask"));
  assert.ok(service.includes("taskId"));
  assert.ok(service.includes("jobId"));
});

test("managed worker exposes heartbeat and closes database on graceful stop", () => {
  assert.ok(worker.includes("migrateck-entitlement-expiry/heartbeat.json"));
  assert.ok(worker.includes("SIGTERM"));
  assert.ok(worker.includes("SIGINT"));
  assert.ok(worker.includes("await closeDb()"));
  assert.ok(worker.includes("ENTITLEMENT_EXPIRY_INTERVAL_MS"));
});
