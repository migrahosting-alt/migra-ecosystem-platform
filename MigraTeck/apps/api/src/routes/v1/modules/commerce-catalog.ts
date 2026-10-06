import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import {
  ENTITLEMENT_STATUSES,
  PRODUCT_KEYS,
  getCommerceCatalogSnapshot,
  getOrganizationCommerceAccess,
  searchCommerceOrganizations,
  upsertBillingBinding,
} from "../../../lib/commerce-catalog.js";

const organizationQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const organizationParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
});

const bindingParamsSchema = z.object({
  externalPriceId: z.string().trim().min(3).max(255),
});

const bindingSchema = z.object({
  product: z.enum(PRODUCT_KEYS),
  statusOnActive: z.enum(ENTITLEMENT_STATUSES).default("ACTIVE"),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function registerCommerceCatalogRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/commerce/catalog", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);

    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.commerce."),
        ),
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getCommerceCatalogSnapshot()),
      mutationReadiness: {
        bindings: authority.permissions.includes("platform.commerce.catalog.manage"),
        entitlements: false,
        entitlementReason:
          "Manual access changes remain blocked until the provisioning job signer is aligned with the production worker.",
      },
    };
  });

  app.get("/commerce/organizations", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const query = organizationQuerySchema.parse(request.query);

    return {
      canManageEntitlements: authority.permissions.includes(
        "platform.commerce.entitlements.manage",
      ),
      organizations: await searchCommerceOrganizations(query.q, query.limit),
    };
  });

  app.get("/commerce/organizations/:orgId/entitlements", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);

    return {
      canManageEntitlements:
        authority.permissions.includes("platform.commerce.entitlements.manage") &&
        false,
      managementBlockedReason:
        "Manual access changes remain blocked until the provisioning job signer is aligned with the production worker.",
      ...(await getOrganizationCommerceAccess(orgId)),
    };
  });

  app.put("/commerce/bindings/:externalPriceId", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.catalog.manage",
    ]);
    const { externalPriceId } = bindingParamsSchema.parse(request.params);
    const body = bindingSchema.parse(request.body);

    const binding = await upsertBillingBinding({
      actorId: authority.platformUserId,
      externalPriceId,
      product: body.product,
      statusOnActive: body.statusOnActive,
      notes: body.notes ?? null,
      request,
    });

    return reply.code(200).send({ binding });
  });
}
