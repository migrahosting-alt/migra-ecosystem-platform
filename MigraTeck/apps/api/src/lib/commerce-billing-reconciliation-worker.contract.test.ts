import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const billing = repoFile("apps/api/src/lib/commerce-billing.ts");
const worker = repoFile("apps/api/src/billing-reconciliation-worker.ts");
const unit = repoFile("deploy/migrateck-billing-reconciliation-worker.service");
const packageJson = repoFile("apps/api/package.json");

test("reconciliation safety net selects only stale mapped Stripe organizations and bounds work", () => {
  assert.match(billing, /state\."lastSyncedAt" IS NULL/);
  assert.match(billing, /INTERVAL \\'1 millisecond\\'/);
  assert.match(billing, /Math\.min\(50, Math\.max\(1/);
  assert.match(billing, /15 \* 60_000/);
  assert.match(billing, /LIMIT \$2/);
});

test("worker reconciliation is serialized per Stripe customer and never impersonates an operator", () => {
  assert.match(billing, /migrateck:stripe-customer:/);
  assert.match(billing, /pg_try_advisory_lock/);
  assert.match(billing, /source: "reconciliation_worker"/);
  assert.match(billing, /else if \(input\.source === "operator"\)/);
  assert.doesNotMatch(worker, /actorId|operationId/);
});

test("canonical webhooks share the same customer lock as the reconciliation worker", () => {
  assert.match(
    billing,
    /processCanonicalStripeWebhookEvent[\s\S]*?customerLockKey =\s*"migrateck:stripe-customer:" \+ customerId/,
  );
  assert.match(
    billing,
    /customerLockKey[\s\S]*?pg_advisory_unlock\(hashtext\(\$1\)\)/,
  );
});

test("worker heartbeat is atomic, bounded, and secret-free", () => {
  assert.match(worker, /heartbeat\.json/);
  assert.match(worker, /writeFile\(temporary/);
  assert.match(worker, /rename\(temporary, path\)/);
  assert.match(worker, /unlink\(heartbeatFile\(\)\)/);
  assert.match(worker, /BILLING_RECONCILIATION_POLL_INTERVAL_MS/);
  assert.match(worker, /BILLING_RECONCILIATION_MIN_SYNC_AGE_MS/);
  assert.match(worker, /BILLING_RECONCILIATION_BATCH_SIZE/);
  assert.doesNotMatch(
    worker,
    /STRIPE_SECRET_KEY.*JSON|stringify.*STRIPE_SECRET_KEY/,
  );
});

test("worker deployment is managed and hardened", () => {
  assert.match(packageJson, /start:billing-reconciliation-worker/);
  assert.match(
    unit,
    /ExecStart=\/usr\/bin\/node dist\/billing-reconciliation-worker\.js/,
  );
  assert.match(unit, /Restart=always/);
  assert.match(unit, /RuntimeDirectory=migrateck-billing-reconcile/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=full/);
});
