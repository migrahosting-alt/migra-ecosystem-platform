import type { FastifyInstance } from "fastify";
import { getInfrastructureHealthSnapshot } from "../../../lib/infrastructure-health.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";

export async function registerInfrastructureRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/infrastructure/health", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.self.read",
    ]);

    return {
      authority: {
        roles: authority.roles,
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getInfrastructureHealthSnapshot()),
    };
  });
}
