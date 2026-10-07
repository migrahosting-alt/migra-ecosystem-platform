import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { AuthPlatformOrganization } from "./migraauth.js";
import { getDb } from "./db.js";

type PlatformOrganizationRow = {
  id: string;
  name: string;
  slug: string;
  authOrganizationId: string | null;
  isMigraHostingClient: boolean;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  activeEntitlementCount: number;
  subscriptionCount: number;
  pendingProvisioningCount: number;
  failedProvisioningCount: number;
  activeApiKeyCount: number;
  activeWebhookCount: number;
  intakeFormCount: number;
  hostingExternalId: string | null;
};

function runtimeFootprint(row: PlatformOrganizationRow): number {
  return (
    row.memberCount +
    row.activeEntitlementCount +
    row.subscriptionCount +
    row.pendingProvisioningCount +
    row.failedProvisioningCount +
    row.activeApiKeyCount +
    row.activeWebhookCount +
    row.intakeFormCount +
    (row.hostingExternalId ? 1 : 0)
  );
}

function linkedMetadataDrift(
  platform: PlatformOrganizationRow,
  identity: AuthPlatformOrganization | null,
) {
  if (!identity) return null;
  const name = platform.name.trim() !== identity.name.trim();
  const slug = platform.slug.trim().toLowerCase() !== identity.slug.trim().toLowerCase();
  return {
    name,
    slug,
    any: name || slug,
  };
}

function classifyPlatformOrganization(
  row: PlatformOrganizationRow,
  identity: AuthPlatformOrganization | null,
) {
  const footprint = runtimeFootprint(row);
  const drift = linkedMetadataDrift(row, identity);

  if (row.authOrganizationId && !identity) {
    return {
      state: "STALE_LINK" as const,
      needsReview: true,
      reason: "The Platform row points to a MigraAuth organization that no longer exists or is not visible.",
      footprint,
      drift,
    };
  }

  if (identity) {
    return {
      state: "LINKED" as const,
      needsReview: Boolean(drift?.any),
      reason: drift?.any
        ? "Identity linkage is valid, but Platform name/slug metadata differs from MigraAuth."
        : "Identity linkage and Platform metadata agree.",
      footprint,
      drift,
    };
  }

  if (footprint > 0) {
    return {
      state: "PLATFORM_ONLY_RUNTIME" as const,
      needsReview: true,
      reason: "This tenant has runtime or access state but no MigraAuth organization linkage.",
      footprint,
      drift: null,
    };
  }

  return {
    state: "PLATFORM_ONLY_EMPTY" as const,
    needsReview: true,
    reason: "This Platform-only organization has no detected runtime footprint.",
    footprint,
    drift: null,
  };
}

