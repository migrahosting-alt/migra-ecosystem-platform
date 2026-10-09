import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const billingRoutes = repoFile("apps/api/src/routes/v1/modules/billing.ts");
const billingAdminRoutes = repoFile("apps/api/src/routes/v1/modules/billing-admin.ts");
const routeRegistry = repoFile("apps/api/src/routes/v1/index.ts");

test("billing organization identity comes from MigraAuth, not caller-controlled org headers", () => {
  assert.match(billingRoutes, /requireOrganizationPrincipal/);
  assert.match(
    billingRoutes,
    /requireOrganizationPrincipal\(request, \["OWNER", "ADMIN"\]\)/,
  );
  assert.doesNotMatch(billingRoutes, /function requireOrgId/);
  assert.doesNotMatch(billingRoutes, /x-org-name/);
  assert.doesNotMatch(billingRoutes, /x-billing-email/);
  assert.doesNotMatch(billingRoutes, /x-user-id/);
});

test("billing resources addressed by ID are ownership checked before use", () => {
  for (const resource of ["Subscription", "Invoice", "Quote"]) {
    assert.match(
      billingRoutes,
      new RegExp(`assertOrgOwnedResource\\([^\\n]+orgId, "${resource}"\\)`),
      `${resource} routes must enforce organization ownership`,
    );
  }

  assert.match(
    billingRoutes,
    /change-plan"[\s\S]*?getSubscription[\s\S]*?assertOrgOwnedResource/,
  );
  assert.match(
    billingRoutes,
    /change-seats"[\s\S]*?getSubscription[\s\S]*?assertOrgOwnedResource/,
  );
  assert.match(
    billingRoutes,
    /subscriptions\/:subscriptionId\/cancel"[\s\S]*?getSubscription[\s\S]*?assertOrgOwnedResource/,
  );
  assert.match(
    billingRoutes,
    /quotes\/:quoteId\/finalize"[\s\S]*?getQuote[\s\S]*?assertOrgOwnedResource/,
  );
  assert.match(
    billingRoutes,
    /quotes\/:quoteId\/accept"[\s\S]*?getQuote[\s\S]*?assertOrgOwnedResource/,
  );
});

test("legacy billing runtime fails closed with 503 when its adapter is unavailable", () => {
  assert.match(billingRoutes, /Billing runtime database adapter is not initialized/);
  assert.match(billingRoutes, /statusCode: 503/);
});

test("legacy billing admin surface cannot trust caller-controlled identity headers", () => {
  assert.match(billingAdminRoutes, /requirePlatformAuthority/);
  assert.doesNotMatch(billingAdminRoutes, /x-user-role/);
  assert.doesNotMatch(billingAdminRoutes, /x-user-id/);
  assert.match(billingAdminRoutes, /platform\.commerce\.billing\.manage/);
  assert.match(billingAdminRoutes, /platform\.commerce\.entitlements\.manage/);
});

test("legacy billing admin surface stays unregistered until its adapter is production-ready", () => {
  assert.doesNotMatch(routeRegistry, /registerBillingAdminRoutes/);
  assert.doesNotMatch(routeRegistry, /billing-admin/);
  assert.match(routeRegistry, /registerCommerceBillingRoutes/);
});

test("only catalog and signed Stripe webhook remain intentionally public", () => {
  assert.match(billingRoutes, /app\.get\("\/billing\/catalog"/);
  assert.match(billingRoutes, /"\/billing\/catalog\/:family"/);
  assert.match(billingRoutes, /"\/billing\/webhooks\/stripe"/);
  assert.match(billingRoutes, /stripe-signature/);

  const protectedOrgRoutes = [
    "/billing/account",
    "/billing/payment-methods",
    "/billing/portal-session",
    "/billing/checkout/session",
    "/billing/subscriptions",
    "/billing/entitlements",
    "/billing/dunning",
    "/billing/invoices",
    "/billing/usage",
    "/billing/tax",
    "/billing/quotes",
  ];

  for (const route of protectedOrgRoutes) {
    const index = billingRoutes.indexOf(`"${route}"`);
    assert.ok(index >= 0, `missing route ${route}`);
    const snippet = billingRoutes.slice(index, index + 700);
    assert.match(
      snippet,
      /requireBillingOrganization\(request\)/,
      `${route} must resolve a verified organization principal`,
    );
  }
});

test("signed Stripe webhook bypasses browser CSRF only to enter the canonical commerce pipeline", () => {
  const csrf = repoFile("apps/api/src/lib/csrf.ts");
  const commerceService = repoFile("apps/api/src/lib/commerce-billing.ts");

  assert.match(csrf, /route === "\/v1\/billing\/webhooks\/stripe"/);
  assert.match(billingRoutes, /preParsing:[\s\S]*?rawBody/);
  assert.match(billingRoutes, /Stripe webhook payload is too large/);
  assert.match(billingRoutes, /constructCanonicalStripeWebhookEvent/);
  assert.match(billingRoutes, /processCanonicalStripeWebhookEvent/);
  assert.doesNotMatch(billingRoutes, /@migrateck\/billing-core\/webhooks/);

  assert.match(commerceService, /migrateck:stripe-webhook:/);
  assert.match(commerceService, /pg_advisory_lock\(hashtext\(\$1\)\)/);
  assert.match(commerceService, /BillingWebhookEvent/);
  assert.match(commerceService, /BillingEventProjection/);
  assert.match(commerceService, /lastStripeEventId/);
  assert.match(commerceService, /source: "stripe_webhook"/);
  assert.match(commerceService, /Invalid Stripe webhook signature/);
  assert.doesNotMatch(commerceService, /__billingDb/);
});

test("canonical Stripe ingestion uses the deployed webhook ledger contract", () => {
  const commerceService = repoFile("apps/api/src/lib/commerce-billing.ts");
  const schema = repoFile("prisma/schema.prisma");
  const migration = repoFile(
    "prisma/migrations/20261009104000_billing_webhook_runtime_alignment/migration.sql",
  );

  assert.match(commerceService, /SELECT id,status::text AS status,attempts FROM "BillingWebhookEvent"/);
  assert.match(commerceService, /attempts=attempts\+1/);
  assert.match(commerceService, /"payloadJson"=\$2::jsonb/);
  assert.match(commerceService, /"errorText"=\$2/);
  assert.match(commerceService, /"firstProcessedAt"=COALESCE\("firstProcessedAt",NOW\(\)\)/);
  assert.match(commerceService, /"lastProcessedAt"=NOW\(\)/);
  assert.doesNotMatch(commerceService, /retryCount/);
  assert.doesNotMatch(commerceService, /rawPayload/);

  assert.match(schema, /model BillingWebhookEvent {[^}]*?attempts\s+Int\s+@default\(0\)/);
  assert.match(schema, /model BillingWebhookEvent {[^}]*?payloadJson\s+Json\?/);
  assert.match(schema, /model BillingWebhookEvent {[^}]*?errorText\s+String\?/);
  assert.doesNotMatch(schema, /model BillingWebhookEvent {[^}]*?retryCount/);
  assert.doesNotMatch(schema, /model BillingWebhookEvent {[^}]*?rawPayload/);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "payloadJson" JSONB/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'PROCESSING'/);
});
