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
