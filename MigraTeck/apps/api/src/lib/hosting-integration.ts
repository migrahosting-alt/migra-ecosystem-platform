import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { Pool, type PoolClient } from "pg";
import { getDb } from "./db.js";

const PANEL_TENANT_PREFIX = "migrapanel:tenant:";

let panelPool: Pool | null = null;

function panelConnectionString(): string | null {
  const value = process.env.MIGRAPANEL_DB_URL?.trim();
  return value || null;
}

function getPanelDb(): Pool | null {
  const connectionString = panelConnectionString();
  if (!connectionString) return null;

  if (!panelPool) {
    panelPool = new Pool({
      connectionString,
      max: Number(process.env.MIGRAPANEL_DB_POOL_MAX ?? 4),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 8_000,
      query_timeout: 8_000,
    });
  }
  return panelPool;
}

async function panelQuery<T extends Record<string, unknown>>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const pool = getPanelDb();
  if (!pool) {
    throw Object.assign(new Error("MigraPanel hosting data source is not configured"), {
      statusCode: 503,
    });
  }

  try {
    const result = await pool.query<T>(sql, [...values]);
    return result.rows;
  } catch (error) {
    throw Object.assign(
      new Error(
        "MigraPanel hosting data source is unavailable: " +
          (error instanceof Error ? error.message : "unknown database error"),
      ),
      { statusCode: 503 },
    );
  }
}

export function hostingTenantExternalId(tenantId: string): string {
  return PANEL_TENANT_PREFIX + tenantId;
}

export function tenantIdFromHostingExternalId(externalId: string | null): string | null {
  if (!externalId?.startsWith(PANEL_TENANT_PREFIX)) return null;
  const tenantId = externalId.slice(PANEL_TENANT_PREFIX.length).trim();
  return tenantId || null;
}

