import { getDb } from "./db.js";
import {
  getHostingRecoveryCandidateByTenantId,
  getHostingRecoveryCandidates,
  getHostingRuntimeStatus,
  getHostingTenantBinding,
  type HostingRecoveryCandidate,
} from "./hosting-integration.js";
import { getDeadLetterRemediation } from "./provisioning-remediation.js";

type RuntimeReconstructionState =
  | "runtime_linked"
  | "existing_tenant_candidate"
  | "runtime_reconstruction_required"
  | "hosting_runtime_unavailable"
  | "no_active_entitlement";

type HistoricalTenantEvidence = {
  tenantId: string;
  state: "available" | "missing" | "unavailable";
  candidate: HostingRecoveryCandidate | null;
};

type DeadJobSummary = {
  id: string;
  action: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  malformed: boolean;
  payloadHashValid: boolean;
  signatureValid: boolean;
  recoveryContractAvailable: boolean;
  readyToRetry: boolean;
  retryReason: string | null;
  requiredFields: string[];
  missingFields: string[];
  currentContext: Record<string, string>;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function safeContext(value: unknown): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of [
    "domain",
    "tenantId",
    "serviceInstanceId",
    "targetIp",
    "plan",
    "mailboxEmail",
  ]) {
    const candidate = source[key];
    if (typeof candidate === "string" && candidate.trim()) {
      result[key] = candidate.trim();
    }
  }
  return result;
}

async function historicalTenantEvidence(
  tenantIds: string[],
): Promise<HistoricalTenantEvidence[]> {
  return Promise.all(
    tenantIds.map(async (tenantId) => {
      try {
        return {
          tenantId,
          state: "available" as const,
          candidate: await getHostingRecoveryCandidateByTenantId(tenantId),
        };
      } catch (error) {
        const statusCode =
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          typeof (error as { statusCode?: unknown }).statusCode === "number"
            ? (error as { statusCode: number }).statusCode
            : null;
        return {
          tenantId,
          state:
            statusCode === 404
              ? ("missing" as const)
              : ("unavailable" as const),
          candidate: null,
        };
      }
    }),
  );
}

