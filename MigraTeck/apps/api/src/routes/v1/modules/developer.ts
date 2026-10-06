import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  allowedApiKeyScopes,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../../../lib/api-keys.js";
import { requireOrganizationPrincipal } from "../../../lib/migraauth.js";
import {
  getDeveloperUsageSnapshot,
  type UsageWindow,
} from "../../../lib/api-usage.js";

const createKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(allowedApiKeyScopes)).min(1).max(16).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const keyParamsSchema = z.object({
  keyId: z.string().min(1),
});

const usageQuerySchema = z.object({
  window: z.enum(["24h", "7d", "30d"]).default("24h"),
});

export async function registerDeveloperRoutes(app: FastifyInstance): Promise<void> {
  app.get("/developer/api-keys/scopes", async () => ({
    scopes: allowedApiKeyScopes,
    default: ["platform:read"],
  }));

  app.get("/developer/api-keys", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    return {
      organization: {
        id: principal.membership.id,
        name: principal.membership.name,
        slug: principal.membership.slug,
        role: principal.membership.role,
      },
      keys: await listApiKeys(principal.platformOrgId),
      availableScopes: allowedApiKeyScopes,
    };
  });

  app.post("/developer/api-keys", async (request, reply) => {
    const principal = await requireOrganizationPrincipal(request);
    const body = createKeySchema.parse(request.body);

    const key = await createApiKey({
      platformOrgId: principal.platformOrgId,
      platformUserId: principal.platformUserId,
      name: body.name,
      ...(body.scopes ? { scopes: body.scopes } : {}),
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      request,
    });

    return reply.code(201).send({
      key,
      warning: "Copy this API key now. The secret will not be shown again.",
    });
  });

  app.delete("/developer/api-keys/:keyId", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    const { keyId } = keyParamsSchema.parse(request.params);
    return {
      key: await revokeApiKey({
        platformOrgId: principal.platformOrgId,
        platformUserId: principal.platformUserId,
        keyId,
        request,
      }),
    };
  });

  app.get("/developer/usage", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    const query = usageQuerySchema.parse(request.query);
    return {
      organization: {
        id: principal.membership.id,
        name: principal.membership.name,
        slug: principal.membership.slug,
        role: principal.membership.role,
      },
      ...(await getDeveloperUsageSnapshot(
        principal.platformOrgId,
        query.window as UsageWindow,
      )),
    };
  });
}
