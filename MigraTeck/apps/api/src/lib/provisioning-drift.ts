import { getDb } from "./db.js";
import { provisioningProductAllowed } from "./provisioning-policy.js";

export type ProvisioningDriftClassification =
  | "active_access_needs_verification"
  | "superseded_by_success"
  | "access_not_active"
  | "unmapped_legacy_job";

export type ProvisioningDriftDisposition =
  | "runtime_link_required"
  | "synthetic_test_data"
  | "rollout_policy_blocked"
  | "verification_required"
  | "later_success"
  | "inactive_access"
  | "legacy_unmapped";

type RawDriftRow = {
  orgId: string;
  orgName: string | null;
  orgSlug: string | null;
  product: string | null;
  deadJobs: number;
  latestDeadAt: Date | string | null;
  lastDeadError: string | null;
  entitlementStatus: string | null;
  entitlementUpdatedAt: Date | string | null;
  succeededJobs: number;
  latestSuccessAt: Date | string | null;
  subscriptionCount: number;
  provenanceSource: string | null;
  provenanceTenantId: string | null;
  provenanceMonthlyRevenue: string | number | null;
};

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isSyntheticSource(source: string | null): boolean {
  const normalized = source?.trim().toLowerCase();
  return normalized === "manual-smoke" || normalized === "smoke" || normalized === "test";
}

function runtimeLinkRequired(input: {
  product: string;
  provenanceSource: string | null;
  provenanceTenantId: string | null;
}): boolean {
  if (input.product !== "MIGRAHOSTING") return false;

  const source = input.provenanceSource?.trim().toLowerCase() ?? "";
  return (
    source === "manual-backend-enable" ||
    source === "migra-market.revenue.close_deal" ||
    Boolean(input.provenanceTenantId)
  );
}

export function classifyProvisioningDrift(row: RawDriftRow) {
  const product = typeof row.product === "string" ? row.product : null;
  const entitlementStatus =
    typeof row.entitlementStatus === "string" ? row.entitlementStatus : null;
  const latestDeadAt = iso(row.latestDeadAt);
  const latestSuccessAt = iso(row.latestSuccessAt);
  const latestDeadMs = latestDeadAt ? Date.parse(latestDeadAt) : Number.NaN;
  const latestSuccessMs = latestSuccessAt
    ? Date.parse(latestSuccessAt)
    : Number.NaN;
  const supersededByLaterSuccess =
    Number.isFinite(latestDeadMs) &&
    Number.isFinite(latestSuccessMs) &&
    latestSuccessMs > latestDeadMs;

  const knownProducts = new Set([
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
  ]);
  const activeLike = new Set(["ACTIVE", "TRIAL", "INTERNAL_ONLY"]);

  let classification: ProvisioningDriftClassification;
  let disposition: ProvisioningDriftDisposition;
  let actionable = false;

  if (!product || !knownProducts.has(product)) {
    classification = "unmapped_legacy_job";
    disposition = "legacy_unmapped";
  } else if (!entitlementStatus || !activeLike.has(entitlementStatus)) {
    classification = "access_not_active";
    disposition = "inactive_access";
  } else if (supersededByLaterSuccess) {
    classification = "superseded_by_success";
    disposition = "later_success";
  } else {
    classification = "active_access_needs_verification";

    if (isSyntheticSource(row.provenanceSource)) {
      disposition = "synthetic_test_data";
    } else if (!provisioningProductAllowed(product)) {
      disposition = "rollout_policy_blocked";
    } else if (
      runtimeLinkRequired({
        product,
        provenanceSource: row.provenanceSource,
        provenanceTenantId: row.provenanceTenantId,
      })
    ) {
      disposition = "runtime_link_required";
      actionable = true;
    } else {
      disposition = "verification_required";
      actionable = true;
    }
  }

  return {
    orgId: row.orgId,
    orgName: row.orgName ?? null,
    orgSlug: row.orgSlug ?? null,
    product,
    entitlementStatus,
    entitlementUpdatedAt: iso(row.entitlementUpdatedAt),
    deadJobs: Number(row.deadJobs ?? 0),
    latestDeadAt,
    lastDeadError: row.lastDeadError ?? null,
    succeededJobs: Number(row.succeededJobs ?? 0),
    latestSuccessAt,
    subscriptionCount: Number(row.subscriptionCount ?? 0),
    provenanceSource: row.provenanceSource ?? null,
    provenanceTenantId: row.provenanceTenantId ?? null,
    provenanceMonthlyRevenue:
      row.provenanceMonthlyRevenue === null ||
      row.provenanceMonthlyRevenue === undefined
        ? null
        : Number(row.provenanceMonthlyRevenue),
    classification,
    disposition,
    actionable,
  };
}

export async function getProvisioningDriftSnapshot() {
  const result = await getDb().query<RawDriftRow>(
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
     ),
     provenance AS (
       SELECT DISTINCT ON (
         a."orgId",
         a.metadata->'details'->>'product'
       )
         a."orgId",
         a.metadata->'details'->>'product' AS product,
         a.metadata->'details'->>'source' AS "provenanceSource",
         NULLIF(a.metadata->'details'->>'tenantId','') AS "provenanceTenantId",
         NULLIF(a.metadata->'details'->>'monthlyRevenue','') AS "provenanceMonthlyRevenue"
       FROM "AuditLog" a
       WHERE a.action='REVENUE_PROVISION_HANDOFF_ACCEPTED'
         AND NULLIF(a.metadata->'details'->>'product','') IS NOT NULL
       ORDER BY
         a."orgId",
         a.metadata->'details'->>'product',
         a."createdAt" DESC
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
       COALESCE(bs."subscriptionCount",0)::int AS "subscriptionCount",
       p."provenanceSource",
       p."provenanceTenantId",
       p."provenanceMonthlyRevenue"
     FROM dead d
     LEFT JOIN "Organization" o ON o.id=d."orgId"
     LEFT JOIN "OrgEntitlement" e
       ON e."orgId"=d."orgId"
      AND e.product::text=d.product
     LEFT JOIN success s
       ON s."orgId"=d."orgId"
      AND s.product IS NOT DISTINCT FROM d.product
     LEFT JOIN subscriptions bs ON bs."orgId"=d."orgId"
     LEFT JOIN provenance p
       ON p."orgId"=d."orgId"
      AND p.product IS NOT DISTINCT FROM d.product
     ORDER BY d."latestDeadAt" DESC`,
  );

  const rows = result.rows.map(classifyProvisioningDrift);
  const unresolvedActive = rows.filter(
    (row) => row.classification === "active_access_needs_verification",
  );
  const actionable = unresolvedActive.filter((row) => row.actionable);

  const sumDeadJobs = (items: typeof rows) =>
    items.reduce((sum, row) => sum + row.deadJobs, 0);

  return {
    rows,
    needsVerification: actionable.length,
    correlatedDeadJobs: sumDeadJobs(actionable),
    historicalNeedsReview: unresolvedActive.length,
    historicalCorrelatedDeadJobs: sumDeadJobs(unresolvedActive),
    syntheticTestRows: unresolvedActive.filter(
      (row) => row.disposition === "synthetic_test_data",
    ).length,
    rolloutPolicyBlockedRows: unresolvedActive.filter(
      (row) => row.disposition === "rollout_policy_blocked",
    ).length,
    runtimeLinkRequiredRows: unresolvedActive.filter(
      (row) => row.disposition === "runtime_link_required",
    ).length,
  };
}