export async function getProvisioningRuntimeReconstructionContext(input: {
  orgId: string;
  product: string;
}) {
  if (input.product !== "MIGRAHOSTING") {
    throw Object.assign(
      new Error(
        "Runtime reconstruction evidence is currently implemented only for MIGRAHOSTING.",
      ),
      { statusCode: 409 },
    );
  }

  const db = getDb();
  const organizationResult = await db.query<{
    id: string;
    name: string;
    slug: string;
    isMigraHostingClient: boolean;
  }>(
    'SELECT id,name,slug,"isMigraHostingClient" FROM "Organization" WHERE id=$1 LIMIT 1',
    [input.orgId],
  );
  const organization = organizationResult.rows[0];
  if (!organization) {
    throw Object.assign(new Error("Organization not found"), {
      statusCode: 404,
    });
  }

  const [entitlementResult, jobResult, provenanceResult] = await Promise.all([
    db.query<{
      id: string;
      status: string;
      notes: string | null;
      startsAt: Date | string | null;
      endsAt: Date | string | null;
      updatedAt: Date | string;
    }>(
      'SELECT id,status::text AS status,notes,"startsAt","endsAt","updatedAt" FROM "OrgEntitlement" WHERE "orgId"=$1 AND product=\'MIGRAHOSTING\'::"ProductKey" LIMIT 1',
      [input.orgId],
    ),
    db.query<{
      id: string;
      status: string;
      action: string | null;
      lastError: string | null;
      createdAt: Date | string;
      updatedAt: Date | string;
    }>(
      `SELECT
         id,status::text AS status,
         COALESCE(NULLIF(payload->>'action',''),NULL) AS action,
         "lastError","createdAt","updatedAt"
       FROM "ProvisioningJob"
       WHERE "orgId"=$1
         AND status='DEAD'::"ProvisioningJobStatus"
         AND COALESCE(
           NULLIF(payload->>'productLane',''),
           NULLIF(payload->>'product','')
         )='MIGRAHOSTING'
       ORDER BY "createdAt" ASC`,
      [input.orgId],
    ),
    db.query<{
      source: string | null;
      tenantId: string | null;
      monthlyRevenue: string | null;
      createdAt: Date | string;
    }>(
      `SELECT
         metadata->'details'->>'source' AS source,
         NULLIF(metadata->'details'->>'tenantId','') AS "tenantId",
         NULLIF(metadata->'details'->>'monthlyRevenue','') AS "monthlyRevenue",
         "createdAt"
       FROM "AuditLog"
       WHERE "orgId"=$1
         AND action='REVENUE_PROVISION_HANDOFF_ACCEPTED'
         AND metadata->'details'->>'product'='MIGRAHOSTING'
       ORDER BY "createdAt" ASC`,
      [input.orgId],
    ),
  ]);

  const entitlement = entitlementResult.rows[0] ?? null;
  const activeLike = entitlement
    ? ["ACTIVE", "TRIAL", "INTERNAL_ONLY"].includes(entitlement.status)
    : false;

  const hostingRuntime = await getHostingRuntimeStatus();
  const binding = await getHostingTenantBinding(input.orgId);

  let candidates: HostingRecoveryCandidate[] = [];
  if (hostingRuntime.connected && !binding?.tenantId) {
    try {
      candidates = await getHostingRecoveryCandidates({
        orgName: organization.name,
        orgSlug: organization.slug,
        limit: 5,
      });
    } catch {
      candidates = [];
    }
  }

  const provenanceTenantIds = uniqueStrings(
    provenanceResult.rows.map((row) => row.tenantId),
  );
  const historicalTenants = hostingRuntime.connected
    ? await historicalTenantEvidence(provenanceTenantIds)
    : provenanceTenantIds.map((tenantId) => ({
        tenantId,
        state: "unavailable" as const,
        candidate: null,
      }));

  const jobs: DeadJobSummary[] = [];
  for (const row of jobResult.rows) {
    const remediation = await getDeadLetterRemediation(row.id, {
      includeHostingSuggestions: false,
    });
    const currentContext = safeContext(remediation.retry.currentContext);
    jobs.push({
      id: row.id,
      action: remediation.job.action,
      lastError: row.lastError,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      malformed: remediation.retry.malformed,
      payloadHashValid: remediation.retry.payloadHashValid,
      signatureValid: remediation.retry.signatureValid,
      recoveryContractAvailable: remediation.retry.available,
      readyToRetry:
        remediation.retry.available &&
        remediation.retry.missingFields.length === 0,
      retryReason: remediation.retry.reason,
      requiredFields: remediation.retry.requiredFields,
      missingFields: remediation.retry.missingFields,
      currentContext,
    });
  }

  let state: RuntimeReconstructionState;
  if (!activeLike) {
    state = "no_active_entitlement";
  } else if (!hostingRuntime.connected) {
    state = "hosting_runtime_unavailable";
  } else if (binding?.tenantId) {
    state = "runtime_linked";
  } else if (candidates.length > 0) {
    state = "existing_tenant_candidate";
  } else {
    state = "runtime_reconstruction_required";
  }

  const malformedJobs = jobs.filter((job) => job.malformed).length;
  const readyToRetryJobs = jobs.filter((job) => job.readyToRetry).length;
  const missingContext = uniqueStrings(
    jobs.flatMap((job) => job.missingFields),
  );
  const availableHistoricalTenants = historicalTenants.filter(
    (entry) => entry.state === "available",
  ).length;
  const missingHistoricalTenants = historicalTenants.filter(
    (entry) => entry.state === "missing",
  ).length;

  const recommendedAction =
    state === "runtime_linked"
      ? "review_current_binding_then_reconcile"
      : state === "existing_tenant_candidate"
        ? "review_and_bind_existing_tenant"
        : state === "runtime_reconstruction_required"
          ? "create_current_tenant_then_bind_and_reconcile"
          : state === "hosting_runtime_unavailable"
            ? "restore_hosting_runtime_before_recovery"
            : "review_entitlement_before_runtime_work";

  const explanation =
    state === "runtime_reconstruction_required"
      ? malformedJobs > 0
        ? "No current MigraPanel tenant or binding exists. Historical jobs include malformed envelopes and must not be replayed. Create a current tenant, bind it, then run a fresh signed entitlement reconciliation with current hosting context."
        : "No current MigraPanel tenant or binding exists. Historical jobs do not contain enough hosting context to provision safely. Create a current tenant, bind it, then provide current service and edge context before retry or reconciliation."
      : state === "existing_tenant_candidate"
        ? "MigraPanel has one or more possible tenants, but none is currently bound. Verify ownership and runtime evidence before creating an audited binding."
        : state === "runtime_linked"
          ? "A current MigraPanel tenant binding exists. Review the live recovery context before reconciling or retrying historical provisioning."
          : state === "hosting_runtime_unavailable"
            ? "MigraPanel runtime evidence is unavailable. Provisioning recovery is blocked until the hosting data source is healthy."
            : "There is no active-like MigraHosting entitlement to reconstruct.";

  return {
    generatedAt: new Date().toISOString(),
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      isMigraHostingClient: organization.isMigraHostingClient,
    },
    entitlement: entitlement
      ? {
          id: entitlement.id,
          status: entitlement.status,
          notes: entitlement.notes,
          startsAt: entitlement.startsAt
            ? new Date(entitlement.startsAt).toISOString()
            : null,
          endsAt: entitlement.endsAt
            ? new Date(entitlement.endsAt).toISOString()
            : null,
          updatedAt: new Date(entitlement.updatedAt).toISOString(),
          activeLike,
        }
      : null,
    hostingRuntime: {
      configured: hostingRuntime.configured,
      connected: hostingRuntime.connected,
      ...(typeof hostingRuntime.latencyMs === "number"
        ? { latencyMs: hostingRuntime.latencyMs }
        : {}),
      error: hostingRuntime.error
        ? "MigraPanel hosting data source is unavailable."
        : null,
    },
    binding: binding
      ? {
          nodeId: binding.nodeId,
          tenantId: binding.tenantId,
          displayName: binding.displayName,
          status: binding.status,
          createdAt: binding.createdAt,
          updatedAt: binding.updatedAt,
        }
      : null,
    candidates,
    provenance: provenanceResult.rows.map((row) => ({
      source: row.source,
      tenantId: row.tenantId,
      monthlyRevenue:
        row.monthlyRevenue === null ? null : Number(row.monthlyRevenue),
      createdAt: new Date(row.createdAt).toISOString(),
    })),
    historicalTenants,
    jobs,
    diagnosis: {
      state,
      recommendedAction,
      explanation,
      currentBinding: Boolean(binding?.tenantId),
      candidateCount: candidates.length,
      historicalTenantCount: historicalTenants.length,
      availableHistoricalTenants,
      missingHistoricalTenants,
      deadJobs: jobs.length,
      malformedJobs,
      readyToRetryJobs,
      missingContext,
      legacyReplayBlocked: malformedJobs > 0,
    },
    safety: {
      readOnly: true,
      noAutomaticBinding: true,
      noAutomaticTenantCreation: true,
      noAutomaticEntitlementChange: true,
      noAutomaticReplay: true,
    },
  };
}
