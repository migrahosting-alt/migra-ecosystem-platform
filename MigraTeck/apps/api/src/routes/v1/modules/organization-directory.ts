import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createAuthPlatformOrganization,
  listAuthPlatformOrganizations,
  listAuthPlatformUsers,
  requirePlatformAuthority,
  type AuthPlatformOrganization,
} from "../../../lib/migraauth.js";
import {
  auditOrganizationIdentityCreateLinkFailure,
  getOrganizationDirectory,
  getOrganizationIdentityCreationSeed,
  linkOrganizationIdentity,
  setOrganizationPlatformInternal,
  syncOrganizationIdentityMetadata,
} from "../../../lib/organization-directory.js";

const directoryQuerySchema = z.object({
  q: z.string().trim().max(160).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const organizationParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(160),
});

const identityBodySchema = z.object({
  authOrganizationId: z.string().uuid(),
});

const identityUserQuerySchema = z.object({
  q: z.string().trim().max(160).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const identityCreateBodySchema = z.object({
  ownerUserId: z.string().uuid(),
});

const organizationClassificationSchema = z.object({
  isPlatformInternal: z.boolean(),
});

async function loadAllIdentityOrganizations(
  request: Parameters<typeof listAuthPlatformOrganizations>[0],
): Promise<{ organizations: AuthPlatformOrganization[]; total: number }> {
  const first = await listAuthPlatformOrganizations(request, {
    limit: 100,
    offset: 0,
  });
  const organizations = [...first.organizations];
  let offset = first.organizations.length;

  while (offset < first.total && offset < 1000) {
    const page = await listAuthPlatformOrganizations(request, {
      limit: 100,
      offset,
    });
    organizations.push(...page.organizations);
    if (page.organizations.length === 0) break;
    offset += page.organizations.length;
  }

  return {
    organizations,
    total: first.total,
  };
}

function findIdentity(
  organizations: AuthPlatformOrganization[],
  id: string,
): AuthPlatformOrganization {
  const identity = organizations.find((organization) => organization.id === id);
  if (!identity) {
    throw Object.assign(new Error("MigraAuth organization not found"), { statusCode: 404 });
  }
  return identity;
}

export async function registerOrganizationDirectoryRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/organizations/directory", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.organizations.read",
    ]);
    const query = directoryQuerySchema.parse(request.query);
    const identity = await loadAllIdentityOrganizations(request);

    return {
      authority: {
        roles: authority.roles,
        canManage: authority.permissions.includes("platform.organizations.manage"),
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getOrganizationDirectory({
        authOrganizations: identity.organizations,
        authTotal: identity.total,
        query: query.q,
        limit: query.limit,
        offset: query.offset,
      })),
    };
  });

  app.get("/organizations/identity-users", async (request) => {
    await requirePlatformAuthority(request, [
      "platform.organizations.manage",
    ]);
    const query = identityUserQuerySchema.parse(request.query);
    const directory = await listAuthPlatformUsers(request, {
      q: query.q,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      users: directory.users.filter((user) =>
        ["ACTIVE", "PENDING"].includes(user.status),
      ),
      total: directory.total,
      limit: directory.limit,
      offset: directory.offset,
    };
  });

  app.post("/organizations/:orgId/create-identity", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.organizations.manage",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    const body = identityCreateBodySchema.parse(request.body);
    const platform = await getOrganizationIdentityCreationSeed(orgId);

    const identity = await createAuthPlatformOrganization(request, {
      name: platform.name,
      slug: platform.slug,
      ownerUserId: body.ownerUserId,
    });

    try {
      const linkage = await linkOrganizationIdentity({
        actorId: authority.platformUserId,
        platformOrgId: orgId,
        identity,
        request,
      });

      return reply.code(201).send({
        created: true,
        linked: true,
        identity,
        linkage,
      });
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Unknown Platform linkage failure";

      await auditOrganizationIdentityCreateLinkFailure({
        actorId: authority.platformUserId,
        platformOrgId: orgId,
        authOrganizationId: identity.id,
        ownerUserId: body.ownerUserId,
        request,
        reason,
      });

      return reply.code(502).send({
        error: {
          code: "identity_created_link_failed",
          message:
            "MigraAuth organization was created, but Platform linking failed: " +
            reason +
            " Refresh the directory; the new identity organization will appear as identity-only and can be linked after the conflict is resolved.",
        },
      });
    }
  });

  app.patch("/organizations/:orgId/classification", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.organizations.manage",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    const body = organizationClassificationSchema.parse(request.body);

    return setOrganizationPlatformInternal({
      actorId: authority.platformUserId,
      platformOrgId: orgId,
      isPlatformInternal: body.isPlatformInternal,
      request,
    });
  });

  app.post("/organizations/:orgId/link-identity", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.organizations.manage",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    const body = identityBodySchema.parse(request.body);
    const identity = await loadAllIdentityOrganizations(request);
    const authOrganization = findIdentity(
      identity.organizations,
      body.authOrganizationId,
    );

    return linkOrganizationIdentity({
      actorId: authority.platformUserId,
      platformOrgId: orgId,
      identity: authOrganization,
      request,
    });
  });

  app.post("/organizations/:orgId/sync-identity", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.organizations.manage",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    const body = identityBodySchema.parse(request.body);
    const identity = await loadAllIdentityOrganizations(request);
    const authOrganization = findIdentity(
      identity.organizations,
      body.authOrganizationId,
    );

    return syncOrganizationIdentityMetadata({
      actorId: authority.platformUserId,
      platformOrgId: orgId,
      identity: authOrganization,
      request,
    });
  });
}
