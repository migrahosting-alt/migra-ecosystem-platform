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

test("billing customer initialization is narrow-authority, idempotent, ownership-safe and audited", () => {
  assert.match(
    routes,
    /organizations\/:orgId\/customer[\s\S]*?"platform\.commerce\.billing\.manage"/,
  );
  assert.match(routes, /initializeCustomerSchema[\s\S]*?mode: z\.literal\("create"\)/);
  assert.match(routes, /billingEmail: z\.string\(\)\.trim\(\)\.email\(\)/);
  assert.match(routes, /mode: z\.literal\("link_existing"\)/);
  assert.match(routes, /externalCustomerId: z\.string\(\)\.trim\(\)/);

  assert.match(service, /customers\.create\([\s\S]*?org_id: input\.orgId/);
  assert.match(service, /platform: "migrateck"/);
  assert.match(
    service,
    /migrateck-billing-customer-" \+ input\.operationId \+ "-create"/,
  );
  assert.match(
    service,
    /migrateck-billing-customer-" \+ input\.operationId \+ "-link"/,
  );

  assert.match(
    service,
    /Stripe customer metadata belongs to another organization/,
  );
  assert.match(
    service,
    /Stripe customer is already attributed to another platform/,
  );
  assert.match(
    service,
    /Stripe customer is already mapped to another organization/,
  );
  assert.match(service, /pg_advisory_lock\(hashtext\(\$1\)\)/);
  assert.match(service, /migrateck:billing-org:/);
  assert.match(service, /migrateck:billing-customer:/);
  assert.match(service, /pg_advisory_unlock\(hashtext\(\$1\)\)/);
  assert.match(service, /FOR UPDATE/);
  assert.match(
    service,
    /INSERT INTO "BillingCustomer"[\s\S]*?INSERT INTO "BillingOrgState"[\s\S]*?INSERT INTO "AuditLog"[\s\S]*?COMMIT/,
  );
  assert.match(service, /BILLING_CUSTOMER_OPERATOR_CREATED/);
  assert.match(service, /BILLING_CUSTOMER_OPERATOR_LINKED/);
  assert.match(service, /previousOperationId === input\.operationId/);
  assert.match(service, /operationId: input\.operationId/);
  assert.match(service, /reason: input\.reason/);
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

test("scheduled subscription cancellation can be reversed without bypassing operator safeguards", () => {
  const operatorUi = repoFile(
    "apps/web/src/app/(platform)/platform/billing/BillingOperationsWorkspace.tsx",
  );

  assert.match(
    routes,
    /subscriptionActionSchema[\s\S]*?"cancel_at_period_end"[\s\S]*?"keep_active"[\s\S]*?"cancel_immediate"/,
  );
  assert.match(service, /\| "keep_active"/);
  assert.match(
    service,
    /input\.action === "keep_active" && !before\.cancel_at_period_end/,
  );
  assert.match(
    service,
    /Subscription does not have a scheduled cancellation to undo\./,
  );
  assert.match(
    service,
    /case "keep_active":[\s\S]*?cancel_at_period_end: false/,
  );
  assert.match(
    service,
    /"migrateck-billing-" \+ input\.operationId \+ "-" \+ input\.action/,
  );

  assert.match(
    operatorUi,
    /subscription\.cancelAtPeriodEnd \? \([\s\S]*?label="Keep active"[\s\S]*?openAction\(subscription, "keep_active"\)/,
  );
  assert.match(
    operatorUi,
    /Remove the scheduled cancellation and keep this subscription active\?/,
  );
});

test("processor action local update and audit commit atomically", () => {
  assert.match(
    service,
    /const localTx = await db\.connect\(\);[\s\S]*?BEGIN[\s\S]*?UPDATE "BillingSubscription"[\s\S]*?INSERT INTO "AuditLog"[\s\S]*?COMMIT/,
  );
  assert.match(service, /ROLLBACK/);
  assert.match(service, /BILLING_SUBSCRIPTION_OPERATOR_ACTION/);
});

test("billing overview defaults to commercial accounts and opens the full directory only on explicit search", () => {
  const operatorUi = repoFile(
    "apps/web/src/app/(platform)/platform/billing/BillingOperationsWorkspace.tsx",
  );

  assert.match(service, /directoryOrganizations/);
  assert.match(service, /commercialOrganizations/);
  assert.match(service, /organizationScope: normalized \? "directory_search" : "commercial_accounts"/);
  assert.ok(
    service.includes("$1='' AND (c.id IS NOT NULL OR state.\\\"orgId\\\" IS NOT NULL"),
  );
  assert.ok(
    service.includes('EXISTS (SELECT 1 FROM \\\"BillingSubscription\\\" scoped_subscription'),
  );
  assert.ok(
    service.includes('EXISTS (SELECT 1 FROM \\\"BillingInvoice\\\" scoped_invoice'),
  );
  assert.ok(
    service.includes("$1<>'' AND (position(lower($1) in lower(o.name))>0"),
  );
  assert.match(operatorUi, /Billing relationships/);
  assert.match(operatorUi, /Directory search/);
  assert.match(operatorUi, /search to find any organization/);
  assert.match(operatorUi, /No billing relationships yet/);
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

test("Stripe event evidence is read-only, authority-scoped, and never exposes raw payloads", () => {
  const operatorUi = repoFile(
    "apps/web/src/app/(platform)/platform/billing/BillingOperationsWorkspace.tsx",
  );
  const webProxy = repoFile(
    "apps/web/src/app/api/platform/commerce/billing/webhook-events/route.ts",
  );

  const webhookRoute = routes.slice(
    routes.indexOf('app.get("/commerce/billing/webhook-events"'),
    routes.indexOf('app.get("/commerce/billing/organizations/:orgId"'),
  );
  const webhookEvidenceService = service.slice(
    service.indexOf("export async function getBillingWebhookEventEvidence"),
    service.indexOf("export async function getOrganizationBillingOperations"),
  );

  assert.match(webhookRoute, /platform\.commerce\.read/);
  assert.doesNotMatch(webhookRoute, /platform\.commerce\.billing\.manage/);
  assert.match(webhookEvidenceService, /getBillingWebhookEventEvidence/);
  assert.match(webhookEvidenceService, /payloadJson.*objectId/);
  assert.match(webhookEvidenceService, /payloadJson.*objectType/);
  assert.match(webhookEvidenceService, /payloadJson.*customerId/);
  assert.match(webhookEvidenceService, /BillingEventProjection/);
  assert.match(webhookEvidenceService, /supersededByLaterSync/);
  assert.match(webhookEvidenceService, /state\."lastSyncedAt"/);
  assert.doesNotMatch(webhookEvidenceService, /rawPayload/);
  assert.doesNotMatch(webhookEvidenceService, /SELECT w\."payloadJson"(?:\s|,|AS)/);

  assert.match(webProxy, /getAppSession/);
  assert.match(webProxy, /platform\.read/);
  assert.match(webProxy, /\/commerce\/billing\/webhook-events/);
  assert.match(operatorUi, /Stripe event evidence/);
  assert.match(operatorUi, /Raw Stripe payloads are never exposed here/);
  assert.match(operatorUi, /no blind replay action/);
  assert.match(operatorUi, /Superseded by later sync/);
  assert.match(operatorUi, /Inspect account/);
  assert.doesNotMatch(operatorUi, /Replay all/i);
});