type HostingBindingRow = {
  id: string;
  externalId: string | null;
  displayName: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function getHostingTenantBinding(orgId: string) {
  const result = await getDb().query<HostingBindingRow>(
    `SELECT
       id,
       "externalId",
       "displayName",
       status,
       metadata,
       "createdAt",
       "updatedAt"
     FROM "ResourceNode"
     WHERE "orgId"=$1
       AND "nodeType"='TENANT'::"ResourceNodeType"
       AND product='MIGRAHOSTING'::"ProductKey"
       AND "externalId" LIKE $2
       AND status <> 'unlinked'
     ORDER BY "updatedAt" DESC
     LIMIT 1`,
    [orgId, PANEL_TENANT_PREFIX + "%"],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    nodeId: row.id,
    tenantId: tenantIdFromHostingExternalId(row.externalId),
    externalId: row.externalId,
    displayName: row.displayName,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getHostingRuntimeStatus() {
  const pool = getPanelDb();
  if (!pool) {
    return {
      configured: false,
      connected: false,
      error: "MIGRAPANEL_DB_URL is not configured for the Platform API.",
    };
  }

  const startedAt = Date.now();
  try {
    await pool.query("SELECT 1");
    return {
      configured: true,
      connected: true,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown MigraPanel DB error",
    };
  }
}

export async function getOrganizationHostingSnapshot(orgId: string) {
  const binding = await getHostingTenantBinding(orgId);
  const runtime = await getHostingRuntimeStatus();

  if (!binding?.tenantId) {
    return {
      binding,
      runtime,
      tenant: null,
      metrics: {
        totalSites: 0,
        activeSites: 0,
        totalDomains: 0,
        activeCertificates: 0,
        expiringCertificates: 0,
        recentDeployments: 0,
        openProvisioningTasks: 0,
      },
      websites: [],
      domains: [],
      certificates: [],
      deployments: [],
      provisioningTasks: [],
    };
  }

  if (!runtime.connected) {
    return {
      binding,
      runtime,
      tenant: null,
      metrics: {
        totalSites: 0,
        activeSites: 0,
        totalDomains: 0,
        activeCertificates: 0,
        expiringCertificates: 0,
        recentDeployments: 0,
        openProvisioningTasks: 0,
      },
      websites: [],
      domains: [],
      certificates: [],
      deployments: [],
      provisioningTasks: [],
    };
  }

  const tenantId = binding.tenantId;
  const [tenantRows, websites, domains, certificates, deployments, provisioningTasks] =
    await Promise.all([
      panelQuery<{
        id: string;
        name: string | null;
        slug: string | null;
        domain: string | null;
        status: string | null;
        tenant_type: string | null;
        company_name: string | null;
        updated_at: Date | null;
      }>(
        `SELECT
           id,
           name,
           slug,
           domain,
           status,
           tenant_type,
           company_name,
           updated_at
         FROM tenants
         WHERE id=$1
           AND deleted_at IS NULL
         LIMIT 1`,
        [tenantId],
      ),
      panelQuery<{
        id: string;
        name: string | null;
        domain: string;
        hostingType: string;
        runtime: string;
        status: string;
        updatedAt: Date;
      }>(
        `SELECT
           id,
           name,
           "primaryDomain" AS domain,
           "hostingType" AS "hostingType",
           runtime,
           status,
           "updatedAt"
         FROM websites
         WHERE "tenantId"=$1
         ORDER BY "updatedAt" DESC`,
        [tenantId],
      ),
      panelQuery<{
        id: string;
        websiteId: string | null;
        domain: string;
        role: string;
        status: string;
        dnsProvider: string | null;
        autoRenew: boolean | null;
        expiresAt: Date | null;
      }>(
        `SELECT
           id,
           "websiteId",
           domain,
           role,
           status,
           dnsprovider AS "dnsProvider",
           autorenew AS "autoRenew",
           expiresat AS "expiresAt"
         FROM domains
         WHERE "tenantId"=$1
         ORDER BY domain ASC`,
        [tenantId],
      ),
      panelQuery<{
        id: string;
        domainName: string;
        provider: string;
        status: string;
        autoRenew: boolean;
        issuedAt: Date | null;
        expiresAt: Date | null;
        nextRenewalAt: Date | null;
      }>(
        `SELECT
           id,
           "domainName",
           provider,
           status,
           "autoRenew",
           "issuedAt",
           "expiresAt",
           "nextRenewalAt"
         FROM ssl_certificates
         WHERE "tenantId"=$1
         ORDER BY "expiresAt" ASC NULLS LAST`,
        [tenantId],
      ),
      panelQuery<{
        id: string;
        name: string;
        type: string;
        status: string | null;
        createdAt: Date | null;
        completedAt: Date | null;
      }>(
        `SELECT
           id::text,
           name,
           type,
           status,
           created_at AS "createdAt",
           completed_at AS "completedAt"
         FROM deployments
         WHERE tenant_id=$1
         ORDER BY created_at DESC NULLS LAST
         LIMIT 30`,
        [tenantId],
      ),
      panelQuery<{
        id: string;
        serviceInstanceId: string;
        type: string;
        status: string;
        createdAt: Date;
        startedAt: Date | null;
        finishedAt: Date | null;
        errorText: string | null;
      }>(
        `SELECT
           id,
           "serviceInstanceId",
           type,
           status,
           "createdAt",
           "startedAt",
           "finishedAt",
           "errorText"
         FROM provisioning_tasks
         WHERE "tenantId"=$1
           AND status NOT IN ('completed','succeeded','canceled')
         ORDER BY "createdAt" DESC
         LIMIT 30`,
        [tenantId],
      ),
    ]);

  const tenant = tenantRows[0] ?? null;
  const now = Date.now();
  const expiringCertificates = certificates.filter((certificate) => {
    if (!certificate.expiresAt) return false;
    const expires = new Date(certificate.expiresAt).getTime();
    return expires > now && expires <= now + 30 * 86_400_000;
  }).length;

  return {
    binding,
    runtime,
    tenant,
    metrics: {
      totalSites: websites.length,
      activeSites: websites.filter((site) => site.status === "active").length,
      totalDomains: domains.length,
      activeCertificates: certificates.filter(
        (certificate) =>
          certificate.status === "active" &&
          (!certificate.expiresAt || new Date(certificate.expiresAt).getTime() > now),
      ).length,
      expiringCertificates,
      recentDeployments: deployments.filter(
        (deployment) =>
          deployment.createdAt &&
          new Date(deployment.createdAt).getTime() >= now - 7 * 86_400_000,
      ).length,
      openProvisioningTasks: provisioningTasks.length,
    },
    websites,
    domains,
    certificates,
    deployments,
    provisioningTasks,
  };
}

export async function searchMigraPanelTenants(query = "", limit = 40) {
  const normalized = query.trim();
  const pattern = "%" + normalized.replace(/[%_]/g, "\\$&") + "%";

  return panelQuery<{
    id: string;
    name: string | null;
    slug: string | null;
    domain: string | null;
    status: string | null;
    tenantType: string | null;
    companyName: string | null;
    websiteCount: number;
  }>(
    `SELECT
       t.id,
       t.name,
       t.slug,
       t.domain,
       t.status,
       t.tenant_type AS "tenantType",
       t.company_name AS "companyName",
       count(w.id)::int AS "websiteCount"
     FROM tenants t
     LEFT JOIN websites w ON w."tenantId"=t.id
     WHERE t.deleted_at IS NULL
       AND (
         $1=''
         OR COALESCE(t.name,'') ILIKE $2 ESCAPE '\\'
         OR COALESCE(t.slug,'') ILIKE $2 ESCAPE '\\'
         OR COALESCE(t.domain,'') ILIKE $2 ESCAPE '\\'
         OR COALESCE(t.company_name,'') ILIKE $2 ESCAPE '\\'
       )
     GROUP BY t.id,t.name,t.slug,t.domain,t.status,t.tenant_type,t.company_name,t."createdAt"
     ORDER BY
       CASE WHEN $1<>'' AND lower(COALESCE(t.name,''))=lower($1) THEN 0 ELSE 1 END,
       count(w.id) DESC,
       t."createdAt" ASC
     LIMIT $3`,
    [normalized, pattern, Math.min(Math.max(limit, 1), 100)],
  );
}

export type HostingRecoveryCandidate = {
  tenantId: string;
  name: string | null;
  slug: string | null;
  companyName: string | null;
  status: string | null;
  matchScore: number;
  matchReason:
    | "exact_slug"
    | "exact_name"
    | "normalized_identity"
    | "partial_match"
    | "explicit_selection";
  domains: string[];
  serviceInstances: Array<{
    id: string;
    status: string;
  }>;
  targetIps: string[];
  suggestedContext: {
    tenantId: string;
    domain?: string;
    serviceInstanceId?: string;
    targetIp?: string;
  };
};

function normalizedIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function rankRecoveryCandidate(
  tenant: {
    name: string | null;
    slug: string | null;
    companyName: string | null;
  },
  input: { orgName?: string | null; orgSlug?: string | null },
): { score: number; reason: HostingRecoveryCandidate["matchReason"] } {
  const orgSlug = input.orgSlug?.trim().toLowerCase() ?? "";
  const orgName = input.orgName?.trim().toLowerCase() ?? "";
  const tenantSlug = tenant.slug?.trim().toLowerCase() ?? "";
  const tenantName = tenant.name?.trim().toLowerCase() ?? "";
  const companyName = tenant.companyName?.trim().toLowerCase() ?? "";

  if (orgSlug && tenantSlug === orgSlug) return { score: 100, reason: "exact_slug" };
  if (orgName && (tenantName === orgName || companyName === orgName)) {
    return { score: 95, reason: "exact_name" };
  }

  const orgTokens = [normalizedIdentity(input.orgSlug), normalizedIdentity(input.orgName)]
    .filter(Boolean);
  const tenantTokens = [
    normalizedIdentity(tenant.slug),
    normalizedIdentity(tenant.name),
    normalizedIdentity(tenant.companyName),
  ].filter(Boolean);

  if (orgTokens.some((token) => tenantTokens.includes(token))) {
    return { score: 85, reason: "normalized_identity" };
  }
  return { score: 50, reason: "partial_match" };
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

async function readTenantRecoverySignals(
  tenantId: string,
  tenantDomain: string | null,
) {
  const [websites, serviceInstances, pods, targetBindings] = await Promise.all([
    panelQuery<{ primaryDomain: string; status: string }>(
      `SELECT "primaryDomain",status
       FROM websites
       WHERE "tenantId"=$1
       ORDER BY CASE WHEN lower(status)='active' THEN 0 ELSE 1 END,"updatedAt" DESC
       LIMIT 20`,
      [tenantId],
    ),
    panelQuery<{ id: string; status: string }>(
      `SELECT id,status
       FROM service_instances
       WHERE "tenantId"=$1
         AND lower("serviceType")='cloudpod'
       ORDER BY
         CASE
           WHEN lower(status) IN ('active','pending','provisioning','running') THEN 0
           WHEN lower(status)='terminated' THEN 2
           ELSE 1
         END,
         "updatedAt" DESC
       LIMIT 20`,
      [tenantId],
    ),
    panelQuery<{ ip: string | null; status: string | null }>(
      `SELECT ip,status
       FROM cloud_pods
       WHERE tenantid=$1
         AND ip IS NOT NULL
       ORDER BY CASE WHEN lower(COALESCE(status,''))='active' THEN 0 ELSE 1 END,updated_at DESC
       LIMIT 20`,
      [tenantId],
    ),
    panelQuery<{
      desiredIpAddress: string | null;
      discoveredIpAddress: string | null;
      primaryDomain: string;
    }>(
      `SELECT
         b."desiredIpAddress",
         b."discoveredIpAddress",
         w."primaryDomain"
       FROM website_target_bindings b
       JOIN websites w ON w.id=b."websiteId"
       WHERE w."tenantId"=$1
       ORDER BY b."updatedAt" DESC
       LIMIT 20`,
      [tenantId],
    ),
  ]);

  const domains = uniqueNonEmpty([
    tenantDomain,
    ...websites.map((row) => row.primaryDomain),
    ...targetBindings.map((row) => row.primaryDomain),
  ]);
  const targetIps = uniqueNonEmpty([
    ...pods.map((row) => row.ip),
    ...targetBindings.flatMap((row) => [
      row.discoveredIpAddress,
      row.desiredIpAddress,
    ]),
  ]);
  const liveServiceInstances = serviceInstances.filter(
    (row) => !["terminated", "canceled", "cancelled"].includes(row.status.toLowerCase()),
  );

  return {
    domains,
    serviceInstances,
    targetIps,
    suggested: {
      domain: domains.length === 1 ? domains[0] : undefined,
      serviceInstanceId:
        liveServiceInstances.length === 1 ? liveServiceInstances[0]?.id : undefined,
      targetIp: targetIps.length === 1 ? targetIps[0] : undefined,
    },
  };
}

export async function getHostingRecoveryCandidateByTenantId(
  tenantId: string,
): Promise<HostingRecoveryCandidate> {
  const tenant = await readPanelTenant(tenantId);
  if (!tenant) {
    throw Object.assign(new Error("MigraPanel tenant not found"), { statusCode: 404 });
  }

  const signals = await readTenantRecoverySignals(tenant.id, tenant.domain);
  return {
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    companyName: tenant.companyName,
    status: tenant.status,
    matchScore: 100,
    matchReason: "explicit_selection",
    domains: signals.domains,
    serviceInstances: signals.serviceInstances,
    targetIps: signals.targetIps,
    suggestedContext: {
      tenantId: tenant.id,
      ...(signals.suggested.domain ? { domain: signals.suggested.domain } : {}),
      ...(signals.suggested.serviceInstanceId
        ? { serviceInstanceId: signals.suggested.serviceInstanceId }
        : {}),
      ...(signals.suggested.targetIp ? { targetIp: signals.suggested.targetIp } : {}),
    },
  };
}

export async function getHostingRecoveryCandidates(input: {
  orgName?: string | null;
  orgSlug?: string | null;
  limit?: number;
}): Promise<HostingRecoveryCandidate[]> {
  const searchTerms = uniqueNonEmpty([input.orgSlug, input.orgName]);
  if (searchTerms.length === 0) return [];

  const candidateMap = new Map<
    string,
    Awaited<ReturnType<typeof searchMigraPanelTenants>>[number]
  >();

  for (const term of searchTerms) {
    const matches = await searchMigraPanelTenants(term, 15);
    for (const match of matches) candidateMap.set(match.id, match);
  }

  const ranked = [...candidateMap.values()]
    .map((tenant) => ({
      tenant,
      rank: rankRecoveryCandidate(tenant, input),
    }))
    .sort(
      (a, b) =>
        b.rank.score - a.rank.score ||
        b.tenant.websiteCount - a.tenant.websiteCount ||
        a.tenant.id.localeCompare(b.tenant.id),
    )
    .slice(0, Math.min(Math.max(input.limit ?? 5, 1), 10));

  return Promise.all(
    ranked.map(async ({ tenant, rank }) => {
      const signals = await readTenantRecoverySignals(tenant.id, tenant.domain);
      return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        companyName: tenant.companyName,
        status: tenant.status,
        matchScore: rank.score,
        matchReason: rank.reason,
        domains: signals.domains,
        serviceInstances: signals.serviceInstances,
        targetIps: signals.targetIps,
        suggestedContext: {
          tenantId: tenant.id,
          ...(signals.suggested.domain ? { domain: signals.suggested.domain } : {}),
          ...(signals.suggested.serviceInstanceId
            ? { serviceInstanceId: signals.suggested.serviceInstanceId }
            : {}),
          ...(signals.suggested.targetIp ? { targetIp: signals.suggested.targetIp } : {}),
        },
      };
    }),
  );
}

async function readPanelTenant(tenantId: string) {
  const rows = await panelQuery<{
    id: string;
    name: string | null;
    slug: string | null;
    domain: string | null;
    status: string | null;
    tenantType: string | null;
    companyName: string | null;
  }>(
    `SELECT
       id,
       name,
       slug,
       domain,
       status,
       tenant_type AS "tenantType",
       company_name AS "companyName"
     FROM tenants
     WHERE id=$1
       AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId],
  );

  return rows[0] ?? null;
}

async function auditHostingBinding(
  client: PoolClient,
  input: {
    actorId: string;
    orgId: string;
    action: string;
    entityId: string;
    request: FastifyRequest;
    metadata: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO "AuditLog"
      (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt")
     VALUES ($1,$2,$3,$4,'resource_node',$5,$6,$7,$8::jsonb,NOW())`,
    [
      randomUUID(),
      input.actorId,
      input.orgId,
      input.action,
      input.entityId,
      input.request.ip ?? null,
      input.request.headers["user-agent"] ?? null,
      JSON.stringify(input.metadata),
    ],
  );
}

export async function bindOrganizationToMigraPanelTenant(input: {
  orgId: string;
  tenantId: string;
  actorId: string;
  request: FastifyRequest;
}) {
  const tenant = await readPanelTenant(input.tenantId);
  if (!tenant) {
    throw Object.assign(new Error("MigraPanel tenant not found"), { statusCode: 404 });
  }

  const db = getDb();
  const client = await db.connect();
  const externalId = hostingTenantExternalId(tenant.id);

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "hosting-binding:" + tenant.id,
    ]);

    const organization = await client.query(
      'SELECT id,name,slug FROM "Organization" WHERE id=$1 FOR UPDATE',
      [input.orgId],
    );
    if (!organization.rows[0]) {
      throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    }

    const conflict = await client.query<{ id: string; orgId: string }>(
      `SELECT id,"orgId"
       FROM "ResourceNode"
       WHERE "nodeType"='TENANT'::"ResourceNodeType"
         AND product='MIGRAHOSTING'::"ProductKey"
         AND "externalId"=$1
         AND "orgId" IS NOT NULL
         AND "orgId"<>$2
         AND status<>'unlinked'
       LIMIT 1
       FOR UPDATE`,
      [externalId, input.orgId],
    );
    if (conflict.rows[0]) {
      throw Object.assign(
        new Error("This MigraPanel tenant is already linked to another organization"),
        { statusCode: 409 },
      );
    }

    const existing = await client.query<HostingBindingRow>(
      `SELECT id,"externalId","displayName",status,metadata,"createdAt","updatedAt"
       FROM "ResourceNode"
       WHERE "orgId"=$1
         AND "nodeType"='TENANT'::"ResourceNodeType"
         AND product='MIGRAHOSTING'::"ProductKey"
         AND status<>'unlinked'
       ORDER BY "updatedAt" DESC
       LIMIT 1
       FOR UPDATE`,
      [input.orgId],
    );

    const before = existing.rows[0] ?? null;
    const nodeId = before?.id ?? randomUUID();
    const metadata = {
      provider: "migrapanel",
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantDomain: tenant.domain,
      tenantType: tenant.tenantType,
      companyName: tenant.companyName,
      linkedAt: new Date().toISOString(),
    };

    if (before) {
      await client.query(
        `UPDATE "ResourceNode"
         SET "externalId"=$1,
             "displayName"=$2,
             status=$3,
             metadata=$4::jsonb,
             environment='production',
             "updatedAt"=NOW()
         WHERE id=$5`,
        [
          externalId,
          tenant.name ?? tenant.companyName ?? tenant.id,
          tenant.status ?? "unknown",
          JSON.stringify(metadata),
          nodeId,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO "ResourceNode"
          (id,"nodeType","externalId","displayName","orgId",product,environment,status,metadata,"createdAt","updatedAt")
         VALUES
          ($1,'TENANT'::"ResourceNodeType",$2,$3,$4,'MIGRAHOSTING'::"ProductKey",'production',$5,$6::jsonb,NOW(),NOW())`,
        [
          nodeId,
          externalId,
          tenant.name ?? tenant.companyName ?? tenant.id,
          input.orgId,
          tenant.status ?? "unknown",
          JSON.stringify(metadata),
        ],
      );
    }

    await auditHostingBinding(client, {
      actorId: input.actorId,
      orgId: input.orgId,
      action: before ? "HOSTING_TENANT_REBOUND" : "HOSTING_TENANT_BOUND",
      entityId: nodeId,
      request: input.request,
      metadata: {
        before: before
          ? {
              externalId: before.externalId,
              displayName: before.displayName,
              status: before.status,
            }
          : null,
        after: {
          tenantId: tenant.id,
          externalId,
          displayName: tenant.name ?? tenant.companyName ?? tenant.id,
          status: tenant.status ?? "unknown",
        },
      },
    });

    await client.query("COMMIT");
    return {
      nodeId,
      tenantId: tenant.id,
      externalId,
      displayName: tenant.name ?? tenant.companyName ?? tenant.id,
      status: tenant.status ?? "unknown",
      metadata,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function unbindOrganizationFromMigraPanelTenant(input: {
  orgId: string;
  actorId: string;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query<HostingBindingRow>(
      `SELECT id,"externalId","displayName",status,metadata,"createdAt","updatedAt"
       FROM "ResourceNode"
       WHERE "orgId"=$1
         AND "nodeType"='TENANT'::"ResourceNodeType"
         AND product='MIGRAHOSTING'::"ProductKey"
         AND status<>'unlinked'
       ORDER BY "updatedAt" DESC
       LIMIT 1
       FOR UPDATE`,
      [input.orgId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw Object.assign(new Error("No MigraPanel tenant binding exists"), {
        statusCode: 404,
      });
    }

    const metadata = {
      ...(row.metadata ?? {}),
      unboundAt: new Date().toISOString(),
    };
    await client.query(
      `UPDATE "ResourceNode"
       SET "orgId"=NULL,
           status='unlinked',
           metadata=$1::jsonb,
           "updatedAt"=NOW()
       WHERE id=$2`,
      [JSON.stringify(metadata), row.id],
    );

    await auditHostingBinding(client, {
      actorId: input.actorId,
      orgId: input.orgId,
      action: "HOSTING_TENANT_UNBOUND",
      entityId: row.id,
      request: input.request,
      metadata: {
        externalId: row.externalId,
        displayName: row.displayName,
      },
    });

    await client.query("COMMIT");
    return { unbound: true, nodeId: row.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
