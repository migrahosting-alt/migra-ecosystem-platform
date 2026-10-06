import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getEntitlementTransitionAvailability,
  type ProvisioningWorkerStatus,
} from "./commerce-entitlements.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const readyWorker: ProvisioningWorkerStatus = {
  ready: true,
  workerId: "test-worker",
  pid: 1234,
  lastSeenAt: new Date().toISOString(),
  ageMs: 0,
  reason: null,
};

const downWorker: ProvisioningWorkerStatus = {
  ready: false,
  workerId: null,
  pid: null,
  lastSeenAt: null,
  ageMs: null,
  reason: "worker unavailable",
};

test("database-only entitlement transitions do not depend on worker availability", async () => {
  const result = await getEntitlementTransitionAvailability({
    orgSlug: "customer-acme",
    product: "MIGRAINVOICE",
    previousStatus: "RESTRICTED",
    newStatus: "ACTIVE",
    worker: downWorker,
  });

  assert.equal(result.available, true);
  assert.equal(result.mode, "database_only");
  assert.deepEqual(result.actions, []);
});

test("provisioning transitions fail closed when the managed worker is unavailable", async () => {
  const result = await getEntitlementTransitionAvailability({
    orgSlug: "customer-acme",
    product: "MIGRAHOSTING",
    previousStatus: "RESTRICTED",
    newStatus: "ACTIVE",
    worker: downWorker,
  });

  assert.equal(result.available, false);
  assert.equal(result.mode, "blocked");
  assert.deepEqual(result.actions, ["POD_CREATE", "DNS_PROVISION"]);
  assert.match(result.reason ?? "", /worker unavailable/i);
});

test("MigraHosting activation exposes required context only when dispatchers are configured", async () => {
  const previous = {
    MIGRAHOSTING_AGENT_URL: process.env.MIGRAHOSTING_AGENT_URL,
    MIGRAHOSTING_AGENT_KEY_ID: process.env.MIGRAHOSTING_AGENT_KEY_ID,
    MIGRAHOSTING_AGENT_SECRET: process.env.MIGRAHOSTING_AGENT_SECRET,
    MIGRAPANEL_EDGE_URL: process.env.MIGRAPANEL_EDGE_URL,
    MIGRAPANEL_EDGE_TOKEN: process.env.MIGRAPANEL_EDGE_TOKEN,
  };

  process.env.MIGRAHOSTING_AGENT_URL = "https://hosting-agent.invalid";
  process.env.MIGRAHOSTING_AGENT_KEY_ID = "test-key";
  process.env.MIGRAHOSTING_AGENT_SECRET = "test-secret";
  process.env.MIGRAPANEL_EDGE_URL = "https://edge.invalid";
  process.env.MIGRAPANEL_EDGE_TOKEN = "test-token";

  try {
    const result = await getEntitlementTransitionAvailability({
      orgSlug: "customer-acme",
      product: "MIGRAHOSTING",
      previousStatus: "RESTRICTED",
      newStatus: "ACTIVE",
      worker: readyWorker,
    });

    assert.equal(result.available, true);
    assert.equal(result.mode, "provisioning");
    assert.deepEqual(result.actions, ["POD_CREATE", "DNS_PROVISION"]);
    assert.deepEqual(
      new Set(result.requiredFields),
      new Set(["domain", "tenantId", "serviceInstanceId", "targetIp"]),
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("manual MigraMail activation remains blocked until secret transport is safe", async () => {
  const result = await getEntitlementTransitionAvailability({
    orgSlug: "customer-acme",
    product: "MIGRAMAIL",
    previousStatus: "RESTRICTED",
    newStatus: "ACTIVE",
    worker: readyWorker,
  });

  assert.equal(result.available, false);
  assert.equal(result.mode, "blocked");
  assert.deepEqual(result.actions, ["MAIL_PROVISION"]);
  assert.match(result.reason ?? "", /encrypted async secret transport/i);
});

test("internal Migra organizations skip customer pod creation but still require DNS provisioning", async () => {
  const previous = {
    MIGRAPANEL_EDGE_URL: process.env.MIGRAPANEL_EDGE_URL,
    MIGRAPANEL_EDGE_TOKEN: process.env.MIGRAPANEL_EDGE_TOKEN,
  };
  process.env.MIGRAPANEL_EDGE_URL = "https://edge.invalid";
  process.env.MIGRAPANEL_EDGE_TOKEN = "test-token";

  try {
    const result = await getEntitlementTransitionAvailability({
      orgSlug: "migrateck",
      product: "MIGRAHOSTING",
      previousStatus: "RESTRICTED",
      newStatus: "ACTIVE",
      worker: readyWorker,
    });

    assert.equal(result.available, true);
    assert.deepEqual(result.actions, ["DNS_PROVISION"]);
    assert.deepEqual(new Set(result.requiredFields), new Set(["domain", "targetIp"]));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("entitlement mutation contract is concurrency-safe, billing-aware, atomic, signed and audited", () => {
  const source = repoFile("apps/api/src/lib/commerce-entitlements.ts");
  const routes = repoFile("apps/api/src/routes/v1/modules/commerce-catalog.ts");

  assert.match(routes, /platform\.commerce\.entitlements\.manage/);
  assert.match(routes, /expectedUpdatedAt/);
  assert.match(routes, /acknowledgeBillingOverride/);

  assert.match(source, /FOR UPDATE/);
  assert.match(source, /expected !== actual/);
  assert.match(source, /Entitlement changed since it was loaded/);
  assert.match(source, /isStripeEvidence\(current\.notes\)/);
  assert.match(source, /Explicitly acknowledge the manual billing override/);

  assert.match(source, /signProvisioningEnvelope/);
  assert.match(source, /hashCanonicalPayload/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /ProvisioningJobEvent/);

  assert.match(source, /ORG_ENTITLEMENT_MANUAL_UPDATE/);
  assert.match(source, /billingOverrideAcknowledged/);
  assert.match(source, /await client\.query\("COMMIT"\)/);
  assert.match(source, /await client\.query\("ROLLBACK"\)/);
});
