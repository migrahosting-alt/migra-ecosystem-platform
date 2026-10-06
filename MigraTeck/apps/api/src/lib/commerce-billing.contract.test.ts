import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/commerce-billing.ts");
const routes = repoFile(
  "apps/api/src/routes/v1/modules/commerce-billing.ts",
);

test("MigraPay operator reads use platform commerce authority", () => {
  assert.match(
    routes,
    /requirePlatformAuthority\(request, \[\s*"platform\.commerce\.read"/,
  );
  assert.doesNotMatch(routes, /requireOrganizationPrincipal/);
});

test("billing mutations use narrow billing authority and reasoned operation contracts", () => {
  assert.match(
    routes,
    /reconcile[\s\S]*?"platform\.commerce\.billing\.manage"/,
  );
  assert.match(
    routes,
    /subscriptions\/:subscriptionId\/action[\s\S]*?"platform\.commerce\.billing\.manage"/,
  );
  assert.doesNotMatch(
    routes,
    /reconcile[\s\S]*?"platform\.commerce\.catalog\.manage"/,
  );
  assert.match(routes, /reconcileSchema[\s\S]*?operationId: z\.string\(\)\.uuid\(\)/);
  assert.match(routes, /reason: z\.string\(\)\.trim\(\)\.min\(3\)/);
  assert.match(routes, /expectedUpdatedAt/);
});

test("operator service uses deployed ledger tables instead of future billing-core adapter", () => {
  for (const table of [
    "BillingCustomer",
    "BillingSubscription",
    "BillingInvoice",
    "BillingOrgState",
    "BillingTaxProfile",
    "BillingWebhookEvent",
    "BillingEventProjection",
  ]) {
    assert.match(service, new RegExp(table));
  }

  assert.doesNotMatch(service, /createBillingContext/);
  assert.doesNotMatch(service, /__billingDb/);
});

test("reconciliation is idempotent on processor identifiers and audit-rich", () => {
  assert.match(
    service,
    /ON CONFLICT \("externalSubscriptionId"\) DO UPDATE/,
  );
  assert.match(
    service,
    /ON CONFLICT \("stripeInvoiceId"\) DO UPDATE/,
  );
  assert.match(service, /ON CONFLICT \("orgId"\) DO UPDATE/);
  assert.match(service, /BILLING_RECONCILED/);
  assert.match(service, /operationId: input\.operationId/);
  assert.match(service, /reason: input\.reason/);
  assert.match(service, /input\.ip \?\? null/);
  assert.match(service, /input\.userAgent \?\? null/);
});

test("processor pagination is complete-or-explicitly-incomplete before reconciliation", () => {
  assert.match(service, /loadAllSubscriptions/);
  assert.match(service, /loadAllInvoices/);
  assert.match(service, /loadAllPaymentMethods/);
  assert.match(service, /completeness\.subscriptions/);
  assert.match(service, /completeness\.invoices/);
  assert.match(
    service,
    /Stripe history exceeds the safe reconciliation window/,
  );
  assert.match(service, /const healthy = complete/);
});

test("subscription actions verify tenant ownership in both local and Stripe state", () => {
  assert.match(
    service,
    /WHERE s\.id=\$1 AND s\."orgId"=\$2 LIMIT 1/,
  );
  assert.match(service, /mappedCustomerId/);
  assert.match(
    service,
    /Stripe subscription does not belong to this organization/,
  );
  assert.match(
    service,
    /Subscription changed since it was loaded\. Refresh before acting\./,
  );
  assert.match(
    service,
    /"migrateck-billing-" \+ input\.operationId \+ "-" \+ input\.action/,
  );
  assert.match(service, /operationId: input\.operationId/);
});

test("processor action local update and audit commit atomically", () => {
  assert.match(
    service,
    /const localTx = await db\.connect\(\);[\s\S]*?BEGIN[\s\S]*?UPDATE "BillingSubscription"[\s\S]*?INSERT INTO "AuditLog"[\s\S]*?COMMIT/,
  );
  assert.match(service, /ROLLBACK/);
  assert.match(service, /BILLING_SUBSCRIPTION_OPERATOR_ACTION/);
});

test("overview outstanding balance does not use DISTINCT amounts", () => {
  assert.doesNotMatch(service, /sum\(DISTINCT/);
  assert.ok(
    service.includes('sum(i.\\"amountRemaining\\")'),
    "organization outstanding balance must sum every invoice row",
  );
});

test("payment method output is card-safe metadata only", () => {
  assert.match(service, /brand: method\.card\?\.brand/);
  assert.match(service, /last4: method\.card\?\.last4/);
  assert.doesNotMatch(service, /card\.number/);
  assert.doesNotMatch(service, /cvc/);
});
