import { createHash } from "node:crypto";
import { PRODUCT_CATALOG } from "@migrateck/billing-core/catalog";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";
import { CATALOG_FAMILY_TO_PRODUCT } from "./commerce-products.js";

const REQUIRED_TABLES = [
  "BillingCatalogProduct",
  "BillingCatalogPlan",
  "BillingCatalogPrice",
  "BillingCatalogSync",
] as const;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => stableJson(item)).join(",") + "]";
  }

  const object = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stableJson(object[key]))
      .join(",") +
    "}"
  );
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableId(prefix: string, key: string): string {
  return (
    prefix +
    "_" +
    createHash("sha256").update(key).digest("hex").slice(0, 24)
  );
}

export type CatalogMirrorSource = ReturnType<typeof buildCatalogMirrorSource>;

export function buildCatalogMirrorSource() {
  const products = PRODUCT_CATALOG.map((product) => {
    const productKey = CATALOG_FAMILY_TO_PRODUCT[product.productFamily] ?? null;
    const productRecord = {
      productFamily: product.productFamily,
      productKey,
      name: product.name,
      description: product.description,
    };

    const plans = product.plans.map((plan) => {
      const planRecord = {
        productFamily: product.productFamily,
        planCode: plan.planCode,
        name: plan.name,
        description: plan.description,
        trialDays: plan.trialDays ?? null,
        entitlements: plan.entitlements,
      };

      const prices = plan.prices.map((price) => {
        const priceRecord = {
          productFamily: product.productFamily,
          planCode: plan.planCode,
          lookupKey: price.lookupKey,
          componentType: price.componentType,
          billingInterval: price.billingInterval,
          currency: "usd",
          unitAmount: price.unitAmount,
          meterName: price.meterName ?? null,
          usageDimension: price.usageDimension ?? null,
          metadata: price.metadata,
        };
        return {
          ...priceRecord,
          id: stableId("catalog_price", price.lookupKey),
          sourceHash: sha256(priceRecord),
        };
      });

      return {
        ...planRecord,
        id: stableId(
          "catalog_plan",
          product.productFamily + ":" + plan.planCode,
        ),
        sourceHash: sha256(planRecord),
        prices,
      };
    });

    return {
      ...productRecord,
      id: stableId("catalog_product", product.productFamily),
      sourceHash: sha256(productRecord),
      plans,
    };
  }).sort((a, b) => a.productFamily.localeCompare(b.productFamily));

  for (const product of products) {
    product.plans.sort((a, b) => a.planCode.localeCompare(b.planCode));
    for (const plan of product.plans) {
      plan.prices.sort((a, b) => a.lookupKey.localeCompare(b.lookupKey));
    }
  }

  const canonical = products.map((product) => ({
    productFamily: product.productFamily,
    productKey: product.productKey,
    name: product.name,
    description: product.description,
    plans: product.plans.map((plan) => ({
      planCode: plan.planCode,
      name: plan.name,
      description: plan.description,
      trialDays: plan.trialDays,
      entitlements: plan.entitlements,
      prices: plan.prices.map((price) => ({
        lookupKey: price.lookupKey,
        componentType: price.componentType,
        billingInterval: price.billingInterval,
        currency: price.currency,
        unitAmount: price.unitAmount,
        meterName: price.meterName,
        usageDimension: price.usageDimension,
        metadata: price.metadata,
      })),
    })),
  }));

  return {
    digest: sha256(canonical),
    products,
    counts: {
      products: products.length,
      plans: products.reduce((sum, product) => sum + product.plans.length, 0),
      prices: products.reduce(
        (sum, product) =>
          sum +
          product.plans.reduce(
            (planSum, plan) => planSum + plan.prices.length,
            0,
          ),
        0,
      ),
    },
  };
}

async function existingTables(client: Pick<PoolClient, "query">) {
  const result = await client.query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])',
    ["public", [...REQUIRED_TABLES]],
  );
  return new Set(result.rows.map((row) => row.table_name));
}

