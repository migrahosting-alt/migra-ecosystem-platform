import { randomUUID } from "node:crypto";
import { PRODUCT_CATALOG } from "@migrateck/billing-core/catalog";
import type { FastifyRequest } from "fastify";
import { getDb } from "./db.js";

export const PRODUCT_KEYS = [
  "MIGRATECK",
  "MIGRAHOSTING",
  "MIGRAPANEL",
  "MIGRAVOICE",
  "MIGRAMAIL",
  "MIGRAINTAKE",
  "MIGRAMARKET",
  "MIGRAPILOT",
  "MIGRAINVOICE",
  "MIGRADRIVE",
  "MIGRABUILDER",
] as const;

export const ENTITLEMENT_STATUSES = [
  "ACTIVE",
  "TRIAL",
  "RESTRICTED",
  "INTERNAL_ONLY",
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const CATALOG_FAMILY_TO_PRODUCT: Record<string, ProductKey> = {
  builder: "MIGRABUILDER",
  hosting: "MIGRAHOSTING",
  intake: "MIGRAINTAKE",
  invoice: "MIGRAINVOICE",
  voice: "MIGRAVOICE",
  email: "MIGRAMAIL",
  marketing: "MIGRAMARKET",
  pilot: "MIGRAPILOT",
  drive: "MIGRADRIVE",
};

function serializeCatalog() {
  return PRODUCT_CATALOG.map((product) => ({
    productFamily: product.productFamily,
    productKey: CATALOG_FAMILY_TO_PRODUCT[product.productFamily] ?? null,
    name: product.name,
    description: product.description,
    planCount: product.plans.length,
    priceCount: product.plans.reduce((count, plan) => count + plan.prices.length, 0),
    plans: product.plans.map((plan) => ({
      planCode: plan.planCode,
      name: plan.name,
      description: plan.description,
      trialDays: plan.trialDays ?? null,
      entitlementCount: Object.keys(plan.entitlements).length,
      entitlements: plan.entitlements,
      prices: plan.prices.map((price) => ({
        lookupKey: price.lookupKey,
        componentType: price.componentType,
        billingInterval: price.billingInterval,
        unitAmount: price.unitAmount,
        meterName: price.meterName ?? null,
        usageDimension: price.usageDimension ?? null,
      })),
    })),
  }));
}

async function tableReadiness() {
  const names = [
    "BillingProduct",
    "BillingPrice",
    "BillingPlan",
    "BillingEntitlementBinding",
    "OrgEntitlement",
    "OrgBillingEntitlement",
    "ProvisioningJob",
  ];
  const rows = await getDb().query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])',
    ["public", names],
  );
  const present = new Set(rows.rows.map((row) => row.table_name));

  const counts: Record<string, number | null> = {};
  for (const name of names) {
    if (!present.has(name)) {
      counts[name] = null;
      continue;
    }
    const result = await getDb().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "' + name.replace(/"/g, '""') + '"',
    );
    counts[name] = Number(result.rows[0]?.count ?? 0);
  }

  return {
    canonicalCatalogAuthority: "source",
    nativeCatalogMirrorReady: present.has("BillingProduct") && present.has("BillingPrice"),
    effectiveEntitlementAuthority: present.has("OrgEntitlement") ? "OrgEntitlement" : null,
    tables: Object.fromEntries(
      names.map((name) => [name, { present: present.has(name), rows: counts[name] }]),
    ),
  };
}

