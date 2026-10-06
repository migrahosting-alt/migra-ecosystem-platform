import type { FastifyInstance } from "fastify";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import { getIntakeRuntimeSnapshot } from "../../../lib/intake-integration.js";

export async function registerIntakeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/intake/runtime", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.intake.read",
    ]);

    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.intake."),
        ),
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getIntakeRuntimeSnapshot()),
    };
  });
}