export async function getCatalogMirrorStatus() {
  const source = buildCatalogMirrorSource();
  const db = getDb();
  const present = await existingTables(db as unknown as PoolClient);
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));

  if (missing.length > 0) {
    return {
      ready: false,
      drifted: true,
      reason: "migration_not_applied",
      missingTables: missing,
      source: {
        digest: source.digest,
        ...source.counts,
      },
      mirror: null,
    };
  }

  const [sync, counts] = await Promise.all([
    db.query(
      'SELECT id,"sourceDigest","sourceVersion","productCount","planCount","priceCount","retiredProductCount","retiredPlanCount","retiredPriceCount","syncedAt" FROM "BillingCatalogSync" WHERE id=$1',
      ["canonical"],
    ),
    db.query(
      `SELECT
         (SELECT count(*)::int FROM "BillingCatalogProduct" WHERE active=true) AS products,
         (SELECT count(*)::int FROM "BillingCatalogPlan" WHERE active=true) AS plans,
         (SELECT count(*)::int FROM "BillingCatalogPrice" WHERE active=true) AS prices,
         (SELECT count(*)::int FROM "BillingCatalogProduct" WHERE active=false) AS "retiredProducts",
         (SELECT count(*)::int FROM "BillingCatalogPlan" WHERE active=false) AS "retiredPlans",
         (SELECT count(*)::int FROM "BillingCatalogPrice" WHERE active=false) AS "retiredPrices"`,
    ),
  ]);

  const row = sync.rows[0] ?? null;
  const countRow = counts.rows[0] ?? {};
  const activeCounts = {
    products: Number(countRow.products ?? 0),
    plans: Number(countRow.plans ?? 0),
    prices: Number(countRow.prices ?? 0),
  };
  const digestMatches = row?.sourceDigest === source.digest;
  const countsMatch =
    activeCounts.products === source.counts.products &&
    activeCounts.plans === source.counts.plans &&
    activeCounts.prices === source.counts.prices;

  return {
    ready: Boolean(row && digestMatches && countsMatch),
    drifted: !(row && digestMatches && countsMatch),
    reason: !row
      ? "never_synced"
      : !digestMatches
        ? "source_digest_changed"
        : !countsMatch
          ? "row_count_mismatch"
          : null,
    missingTables: [],
    source: {
      digest: source.digest,
      ...source.counts,
    },
    mirror: {
      sourceDigest: row?.sourceDigest ?? null,
      sourceVersion: row?.sourceVersion ?? null,
      productCount: Number(row?.productCount ?? activeCounts.products),
      planCount: Number(row?.planCount ?? activeCounts.plans),
      priceCount: Number(row?.priceCount ?? activeCounts.prices),
      active: activeCounts,
      retired: {
        products: Number(countRow.retiredProducts ?? 0),
        plans: Number(countRow.retiredPlans ?? 0),
        prices: Number(countRow.retiredPrices ?? 0),
      },
      syncedAt: row?.syncedAt ?? null,
    },
  };
}

export async function syncCatalogMirrorIfAvailable(options?: {
  sourceVersion?: string | null;
}) {
  const status = await getCatalogMirrorStatus();

  if (status.reason === "migration_not_applied") {
    return {
      synced: false,
      skipped: true,
      reason: "migration_not_applied",
      status,
    };
  }

  if (status.ready) {
    return {
      synced: false,
      skipped: false,
      reason: "already_current",
      status,
    };
  }

  const result = await syncCatalogMirror(options);
  return {
    ...result,
    skipped: false,
    reason: "synchronized",
    status: await getCatalogMirrorStatus(),
  };
}