async function platformOrganizationRows(query: string, limit: number, offset: number) {
  const normalized = query.trim();
  const pattern = "%" + normalized.replace(/[%_]/g, "\$&") + "%";

  const result = await getDb().query<PlatformOrganizationRow>(
    `SELECT
       o.id,
       o.name,
       o.slug,
       o."authOrganizationId",
       o."isMigraHostingClient",
       o."createdAt",
       o."updatedAt",
       (SELECT count(*)::int
          FROM "Membership" m
         WHERE m."orgId"=o.id AND m.status='ACTIVE') AS "memberCount",
       (SELECT count(*)::int
          FROM "OrgEntitlement" e
         WHERE e."orgId"=o.id
           AND e.status IN ('ACTIVE','TRIAL','INTERNAL_ONLY')) AS "activeEntitlementCount",
       (SELECT count(*)::int
          FROM "BillingSubscription" s
         WHERE s."orgId"=o.id) AS "subscriptionCount",
       (SELECT count(*)::int
          FROM "ProvisioningJob" p
         WHERE p."orgId"=o.id
           AND p.status IN ('PENDING','RUNNING')) AS "pendingProvisioningCount",
       (SELECT count(*)::int
          FROM "ProvisioningJob" p
         WHERE p."orgId"=o.id
           AND p.status IN ('FAILED','DEAD')) AS "failedProvisioningCount",
       (SELECT count(*)::int
          FROM "ApiKey" k
         WHERE k."orgId"=o.id AND k.status='ACTIVE') AS "activeApiKeyCount",
       (SELECT count(*)::int
          FROM "OrgWebhookEndpoint" w
         WHERE w."orgId"=o.id AND w.status='ACTIVE') AS "activeWebhookCount",
       (SELECT count(*)::int
          FROM "IntakeForm" f
         WHERE f."orgId"=o.id) AS "intakeFormCount",
       (SELECT r."externalId"
          FROM "ResourceNode" r
         WHERE r."orgId"=o.id
           AND r."nodeType"='TENANT'::"ResourceNodeType"
           AND r.product='MIGRAHOSTING'::"ProductKey"
           AND r."externalId" LIKE 'migrapanel:tenant:%'
           AND r.status <> 'unlinked'
         ORDER BY r."updatedAt" DESC
         LIMIT 1) AS "hostingExternalId"
     FROM "Organization" o
     WHERE ($1='' OR o.name ILIKE $2 ESCAPE '\\' OR o.slug ILIKE $2 ESCAPE '\\')
     ORDER BY o."updatedAt" DESC, o."createdAt" DESC
     LIMIT $3 OFFSET $4`,
    [normalized, pattern, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
  );

  const total = await getDb().query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM "Organization" o
      WHERE ($1='' OR o.name ILIKE $2 ESCAPE '\\' OR o.slug ILIKE $2 ESCAPE '\\')`,
    [normalized, pattern],
  );

  return {
    rows: result.rows,
    total: Number(total.rows[0]?.count ?? 0),
  };
}

export async function getOrganizationDirectory(input: {
  authOrganizations: AuthPlatformOrganization[];
  authTotal: number;
  query?: string;
  limit?: number;
  offset?: number;
}) {
  const query = input.query?.trim() ?? "";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const platform = await platformOrganizationRows(query, limit, offset);

  const authById = new Map(input.authOrganizations.map((org) => [org.id, org]));
  const platformByAuthId = new Map(
    platform.rows
      .filter((row) => row.authOrganizationId)
      .map((row) => [row.authOrganizationId as string, row]),
  );

  const platformEntries = platform.rows.map((row) => {
    const identity = row.authOrganizationId
      ? authById.get(row.authOrganizationId) ?? null
      : null;
    const classification = classifyPlatformOrganization(row, identity);

    return {
      kind: "PLATFORM" as const,
      platform: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        authOrganizationId: row.authOrganizationId,
        isMigraHostingClient: row.isMigraHostingClient,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      identity,
      classification,
      footprint: {
        members: row.memberCount,
        activeEntitlements: row.activeEntitlementCount,
        subscriptions: row.subscriptionCount,
        pendingProvisioning: row.pendingProvisioningCount,
        failedProvisioning: row.failedProvisioningCount,
        activeApiKeys: row.activeApiKeyCount,
        activeWebhooks: row.activeWebhookCount,
        intakeForms: row.intakeFormCount,
        hostingTenantExternalId: row.hostingExternalId,
      },
    };
  });

  const normalizedQuery = query.toLowerCase();
  const authOnlyEntries = input.authOrganizations
    .filter((identity) => !platformByAuthId.has(identity.id))
    .filter(
      (identity) =>
        !normalizedQuery ||
        identity.name.toLowerCase().includes(normalizedQuery) ||
        identity.slug.toLowerCase().includes(normalizedQuery),
    )
    .map((identity) => ({
      kind: "AUTH_ONLY" as const,
      platform: null,
      identity,
      classification: {
        state: "AUTH_ONLY" as const,
        needsReview: true,
        reason: "MigraAuth organization exists without a linked Platform organization.",
        footprint: 0,
        drift: null,
      },
      footprint: null,
    }));

  const allEntries = [...platformEntries, ...authOnlyEntries];

  return {
    entries: allEntries,
    totals: {
      platform: platform.total,
      identity: input.authTotal,
      linked: platformEntries.filter((entry) => entry.classification.state === "LINKED").length,
      platformOnlyRuntime: platformEntries.filter(
        (entry) => entry.classification.state === "PLATFORM_ONLY_RUNTIME",
      ).length,
      platformOnlyEmpty: platformEntries.filter(
        (entry) => entry.classification.state === "PLATFORM_ONLY_EMPTY",
      ).length,
      staleLinks: platformEntries.filter(
        (entry) => entry.classification.state === "STALE_LINK",
      ).length,
      authOnly: authOnlyEntries.length,
      metadataDrift: platformEntries.filter(
        (entry) => Boolean(entry.classification.drift?.any),
      ).length,
      needsReview: allEntries.filter((entry) => entry.classification.needsReview).length,
    },
    limit,
    offset,
  };
}

async function audit(
  client: Pick<PoolClient, "query">,
  input: {
    actorId: string;
    action: string;
    entityId: string;
    request: FastifyRequest;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,$4,\'organization\',$3,$5,$6,$7::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId,
      input.entityId,
      input.action,
      input.request.ip ?? null,
      input.request.headers["user-agent"] ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}


export async function getOrganizationIdentityCreationSeed(platformOrgId: string) {
  const result = await getDb().query<{
    id: string;
    name: string;
    slug: string;
    authOrganizationId: string | null;
  }>(
    'SELECT id,name,slug,"authOrganizationId" FROM "Organization" WHERE id=$1',
    [platformOrgId],
  );
  const row = result.rows[0];
  if (!row) {
    throw Object.assign(new Error("Platform organization not found"), {
      statusCode: 404,
    });
  }
  if (row.authOrganizationId) {
    throw Object.assign(
      new Error(
        "Platform organization already has a MigraAuth organization link. Refresh the directory instead of creating another identity organization.",
      ),
      { statusCode: 409 },
    );
  }

  return row;
}

export async function auditOrganizationIdentityCreateLinkFailure(input: {
  actorId: string;
  platformOrgId: string;
  authOrganizationId: string;
  ownerUserId: string;
  request: FastifyRequest;
  reason: string;
}) {
  await audit(getDb(), {
    actorId: input.actorId,
    action: "ORGANIZATION_IDENTITY_CREATE_LINK_FAILED",
    entityId: input.platformOrgId,
    request: input.request,
    metadata: {
      authOrganizationId: input.authOrganizationId,
      ownerUserId: input.ownerUserId,
      reason: input.reason,
      remediation:
        "Refresh the tenant directory. The created identity organization will appear as AUTH_ONLY and can be linked manually after resolving the conflict.",
    },
  });
}

export async function linkOrganizationIdentity(input: {
  actorId: string;
  platformOrgId: string;
  identity: AuthPlatformOrganization;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const platform = await client.query<{
      id: string;
      name: string;
      slug: string;
      authOrganizationId: string | null;
    }>(
      'SELECT id,name,slug,"authOrganizationId" FROM "Organization" WHERE id=$1 FOR UPDATE',
      [input.platformOrgId],
    );
    const row = platform.rows[0];
    if (!row) {
      throw Object.assign(new Error("Platform organization not found"), { statusCode: 404 });
    }

    if (row.authOrganizationId && row.authOrganizationId !== input.identity.id) {
      throw Object.assign(
        new Error("Platform organization is already linked to a different MigraAuth organization"),
        { statusCode: 409 },
      );
    }

    const existing = await client.query<{ id: string }>(
      'SELECT id FROM "Organization" WHERE "authOrganizationId"=$1 AND id<>$2 LIMIT 1',
      [input.identity.id, input.platformOrgId],
    );
    if (existing.rows[0]) {
      throw Object.assign(
        new Error("MigraAuth organization is already linked to another Platform organization"),
        { statusCode: 409 },
      );
    }

    await client.query(
      'UPDATE "Organization" SET "authOrganizationId"=$1,"updatedAt"=NOW() WHERE id=$2',
      [input.identity.id, input.platformOrgId],
    );

    await audit(client, {
      actorId: input.actorId,
      action: "ORGANIZATION_IDENTITY_LINKED",
      entityId: input.platformOrgId,
      request: input.request,
      metadata: {
        authOrganizationId: input.identity.id,
        authName: input.identity.name,
        authSlug: input.identity.slug,
        platformName: row.name,
        platformSlug: row.slug,
      },
    });

    await client.query("COMMIT");

    return {
      linked: true,
      platformOrgId: input.platformOrgId,
      authOrganizationId: input.identity.id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function syncOrganizationIdentityMetadata(input: {
  actorId: string;
  platformOrgId: string;
  identity: AuthPlatformOrganization;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const current = await client.query<{
      id: string;
      name: string;
      slug: string;
      authOrganizationId: string | null;
    }>(
      'SELECT id,name,slug,"authOrganizationId" FROM "Organization" WHERE id=$1 FOR UPDATE',
      [input.platformOrgId],
    );
    const row = current.rows[0];
    if (!row) {
      throw Object.assign(new Error("Platform organization not found"), { statusCode: 404 });
    }
    if (row.authOrganizationId !== input.identity.id) {
      throw Object.assign(
        new Error("Organization must be linked to this MigraAuth organization before metadata can be synchronized"),
        { statusCode: 409 },
      );
    }

    const slugConflict = await client.query<{ id: string }>(
      'SELECT id FROM "Organization" WHERE lower(slug)=lower($1) AND id<>$2 LIMIT 1',
      [input.identity.slug, input.platformOrgId],
    );
    if (slugConflict.rows[0]) {
      throw Object.assign(
        new Error("Cannot synchronize identity slug because another Platform organization already uses it"),
        { statusCode: 409 },
      );
    }

    await client.query(
      'UPDATE "Organization" SET name=$1,slug=$2,"updatedAt"=NOW() WHERE id=$3',
      [input.identity.name, input.identity.slug, input.platformOrgId],
    );

    await audit(client, {
      actorId: input.actorId,
      action: "ORGANIZATION_IDENTITY_METADATA_SYNCED",
      entityId: input.platformOrgId,
      request: input.request,
      metadata: {
        before: { name: row.name, slug: row.slug },
        after: { name: input.identity.name, slug: input.identity.slug },
        authOrganizationId: input.identity.id,
      },
    });

    await client.query("COMMIT");

    return {
      synced: true,
      organization: {
        id: input.platformOrgId,
        name: input.identity.name,
        slug: input.identity.slug,
        authOrganizationId: input.identity.id,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