export async function getCommerceCatalogSnapshot() {
  const db = getDb();
  const [
    bindings,
    entitlementSummary,
    provisioningSummary,
    deadProvisioningJobs,
    provisioningDriftRows,
    readiness,
  ] = await Promise.all([
    db.query(
      'SELECT id,provider::text AS provider,"externalPriceId",product::text AS product,"statusOnActive"::text AS "statusOnActive",notes,"createdAt","updatedAt" FROM "BillingEntitlementBinding" ORDER BY product,"createdAt"',
    ),
    db.query(
      'SELECT product::text AS product,status::text AS status,count(*)::int AS count FROM "OrgEntitlement" GROUP BY product,status ORDER BY product,status',
    ),
    db.query(
      'SELECT status::text AS status,count(*)::int AS count,min("createdAt") AS oldest,max("updatedAt") AS newest FROM "ProvisioningJob" GROUP BY status ORDER BY status',
    ),
    db.query(
      `SELECT
         j.id,
         j."orgId",
         o.name AS "orgName",
         o.slug AS "orgSlug",
         j.source::text AS source,
         j.type::text AS type,
         j.status::text AS status,
         j.attempts,
         j."maxAttempts",
         j."lastError",
         j."lastErrorAt",
         j."createdAt",
         j."updatedAt"
       FROM "ProvisioningJob" j
       LEFT JOIN "Organization" o ON o.id=j."orgId"
       WHERE j.status='DEAD'::"ProvisioningJobStatus"
       ORDER BY COALESCE(j."lastErrorAt",j."updatedAt") DESC
       LIMIT 50`,
    ),
    db.query(
      `WITH dead AS (
         SELECT
           j."orgId",
           COALESCE(
             NULLIF(j.payload->>'productLane',''),
             NULLIF(j.payload->>'product','')
           ) AS product,
           count(*)::int AS "deadJobs",
           max(COALESCE(j."lastErrorAt",j."updatedAt")) AS "latestDeadAt",
           (array_agg(
             j."lastError"
             ORDER BY COALESCE(j."lastErrorAt",j."updatedAt") DESC
           ))[1] AS "lastDeadError"
         FROM "ProvisioningJob" j
         WHERE j.status='DEAD'::"ProvisioningJobStatus"
         GROUP BY
           j."orgId",
           COALESCE(
             NULLIF(j.payload->>'productLane',''),
             NULLIF(j.payload->>'product','')
           )
       ),
       success AS (
         SELECT
           j."orgId",
           COALESCE(
             NULLIF(j.payload->>'productLane',''),
             NULLIF(j.payload->>'product','')
           ) AS product,
           count(*)::int AS "succeededJobs",
           max(j."updatedAt") AS "latestSuccessAt"
         FROM "ProvisioningJob" j
         WHERE j.status='SUCCEEDED'::"ProvisioningJobStatus"
         GROUP BY
           j."orgId",
           COALESCE(
             NULLIF(j.payload->>'productLane',''),
             NULLIF(j.payload->>'product','')
           )
       ),
       subscriptions AS (
         SELECT "orgId",count(*)::int AS "subscriptionCount"
         FROM "BillingSubscription"
         GROUP BY "orgId"
       )
       SELECT
         d."orgId",
         o.name AS "orgName",
         o.slug AS "orgSlug",
         d.product,
         d."deadJobs",
         d."latestDeadAt",
         d."lastDeadError",
         e.status::text AS "entitlementStatus",
         e."updatedAt" AS "entitlementUpdatedAt",
         COALESCE(s."succeededJobs",0)::int AS "succeededJobs",
         s."latestSuccessAt",
         COALESCE(bs."subscriptionCount",0)::int AS "subscriptionCount"
       FROM dead d
       LEFT JOIN "Organization" o ON o.id=d."orgId"
       LEFT JOIN "OrgEntitlement" e
         ON e."orgId"=d."orgId"
        AND e.product::text=d.product
       LEFT JOIN success s
         ON s."orgId"=d."orgId"
        AND s.product IS NOT DISTINCT FROM d.product
       LEFT JOIN subscriptions bs ON bs."orgId"=d."orgId"
       ORDER BY d."latestDeadAt" DESC`,
    ),
    tableReadiness(),
  ]);

  const catalog = serializeCatalog();
  const bindingCoverage = PRODUCT_KEYS.map((product) => ({
    product,
    bindings: bindings.rows.filter((row) => row.product === product).length,
    activeEntitlements: entitlementSummary.rows
      .filter((row) => row.product === product && ["ACTIVE", "TRIAL", "INTERNAL_ONLY"].includes(row.status))
      .reduce((sum, row) => sum + Number(row.count ?? 0), 0),
    restrictedEntitlements: entitlementSummary.rows
      .filter((row) => row.product === product && row.status === "RESTRICTED")
      .reduce((sum, row) => sum + Number(row.count ?? 0), 0),
  }));

  const knownProducts = new Set<string>(PRODUCT_KEYS);
  const activeLikeStatuses = new Set(["ACTIVE", "TRIAL", "INTERNAL_ONLY"]);
  const provisioningDrift = provisioningDriftRows.rows.map((row) => {
    const product = typeof row.product === "string" ? row.product : null;
    const entitlementStatus =
      typeof row.entitlementStatus === "string" ? row.entitlementStatus : null;
    const latestDeadAt = row.latestDeadAt
      ? new Date(row.latestDeadAt).toISOString()
      : null;
    const latestSuccessAt = row.latestSuccessAt
      ? new Date(row.latestSuccessAt).toISOString()
      : null;
    const latestDeadMs = latestDeadAt ? Date.parse(latestDeadAt) : Number.NaN;
    const latestSuccessMs = latestSuccessAt
      ? Date.parse(latestSuccessAt)
      : Number.NaN;
    const supersededByLaterSuccess =
      Number.isFinite(latestDeadMs) &&
      Number.isFinite(latestSuccessMs) &&
      latestSuccessMs > latestDeadMs;

    let classification:
      | "active_access_needs_verification"
      | "superseded_by_success"
      | "access_not_active"
      | "unmapped_legacy_job";

    if (!product || !knownProducts.has(product)) {
      classification = "unmapped_legacy_job";
    } else if (!entitlementStatus || !activeLikeStatuses.has(entitlementStatus)) {
      classification = "access_not_active";
    } else if (supersededByLaterSuccess) {
      classification = "superseded_by_success";
    } else {
      classification = "active_access_needs_verification";
    }

    return {
      orgId: row.orgId as string,
      orgName: (row.orgName as string | null) ?? null,
      orgSlug: (row.orgSlug as string | null) ?? null,
      product,
      entitlementStatus,
      entitlementUpdatedAt: row.entitlementUpdatedAt
        ? new Date(row.entitlementUpdatedAt).toISOString()
        : null,
      deadJobs: Number(row.deadJobs ?? 0),
      latestDeadAt,
      lastDeadError: (row.lastDeadError as string | null) ?? null,
      succeededJobs: Number(row.succeededJobs ?? 0),
      latestSuccessAt,
      subscriptionCount: Number(row.subscriptionCount ?? 0),
      classification,
    };
  });
  const driftNeedsVerification = provisioningDrift.filter(
    (row) => row.classification === "active_access_needs_verification",
  ).length;

  const provisioningCount = (status: string) =>
    Number(
      provisioningSummary.rows.find((row) => row.status === status)?.count ?? 0,
    );

  return {
    catalog,
    bindings: bindings.rows,
    bindingCoverage,
    entitlementSummary: entitlementSummary.rows,
    provisioning: {
      summary: provisioningSummary.rows,
      deadJobs: deadProvisioningJobs.rows,
      drift: {
        rows: provisioningDrift,
        needsVerification: driftNeedsVerification,
      },
    },
    readiness,
    metrics: {
      catalogProducts: catalog.length,
      catalogPlans: catalog.reduce((sum, product) => sum + product.planCount, 0),
      catalogPrices: catalog.reduce((sum, product) => sum + product.priceCount, 0),
      liveBindings: bindings.rows.length,
      effectiveEntitlements: entitlementSummary.rows.reduce(
        (sum, row) => sum + Number(row.count ?? 0),
        0,
      ),
      provisioningPending: provisioningCount("PENDING"),
      provisioningRunning: provisioningCount("RUNNING"),
      provisioningSucceeded: provisioningCount("SUCCEEDED"),
      provisioningFailed: provisioningCount("FAILED"),
      provisioningDead: provisioningCount("DEAD"),
      provisioningCanceled: provisioningCount("CANCELED"),
      provisioningDriftNeedsVerification: driftNeedsVerification,
    },
  };
}

