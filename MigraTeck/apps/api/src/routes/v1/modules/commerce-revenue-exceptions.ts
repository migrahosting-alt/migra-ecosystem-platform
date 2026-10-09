import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getRevenueExceptions,
  REVENUE_EXCEPTION_KINDS,
} from "../../../lib/commerce-revenue-exceptions.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";

const querySchema = z.object({
  kind: z.enum(REVENUE_EXCEPTION_KINDS).optional(),
  severity: z.enum(["critical", "warning"]).optional(),
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export async function registerCommerceRevenueExceptionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/commerce/revenue-exceptions", async (request) => {
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
      ...(await getRevenueExceptions({
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.q ? { q: query.q } : {}),
        limit: query.limit,
        offset: query.offset,
      })),
    };
  });
}
