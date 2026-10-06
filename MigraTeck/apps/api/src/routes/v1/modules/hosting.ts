import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  requireOrganizationPrincipal,
  requirePlatformAuthority,
} from "../../../lib/migraauth.js";
import {
  bindOrganizationToMigraPanelTenant,
  getHostingRecoveryCandidateByTenantId,
  getOrganizationHostingSnapshot,
  searchMigraPanelTenants,
  unbindOrganizationFromMigraPanelTenant,
} from "../../../lib/hosting-integration.js";

const tenantSearchSchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const organizationParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
});

const tenantParamsSchema = z.object({
  tenantId: z.string().trim().min(1).max(120),
});

const bindingBodySchema = z.object({
  tenantId: z.string().uuid(),
});

export async function registerHostingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/hosting", async (request) => {
    const principal = await requireOrganizationPrincipal(request, [
      "OWNER",
      "ADMIN",
      "MEMBER",
    ]);

    return {
      organization: {
        id: principal.membership.id,
        name: principal.membership.name,
        slug: principal.membership.slug,
        role: principal.membership.role,
      },
      ...(await getOrganizationHostingSnapshot(principal.platformOrgId)),
      operationBoundary: {
        mode: "observe_here_operate_in_migrapanel",
        consoleBaseUrl:
          process.env.MIGRAPANEL_CONSOLE_URL?.trim() || "https://migrapanel.com",
      },
    };
  });

  app.get("/hosting/tenants", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.hosting.read",
    ]);
    const query = tenantSearchSchema.parse(request.query);

    return {
      canManageBindings: authority.permissions.includes(
        "platform.hosting.bindings.manage",
      ),
      tenants: await searchMigraPanelTenants(query.q, query.limit),
    };
  });

  app.get(
    "/hosting/tenants/:tenantId/recovery-context",
    async (request) => {
      await requirePlatformAuthority(request, ["platform.hosting.read"]);
      const { tenantId } = tenantParamsSchema.parse(request.params);
      return {
        candidate: await getHostingRecoveryCandidateByTenantId(tenantId),
      };
    },
  );

  app.put("/hosting/organizations/:orgId/binding", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.hosting.bindings.manage",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    const body = bindingBodySchema.parse(request.body);

    return {
      binding: await bindOrganizationToMigraPanelTenant({
        orgId,
        tenantId: body.tenantId,
        actorId: authority.platformUserId,
        request,
      }),
    };
  });

  app.delete("/hosting/organizations/:orgId/binding", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.hosting.bindings.manage",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);

    return unbindOrganizationFromMigraPanelTenant({
      orgId,
      actorId: authority.platformUserId,
      request,
    });
  });
}
