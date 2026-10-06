import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_CATALOG } from "@migrateck/billing-core/catalog";
import { ENTITLEMENT_STATUSES, PRODUCT_KEYS } from "./commerce-catalog.js";

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

test("manual entitlement mutation remains fail-closed until signer alignment", () => {
  assert.doesNotMatch(
    routes,
    /app\.(put|post|patch)\("\/commerce\/organizations\/:orgId\/entitlements"/,
  );
  assert.match(routes, /entitlements:\s*false/);
  assert.match(routes, /provisioning job signer is aligned with the production worker/);
});
