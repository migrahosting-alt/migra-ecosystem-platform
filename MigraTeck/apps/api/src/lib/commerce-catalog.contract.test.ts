import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_CATALOG } from "@migrateck/billing-core/catalog";
import { ENTITLEMENT_STATUSES, PRODUCT_KEYS } from "./commerce-catalog.js";
import { getEntitlementTransitionAvailability } from "./commerce-entitlements.js";
import { classifyProvisioningDrift } from "./provisioning-drift.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const routes = repoFile("apps/api/src/routes/v1/modules/commerce-catalog.ts");
const authority = repoFile("apps/api/src/lib/migraauth.ts");
const webProxy = repoFile("apps/web/src/lib/auth/api.ts");

test("canonical commerce catalog has no retired Student plan", () => {
  const planCodes = PRODUCT_CATALOG.flatMap((product) =>
    product.plans.map((plan) => plan.planCode.toLowerCase()),
  );
  const planNames = PRODUCT_CATALOG.flatMap((product) =>
    product.plans.map((plan) => plan.name.toLowerCase()),
  );

  assert.ok(!planCodes.includes("student"));
  assert.ok(!planNames.includes("student"));
});

test("every canonical billing family maps into a known product access lane", () => {
  const knownFamilies = new Set([
    "builder",
    "hosting",
    "intake",
    "invoice",
    "voice",
    "email",
    "marketing",
    "pilot",
    "drive",
  ]);

  for (const product of PRODUCT_CATALOG) {
    assert.ok(
      knownFamilies.has(product.productFamily),
      `unmapped catalog family: ${product.productFamily}`,
    );
  }

  assert.ok(PRODUCT_KEYS.includes("MIGRABUILDER"));
  assert.ok(PRODUCT_KEYS.includes("MIGRADRIVE"));
});

test("effective entitlement statuses are explicit and closed", () => {
  assert.deepEqual([...ENTITLEMENT_STATUSES], [
    "ACTIVE",
    "TRIAL",
    "RESTRICTED",
    "INTERNAL_ONLY",
  ]);
});

