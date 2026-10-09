import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_CATALOG } from "@migrateck/billing-core/catalog";
import {
  buildCatalogMirrorSource,
} from "./catalog-mirror.js";
import {
  CATALOG_FAMILY_TO_PRODUCT,
} from "./commerce-products.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("runtime catalog mirror source is deterministic and complete", () => {
  const first = buildCatalogMirrorSource();
  const second = buildCatalogMirrorSource();

  assert.equal(first.digest, second.digest);
  assert.equal(first.counts.products, PRODUCT_CATALOG.length);
  assert.equal(
    first.counts.plans,
    PRODUCT_CATALOG.reduce((sum, product) => sum + product.plans.length, 0),
  );
  assert.equal(
    first.counts.prices,
    PRODUCT_CATALOG.reduce(
      (sum, product) =>
        sum +
        product.plans.reduce(
          (planSum, plan) => planSum + plan.prices.length,
          0,
        ),
      0,
    ),
  );

  for (const product of first.products) {
    assert.ok(product.productKey, product.productFamily);
    assert.equal(
      product.productKey,
      CATALOG_FAMILY_TO_PRODUCT[product.productFamily],
    );
  }
});

test("mirror IDs and lookup keys are unique and stable", () => {
  const source = buildCatalogMirrorSource();
  const productIds = source.products.map((product) => product.id);
  const plans = source.products.flatMap((product) => product.plans);
  const planIds = plans.map((plan) => plan.id);
  const prices = plans.flatMap((plan) => plan.prices);
  const priceIds = prices.map((price) => price.id);
  const lookupKeys = prices.map((price) => price.lookupKey);

  assert.equal(new Set(productIds).size, productIds.length);
  assert.equal(new Set(planIds).size, planIds.length);
  assert.equal(new Set(priceIds).size, priceIds.length);
  assert.equal(new Set(lookupKeys).size, lookupKeys.length);

  const again = buildCatalogMirrorSource();
  assert.deepEqual(
    again.products.map((product) => product.id),
    productIds,
  );
});

test("metered canonical prices remain nullable and keep meter metadata", () => {
  const source = buildCatalogMirrorSource();
  const prices = source.products.flatMap((product) =>
    product.plans.flatMap((plan) => plan.prices),
  );
  const metered = prices.filter((price) => price.unitAmount === null);

  assert.ok(metered.length > 0, "expected at least one metered price");
  assert.ok(
    metered.some((price) => Boolean(price.meterName)),
    "metered price should retain meter name",
  );

  const migration = repoFile(
    "prisma/migrations/20261009031500_commerce_catalog_runtime_mirror/migration.sql",
  );
  assert.match(
    migration,
    /"unitAmount" INTEGER,/,
    "unitAmount must remain nullable for metered components",
  );
  assert.match(migration, /"meterName" TEXT/);
  assert.match(migration, /"usageDimension" TEXT/);
  assert.match(migration, /"metadata" JSONB/);
});

test("migration is additive and preserves the product-plan-price hierarchy", () => {
  const migration = repoFile(
    "prisma/migrations/20261009031500_commerce_catalog_runtime_mirror/migration.sql",
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "BillingCatalogProduct"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "BillingCatalogPlan"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "BillingCatalogPrice"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "BillingCatalogSync"/);
  assert.match(
    migration,
    /FOREIGN KEY \("productId"\) REFERENCES "BillingCatalogProduct"\("id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("planId"\) REFERENCES "BillingCatalogPlan"\("id"\)/,
  );
  assert.doesNotMatch(migration, /ALTER TABLE "BillingSubscription"/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("synchronizer serializes writers and retires removed source rows", () => {
  const model = repoFile("apps/api/src/lib/catalog-mirror.ts");

  assert.match(model, /pg_advisory_xact_lock/);
  assert.match(model, /migrateck:billing-catalog-mirror/);
  assert.match(
    model,
    /UPDATE "BillingCatalogPrice" SET active=false/,
  );
  assert.match(
    model,
    /UPDATE "BillingCatalogPlan" SET active=false/,
  );
  assert.match(
    model,
    /UPDATE "BillingCatalogProduct" SET active=false/,
  );
  assert.doesNotMatch(model, /DELETE FROM "BillingCatalog/);
  assert.ok(
    (model.match(/RETURNING id/g) ?? []).length >= 3,
    "retirement sets must use persisted IDs returned by upserts",
  );
  assert.match(model, /activeProductIds\.push\(productId\)/);
  assert.match(model, /activePlanIds\.push\(planId\)/);
  assert.match(model, /activePriceIds\.push\(priceId\)/);
  assert.match(model, /await client\.query\("COMMIT"\)/);
  assert.match(model, /await client\.query\("ROLLBACK"\)/);
});

test("mirror readiness is digest and row-count based, not table-presence based", () => {
  const model = repoFile("apps/api/src/lib/catalog-mirror.ts");
  const catalog = repoFile("apps/api/src/lib/commerce-catalog.ts");

  assert.match(model, /source_digest_changed/);
  assert.match(model, /row_count_mismatch/);
  assert.match(model, /never_synced/);
  assert.match(model, /migration_not_applied/);
  assert.match(model, /digestMatches/);
  assert.match(model, /countsMatch/);

  assert.match(catalog, /getCatalogMirrorStatus/);
  assert.match(catalog, /nativeCatalogMirrorReady: mirror\.ready/);
  assert.match(catalog, /subscriptionCatalogLinkReady: false/);
});

test("manual sync is catalog-manage only, audited, and exposed in the operator UI", () => {
  const routes = repoFile(
    "apps/api/src/routes/v1/modules/commerce-catalog.ts",
  );
  const proxy = repoFile(
    "apps/web/src/app/api/platform/commerce/catalog/sync/route.ts",
  );
  const workspace = repoFile(
    "apps/web/src/app/(platform)/platform/commerce/catalog/CatalogEntitlementsWorkspace.tsx",
  );

  assert.match(
    routes,
    /app\.post\("\/commerce\/catalog\/sync"[\s\S]*?"platform\.commerce\.catalog\.manage"/,
  );
  assert.match(routes, /BILLING_CATALOG_MIRROR_SYNCED/);
  assert.match(routes, /getCatalogMirrorStatus/);

  assert.match(proxy, /"\/commerce\/catalog\/sync"/);
  assert.match(proxy, /method: "POST"/);

  assert.match(workspace, /Sync runtime catalog/);
  assert.match(workspace, /Source drift detected/);
  assert.match(workspace, /Row-count drift/);
  assert.match(workspace, /Subscription catalog link/);
});

test("startup reconciliation is idempotent and non-fatal", () => {
  const server = repoFile("apps/api/src/server.ts");
  const model = repoFile("apps/api/src/lib/catalog-mirror.ts");

  assert.match(server, /syncCatalogMirrorIfAvailable/);
  assert.match(server, /scope: "catalog-mirror"/);
  assert.match(
    server,
    /Surface the failure loudly without taking the whole control plane down/,
  );
  assert.match(model, /reason: "already_current"/);
  assert.match(model, /reason: "migration_not_applied"/);
});
