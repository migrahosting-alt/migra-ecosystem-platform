import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCommerceAuditEvidence } from "../../../lib/commerce-audit.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";

const querySchema = z.object({
  family: z
    .enum(["billing", "entitlement", "provisioning", "revenue", "usage"])
    .optional(),
  action: z.string().trim().max(160).optional(),
  orgId: z.string().trim().max(160).optional(),
  actorId: z.string().trim().max(160).optional(),
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export async function registerCommerceAuditRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/commerce/audit", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const query = querySchema.parse(request.query);

    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.commerce."),
        ),
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getCommerceAuditEvidence({
        ...(query.family ? { family: query.family } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.orgId ? { orgId: query.orgId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.q ? { q: query.q } : {}),
        limit: query.limit,
        offset: query.offset,
      })),
    };
  });
}
