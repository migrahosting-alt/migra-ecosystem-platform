import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  commerceAuditFamily,
  sanitizeCommerceAuditMetadata,
} from "./commerce-audit.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/commerce-audit.ts");
const routes = repoFile("apps/api/src/routes/v1/modules/commerce-audit.ts");
const registry = repoFile("apps/api/src/routes/v1/index.ts");

test("commerce audit metadata is allowlisted and strips secret-bearing keys", () => {
  const sanitized = sanitizeCommerceAuditMetadata({
    operationId: "op-123",
    reason: "operator reconciliation",
    status: "ACTIVE",
    counts: { products: 9, plans: 28 },
    password: "do-not-expose",
    apiKey: "do-not-expose",
    token: "do-not-expose",
    rawPayload: { secret: "do-not-expose" },
    randomField: "not-allowlisted",
  });

  assert.equal(sanitized.operationId, "op-123");
  assert.equal(sanitized.reason, "operator reconciliation");
  assert.equal(sanitized.status, "ACTIVE");
  assert.deepEqual(sanitized.counts, { products: 9, plans: 28 });
  assert.equal("password" in sanitized, false);
  assert.equal("apiKey" in sanitized, false);
  assert.equal("token" in sanitized, false);
  assert.equal("rawPayload" in sanitized, false);
  assert.equal("randomField" in sanitized, false);
});

test("commerce action families are deterministic", () => {
  assert.equal(commerceAuditFamily("BILLING_RECONCILED"), "billing");
  assert.equal(
    commerceAuditFamily("ORG_ENTITLEMENT_RECONCILED"),
    "entitlement",
  );
  assert.equal(commerceAuditFamily("ENTITLEMENT_ENFORCED"), "entitlement");
  assert.equal(commerceAuditFamily("PROVISIONING_JOB_QUEUED"), "provisioning");
  assert.equal(
    commerceAuditFamily("REVENUE_PROVISION_HANDOFF_ACCEPTED"),
    "revenue",
  );
  assert.equal(commerceAuditFamily("USAGE_EVENT_RECORDED"), "usage");
});

test("commerce audit excludes heartbeat noise and bounds pagination", () => {
  assert.match(service, /PROVISIONING_WORKER_HEARTBEAT/);
  assert.match(service, /ENTITLEMENT_EXPIRY_WORKER_HEARTBEAT/);
  assert.match(service, /Math\.min\(100, Math\.max\(1/);
  assert.match(service, /Math\.min\(1_000_000, Math\.max\(0/);
  assert.match(service, /ORDER BY a\."createdAt" DESC,a\.id DESC/);
});

test("commerce audit is read-only and platform-commerce scoped", () => {
  assert.match(
    routes,
    /app\.get\("\/commerce\/audit"[\s\S]*?platform\.commerce\.read/,
  );
  assert.doesNotMatch(
    routes,
    /app\.(post|patch|put|delete)\("\/commerce\/audit/,
  );
  assert.match(registry, /registerCommerceAuditRoutes/);
});

test("commerce audit searches server-side over action, entity and organization evidence", () => {
  assert.match(service, /a\.action ILIKE/);
  assert.match(service, /a\."entityType" ILIKE/);
  assert.match(service, /a\."entityId" ILIKE/);
  assert.match(service, /COALESCE\(o\.name,''\) ILIKE/);
  assert.match(service, /COALESCE\(o\.slug,''\) ILIKE/);
});
