import type { FastifyInstance } from "fastify";
import { getCommerceBillingReadiness } from "../../../lib/commerce-billing-readiness.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";

export async function registerCommerceBillingReadinessRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/commerce/billing-readiness", async (request) => {
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
      ...(await getCommerceBillingReadiness()),
    };
  });
}
