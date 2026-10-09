import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getInfrastructureHealthSnapshot } from "../../../lib/infrastructure-health.js";
import {
  getReleaseOverlaySnapshot,
  listReleaseOverlayEntries,
} from "../../../lib/release-overlay.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";

const overlayQuerySchema = z.object({
  kind: z.enum(["extra", "modified", "missing"]).optional(),
  classification: z
    .enum([
      "deployment_metadata",
      "build_evidence",
      "test_fixture",
      "public_asset",
      "runtime_source",
      "operations_source",
      "documentation",
      "repository_overlay",
    ])
    .optional(),
  action: z.string().trim().min(1).max(80).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

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

  app.get("/infrastructure/overlay", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.self.read",
    ]);
    const query = overlayQuerySchema.parse(request.query);

    return {
      authority: {
        roles: authority.roles,
        viaBootstrap: authority.viaBootstrap,
      },
      inventory: await getReleaseOverlaySnapshot(),
      page: await listReleaseOverlayEntries(query),
    };
  });
}