export async function syncCatalogMirror(options?: {
  sourceVersion?: string | null;
}) {
  const source = buildCatalogMirrorSource();
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["migrateck:billing-catalog-mirror"],
    );

    const present = await existingTables(client);
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw Object.assign(
        new Error(
          "Catalog mirror migration is not applied: " + missing.join(", "),
        ),
        { statusCode: 503 },
      );
    }

    const activeProductIds: string[] = [];
    const activePlanIds: string[] = [];
    const activePriceIds: string[] = [];

    for (const product of source.products) {
      const productUpsert = await client.query<{ id: string }>(
        `INSERT INTO "BillingCatalogProduct"
          (id,"productFamily","productKey",name,description,active,"sourceHash","lastSyncedAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,true,$6,NOW(),NOW(),NOW())
         ON CONFLICT ("productFamily")
         DO UPDATE SET
           "productKey"=EXCLUDED."productKey",
           name=EXCLUDED.name,
           description=EXCLUDED.description,
           active=true,
           "sourceHash"=EXCLUDED."sourceHash",
           "lastSyncedAt"=NOW(),
           "updatedAt"=NOW()
         RETURNING id`,
        [
          product.id,
          product.productFamily,
          product.productKey,
          product.name,
          product.description,
          product.sourceHash,
        ],
      );

      const productId = productUpsert.rows[0]?.id;
      if (!productId) {
        throw new Error(
          "Catalog mirror product upsert did not return a persisted product",
        );
      }

      activeProductIds.push(productId);

      for (const plan of product.plans) {
        const planUpsert = await client.query<{ id: string }>(
          `INSERT INTO "BillingCatalogPlan"
            (id,"productId","planCode",name,description,"trialDays",entitlements,active,"sourceHash","lastSyncedAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,true,$8,NOW(),NOW(),NOW())
           ON CONFLICT ("productId","planCode")
           DO UPDATE SET
             name=EXCLUDED.name,
             description=EXCLUDED.description,
             "trialDays"=EXCLUDED."trialDays",
             entitlements=EXCLUDED.entitlements,
             active=true,
             "sourceHash"=EXCLUDED."sourceHash",
             "lastSyncedAt"=NOW(),
             "updatedAt"=NOW()
           RETURNING id`,
          [
            plan.id,
            productId,
            plan.planCode,
            plan.name,
            plan.description,
            plan.trialDays,
            JSON.stringify(plan.entitlements),
            plan.sourceHash,
          ],
        );

        const planId = planUpsert.rows[0]?.id;
        if (!planId) {
          throw new Error(
            "Catalog mirror plan upsert did not return a persisted plan",
          );
        }

        activePlanIds.push(planId);

        for (const price of plan.prices) {
          const priceUpsert = await client.query<{ id: string }>(
            `INSERT INTO "BillingCatalogPrice"
              (id,"planId","lookupKey","componentType","billingInterval",currency,"unitAmount","meterName","usageDimension",metadata,active,"sourceHash","lastSyncedAt","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,true,$11,NOW(),NOW(),NOW())
             ON CONFLICT ("lookupKey")
             DO UPDATE SET
               "planId"=EXCLUDED."planId",
               "componentType"=EXCLUDED."componentType",
               "billingInterval"=EXCLUDED."billingInterval",
               currency=EXCLUDED.currency,
               "unitAmount"=EXCLUDED."unitAmount",
               "meterName"=EXCLUDED."meterName",
               "usageDimension"=EXCLUDED."usageDimension",
               metadata=EXCLUDED.metadata,
               active=true,
               "sourceHash"=EXCLUDED."sourceHash",
               "lastSyncedAt"=NOW(),
               "updatedAt"=NOW()
             RETURNING id`,
            [
              price.id,
              planId,
              price.lookupKey,
              price.componentType,
              price.billingInterval,
              price.currency,
              price.unitAmount,
              price.meterName,
              price.usageDimension,
              JSON.stringify(price.metadata),
              price.sourceHash,
            ],
          );

          const priceId = priceUpsert.rows[0]?.id;
          if (!priceId) {
            throw new Error(
              "Catalog mirror price upsert did not return a persisted price",
            );
          }
          activePriceIds.push(priceId);
        }
      }
    }

    const retiredPrices = await client.query(
      'UPDATE "BillingCatalogPrice" SET active=false,"lastSyncedAt"=NOW(),"updatedAt"=NOW() WHERE active=true AND NOT (id=ANY($1::text[]))',
      [activePriceIds],
    );
    const retiredPlans = await client.query(
      'UPDATE "BillingCatalogPlan" SET active=false,"lastSyncedAt"=NOW(),"updatedAt"=NOW() WHERE active=true AND NOT (id=ANY($1::text[]))',
      [activePlanIds],
    );
    const retiredProducts = await client.query(
      'UPDATE "BillingCatalogProduct" SET active=false,"lastSyncedAt"=NOW(),"updatedAt"=NOW() WHERE active=true AND NOT (id=ANY($1::text[]))',
      [activeProductIds],
    );

    const sourceVersion =
      options?.sourceVersion ??
      process.env.MIGRATECK_RELEASE_SHA ??
      process.env.GIT_SHA ??
      null;

    await client.query(
      `INSERT INTO "BillingCatalogSync"
        (id,"sourceDigest","sourceVersion","productCount","planCount","priceCount","retiredProductCount","retiredPlanCount","retiredPriceCount","syncedAt")
       VALUES ('canonical',$1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (id)
       DO UPDATE SET
         "sourceDigest"=EXCLUDED."sourceDigest",
         "sourceVersion"=EXCLUDED."sourceVersion",
         "productCount"=EXCLUDED."productCount",
         "planCount"=EXCLUDED."planCount",
         "priceCount"=EXCLUDED."priceCount",
         "retiredProductCount"="BillingCatalogSync"."retiredProductCount"+EXCLUDED."retiredProductCount",
         "retiredPlanCount"="BillingCatalogSync"."retiredPlanCount"+EXCLUDED."retiredPlanCount",
         "retiredPriceCount"="BillingCatalogSync"."retiredPriceCount"+EXCLUDED."retiredPriceCount",
         "syncedAt"=NOW()`,
      [
        source.digest,
        sourceVersion,
        source.counts.products,
        source.counts.plans,
        source.counts.prices,
        retiredProducts.rowCount ?? 0,
        retiredPlans.rowCount ?? 0,
        retiredPrices.rowCount ?? 0,
      ],
    );

    await client.query("COMMIT");

    return {
      synced: true,
      sourceDigest: source.digest,
      sourceVersion,
      counts: source.counts,
      retired: {
        products: retiredProducts.rowCount ?? 0,
        plans: retiredPlans.rowCount ?? 0,
        prices: retiredPrices.rowCount ?? 0,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