test("commerce reads require platform operator authority, not organization headers", () => {
  assert.match(routes, /requirePlatformAuthority\(request, \[\s*"platform\.commerce\.read"/);
  assert.doesNotMatch(routes, /requireOrganizationPrincipal/);
  assert.match(authority, /authFetchPlatformAuthority\(token\)/);
  assert.match(authority, /authority\.user_id !== me\.user\.id/);
  assert.match(webProxy, /export async function fetchPlatformAuthorityApi/);
});

test("global Stripe binding mutation is catalog-manage only and audited", () => {
  assert.match(
    routes,
    /app\.put\("\/commerce\/bindings\/:externalPriceId"[\s\S]*?"platform\.commerce\.catalog\.manage"/,
  );
  const model = repoFile("apps/api/src/lib/commerce-catalog.ts");
  assert.match(model, /BILLING_BINDING_UPDATED/);
  assert.match(model, /BILLING_BINDING_CREATED/);
  assert.match(model, /INSERT INTO "AuditLog"/);
});

test("catalog snapshot exposes global provisioning health and dead-letter evidence", () => {
  const model = repoFile("apps/api/src/lib/commerce-catalog.ts");
  const workspace = repoFile(
    "apps/web/src/app/(platform)/platform/commerce/catalog/CatalogEntitlementsWorkspace.tsx",
  );

  assert.match(model, /ProvisioningJobStatus/);
  assert.match(model, /deadProvisioningJobs/);
  assert.match(model, /provisioningPending/);
  assert.match(model, /provisioningRunning/);
  assert.match(model, /provisioningSucceeded/);
  assert.match(model, /provisioningDead/);

  assert.match(workspace, /Queue & dead-letter evidence/);
  assert.match(workspace, /Worker healthy/);
  assert.match(workspace, /blind replay/);
  assert.doesNotMatch(workspace, /Retry all dead/i);
});

test("historical dead letters are reconciled against current access before operator action", () => {
  const model = repoFile("apps/api/src/lib/commerce-catalog.ts");
  const driftModel = repoFile("apps/api/src/lib/provisioning-drift.ts");
  const healthModel = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const workspace = repoFile(
    "apps/web/src/app/(platform)/platform/commerce/catalog/CatalogEntitlementsWorkspace.tsx",
  );

  assert.match(model, /getProvisioningDriftSnapshot/);
  assert.match(healthModel, /getProvisioningDriftSnapshot/);
  assert.match(driftModel, /WITH dead AS/);
  assert.match(driftModel, /success AS/);
  assert.match(driftModel, /REVENUE_PROVISION_HANDOFF_ACCEPTED/);
  assert.match(driftModel, /"provenanceTenantId"/);
  assert.match(driftModel, /active_access_needs_verification/);
  assert.match(driftModel, /synthetic_test_data/);
  assert.match(driftModel, /rollout_policy_blocked/);
  assert.match(driftModel, /runtime_link_required/);

  assert.match(workspace, /Historical reconciliation/);
  assert.match(workspace, /Dead provisioning vs current access/);
  assert.match(workspace, /verification queue, not an automatic revoke list/);
  assert.match(workspace, /Test fixture/);
  assert.match(workspace, /Policy blocked/);
  assert.match(workspace, /Runtime link required/);
  assert.match(workspace, /Inspect access/);
  assert.doesNotMatch(workspace, />Revoke all</i);
});

test("provisioning drift separates actionable access from test and rollout-policy evidence", () => {
  const previous = process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST;
  process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST = "MIGRAHOSTING";

  const base = {
    orgId: "org-1",
    orgName: "Example",
    orgSlug: "example",
    product: "MIGRAHOSTING",
    deadJobs: 2,
    latestDeadAt: "2026-04-12T00:00:00.000Z",
    lastDeadError: "missing_hosting_context",
    entitlementStatus: "ACTIVE",
    entitlementUpdatedAt: "2026-04-12T01:00:00.000Z",
    succeededJobs: 0,
    latestSuccessAt: null,
    subscriptionCount: 0,
    provenanceSource: "manual-backend-enable",
    provenanceTenantId: null,
    provenanceMonthlyRevenue: 0,
  };

  try {
    const manual = classifyProvisioningDrift(base);
    assert.equal(manual.classification, "active_access_needs_verification");
    assert.equal(manual.disposition, "runtime_link_required");
    assert.equal(manual.actionable, true);

    const smoke = classifyProvisioningDrift({
      ...base,
      orgId: "org-smoke",
      provenanceSource: "manual-smoke",
    });
    assert.equal(smoke.disposition, "synthetic_test_data");
    assert.equal(smoke.actionable, false);

    const blocked = classifyProvisioningDrift({
      ...base,
      orgId: "org-panel",
      product: "MIGRAPANEL",
      provenanceSource: "migra-market.revenue.close_deal",
      provenanceTenantId: "tenant_old",
      provenanceMonthlyRevenue: 49,
    });
    assert.equal(blocked.disposition, "rollout_policy_blocked");
    assert.equal(blocked.actionable, false);

    const recovered = classifyProvisioningDrift({
      ...base,
      latestSuccessAt: "2026-04-12T02:00:00.000Z",
    });
    assert.equal(recovered.classification, "superseded_by_success");
    assert.equal(recovered.disposition, "later_success");
    assert.equal(recovered.actionable, false);
  } finally {
    if (previous === undefined) {
      delete process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST;
    } else {
      process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST = previous;
    }
  }
});

test("manual entitlement mutation is permission-gated and transition-preflighted", () => {
  assert.match(
    routes,
    /"\/commerce\/organizations\/:orgId\/entitlements\/:product"[\s\S]*?"platform\.commerce\.entitlements\.manage"/,
  );
  assert.match(routes, /mutateOrganizationEntitlement/);

  const model = repoFile("apps/api/src/lib/commerce-entitlements.ts");
  assert.match(model, /SELECT id,name,slug FROM "Organization" WHERE id=\$1 FOR UPDATE/);
  assert.match(model, /FOR UPDATE/);
  assert.match(model, /expectedUpdatedAt/);
  assert.match(model, /Entitlement changed since it was loaded/);
  assert.match(model, /acknowledgeBillingOverride/);
  assert.match(model, /billing-synchronized/);
  assert.match(model, /getEntitlementTransitionAvailability/);
  assert.match(model, /INSERT INTO "ProvisioningTask"/);
  assert.match(model, /INSERT INTO "ProvisioningJob"/);
  assert.match(model, /INSERT INTO "ProvisioningJobEvent"/);
  assert.match(model, /ORG_ENTITLEMENT_MANUAL_UPDATE/);
  assert.match(model, /await client\.query\("COMMIT"\)/);
  assert.match(model, /await client\.query\("ROLLBACK"\)/);
});

test("manual MigraMail password is transient and replaced by an opaque secret reference", () => {
  assert.match(routes, /mailboxPassword/);

  const model = repoFile("apps/api/src/lib/commerce-entitlements.ts");
  assert.match(
    model,
    /const \{ mailboxPassword, \.\.\.persistableContext \} = input\.context/,
  );
  assert.match(model, /createProvisioningSecret\(client/);
  assert.match(model, /mailboxSecretRef/);
  assert.doesNotMatch(
    model,
    /operatorReason: input\.reason,[\s\S]{0,120}\.\.\.input\.context/,
  );
});

test("database-only entitlement lanes remain operable without a worker", async () => {
  const result = await getEntitlementTransitionAvailability({
    orgSlug: "customer-example",
    product: "MIGRAINVOICE",
    previousStatus: "RESTRICTED",
    newStatus: "ACTIVE",
    worker: {
      ready: false,
      workerId: null,
      pid: null,
      lastSeenAt: null,
      ageMs: null,
      reason: "worker intentionally unavailable in contract test",
    },
  });

  assert.equal(result.available, true);
  assert.equal(result.mode, "database_only");
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.requiredFields, []);
});

test("MigraHosting activation requires live worker, configured agents, and full service context", async () => {
  const keys = [
    "MIGRAHOSTING_AGENT_URL",
    "MIGRAHOSTING_AGENT_KEY_ID",
    "MIGRAHOSTING_AGENT_SECRET",
    "MIGRAPANEL_EDGE_URL",
    "MIGRAPANEL_EDGE_TOKEN",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  process.env.MIGRAHOSTING_AGENT_URL = "http://127.0.0.1:4080";
  process.env.MIGRAHOSTING_AGENT_KEY_ID = "contract-key";
  process.env.MIGRAHOSTING_AGENT_SECRET = "contract-secret";
  process.env.MIGRAPANEL_EDGE_URL = "http://127.0.0.1:3200";
  process.env.MIGRAPANEL_EDGE_TOKEN = "contract-token";

  try {
    const result = await getEntitlementTransitionAvailability({
      orgSlug: "customer-example",
      product: "MIGRAHOSTING",
      previousStatus: "RESTRICTED",
      newStatus: "ACTIVE",
      worker: {
        ready: true,
        workerId: "contract-worker",
        pid: 1,
        lastSeenAt: new Date().toISOString(),
        ageMs: 0,
        reason: null,
      },
    });

    assert.equal(result.available, true);
    assert.equal(result.mode, "provisioning");
    assert.deepEqual(result.actions, ["POD_CREATE", "DNS_PROVISION"]);
    assert.deepEqual(
      new Set(result.requiredFields),
      new Set(["domain", "tenantId", "serviceInstanceId", "targetIp"]),
    );
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("unsafe Hosting restriction stays locked until its manual deprovision contract exists", async () => {
  const result = await getEntitlementTransitionAvailability({
    orgSlug: "customer-example",
    product: "MIGRAHOSTING",
    previousStatus: "ACTIVE",
    newStatus: "RESTRICTED",
    worker: {
      ready: true,
      workerId: "contract-worker",
      pid: 1,
      lastSeenAt: new Date().toISOString(),
      ageMs: 0,
      reason: null,
    },
  });

  assert.equal(result.available, false);
  assert.equal(result.mode, "blocked");
  assert.match(result.reason ?? "", /No audited manual provisioning contract/);
});

test("MigraMail activation is secret-safe while restriction can use mailbox identity", async () => {
  const keys = [
    "MIGRAMAIL_CORE_URL",
    "MIGRAMAIL_CORE_API_KEY",
    "PROVISIONING_SECRET_ENCRYPTION_KEY",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.MIGRAMAIL_CORE_URL = "http://127.0.0.1:9080";
  process.env.MIGRAMAIL_CORE_API_KEY = "contract-key";
  process.env.PROVISIONING_SECRET_ENCRYPTION_KEY = "42".repeat(32);

  const worker = {
    ready: true,
    workerId: "contract-worker",
    pid: 1,
    lastSeenAt: new Date().toISOString(),
    ageMs: 0,
    reason: null,
  };

  try {
    const activation = await getEntitlementTransitionAvailability({
      orgSlug: "customer-example",
      product: "MIGRAMAIL",
      previousStatus: "RESTRICTED",
      newStatus: "ACTIVE",
      worker,
    });
    assert.equal(activation.available, true);
    assert.equal(activation.mode, "provisioning");
    assert.deepEqual(activation.actions, ["MAIL_PROVISION"]);
    assert.deepEqual(
      activation.requiredFields,
      ["domain", "mailboxEmail", "mailboxPassword"],
    );
    assert.equal(
      activation.requiredInputs.find((input) => input.key === "mailboxPassword")
        ?.sensitive,
      true,
    );

    const restriction = await getEntitlementTransitionAvailability({
      orgSlug: "customer-example",
      product: "MIGRAMAIL",
      previousStatus: "ACTIVE",
      newStatus: "RESTRICTED",
      worker,
    });
    assert.equal(restriction.available, true);
    assert.equal(restriction.mode, "provisioning");
    assert.deepEqual(restriction.actions, ["MAIL_DISABLE"]);
    assert.deepEqual(restriction.requiredFields, ["mailboxEmail"]);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