export async function searchCommerceOrganizations(query = "", limit = 30) {
  const normalized = query.trim();
  const pattern = "%" + normalized.replace(/[%_]/g, "\$&") + "%";
  const result = await getDb().query(
    `SELECT
       o.id,
       o.name,
       o.slug,
       o."isMigraHostingClient",
       o."authOrganizationId",
       count(DISTINCT e.product)::int AS "entitlementCount",
       count(DISTINCT CASE WHEN e.status IN ('ACTIVE','TRIAL','INTERNAL_ONLY') THEN e.product END)::int AS "activeEntitlementCount",
       count(DISTINCT s.id)::int AS "subscriptionCount",
       max(e."updatedAt") AS "accessUpdatedAt"
     FROM "Organization" o
     LEFT JOIN "OrgEntitlement" e ON e."orgId"=o.id
     LEFT JOIN "BillingSubscription" s ON s."orgId"=o.id
     WHERE ($1='' OR o.name ILIKE $2 ESCAPE '\\' OR o.slug ILIKE $2 ESCAPE '\\')
     GROUP BY o.id,o.name,o.slug,o."isMigraHostingClient",o."authOrganizationId",o."createdAt"
     ORDER BY
       CASE WHEN $1<>'' AND lower(o.name)=lower($1) THEN 0 ELSE 1 END,
       "activeEntitlementCount" DESC,
       o."createdAt" DESC
     LIMIT $3`,
    [normalized, pattern, Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows;
}

function entitlementEvidence(notes: string | null): "stripe_sync" | "manual_or_legacy" | "none" {
  if (!notes) return "none";
  if (/synced from stripe subscription/i.test(notes)) return "stripe_sync";
  return "manual_or_legacy";
}

export async function getOrganizationCommerceAccess(orgId: string) {
  const db = getDb();
  const [org, rows, recentJobs, subscriptions] = await Promise.all([
    db.query(
      'SELECT id,name,slug,"isMigraHostingClient","authOrganizationId","createdAt","updatedAt" FROM "Organization" WHERE id=$1',
      [orgId],
    ),
    db.query(
      'SELECT id,product::text AS product,status::text AS status,"startsAt","endsAt",notes,"createdAt","updatedAt" FROM "OrgEntitlement" WHERE "orgId"=$1 ORDER BY product',
      [orgId],
    ),
    db.query(
      'SELECT id,source::text AS source,type::text AS type,status::text AS status,attempts,"maxAttempts","notBefore","lastError","createdAt","updatedAt" FROM "ProvisioningJob" WHERE "orgId"=$1 ORDER BY "createdAt" DESC LIMIT 25',
      [orgId],
    ),
    db.query(
      'SELECT id,provider::text AS provider,"externalSubscriptionId","externalCustomerId",status::text AS status,"currentPeriodStart","currentPeriodEnd","cancelAtPeriodEnd","canceledAt","createdAt","updatedAt" FROM "BillingSubscription" WHERE "orgId"=$1 ORDER BY "createdAt" DESC LIMIT 25',
      [orgId],
    ),
  ]);

  const organization = org.rows[0];
  if (!organization) {
    throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  }

  const byProduct = new Map(rows.rows.map((row) => [row.product, row]));
  return {
    organization,
    entitlements: PRODUCT_KEYS.map((product) => {
      const row = byProduct.get(product);
      return {
        product,
        status: row?.status ?? "RESTRICTED",
        startsAt: row?.startsAt ?? null,
        endsAt: row?.endsAt ?? null,
        notes: row?.notes ?? null,
        updatedAt: row?.updatedAt ?? null,
        persisted: Boolean(row),
        evidence: entitlementEvidence(row?.notes ?? null),
      };
    }),
    subscriptions: subscriptions.rows,
    recentProvisioningJobs: recentJobs.rows,
  };
}

async function writeAudit(input: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  request: FastifyRequest;
  orgId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await getDb().query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId,
      input.orgId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.request.ip ?? null,
      input.request.headers["user-agent"] ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function upsertBillingBinding(input: {
  actorId: string;
  externalPriceId: string;
  product: ProductKey;
  statusOnActive: EntitlementStatus;
  notes?: string | null;
  request: FastifyRequest;
}) {
  const db = getDb();
  const before = await db.query(
    'SELECT id,provider::text AS provider,"externalPriceId",product::text AS product,"statusOnActive"::text AS "statusOnActive",notes FROM "BillingEntitlementBinding" WHERE "externalPriceId"=$1',
    [input.externalPriceId],
  );

  const id = before.rows[0]?.id ?? randomUUID();
  const result = await db.query(
    `INSERT INTO "BillingEntitlementBinding"
      (id,provider,"externalPriceId",product,"statusOnActive",notes,"createdAt","updatedAt")
     VALUES ($1,'STRIPE',$2,$3::"ProductKey",$4::"EntitlementStatus",$5,NOW(),NOW())
     ON CONFLICT ("externalPriceId")
     DO UPDATE SET product=EXCLUDED.product,"statusOnActive"=EXCLUDED."statusOnActive",notes=EXCLUDED.notes,"updatedAt"=NOW()
     RETURNING id,provider::text AS provider,"externalPriceId",product::text AS product,"statusOnActive"::text AS "statusOnActive",notes,"createdAt","updatedAt"`,
    [id, input.externalPriceId, input.product, input.statusOnActive, input.notes ?? null],
  );

  const binding = result.rows[0];
  await writeAudit({
    actorId: input.actorId,
    action: before.rows[0] ? "BILLING_BINDING_UPDATED" : "BILLING_BINDING_CREATED",
    entityType: "billing_entitlement_binding",
    entityId: binding.id,
    request: input.request,
    metadata: {
      before: before.rows[0] ?? null,
      after: binding,
    },
  });

  return binding;
}
