import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getCommerceRevenueAnalytics,
  REVENUE_ANALYTICS_WINDOWS,
} from "../../../lib/commerce-revenue-analytics.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";

const windowSchema = z.union([
  z.literal(REVENUE_ANALYTICS_WINDOWS[0]),
  z.literal(REVENUE_ANALYTICS_WINDOWS[1]),
  z.literal(REVENUE_ANALYTICS_WINDOWS[2]),
  z.literal(REVENUE_ANALYTICS_WINDOWS[3]),
]);

const querySchema = z.object({
  windowDays: z.coerce.number().pipe(windowSchema).default(180),
});

export async function registerCommerceRevenueAnalyticsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/commerce/revenue-analytics", async (request) => {
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
      ...(await getCommerceRevenueAnalytics({
        windowDays: query.windowDays,
      })),
    };
  });
}
