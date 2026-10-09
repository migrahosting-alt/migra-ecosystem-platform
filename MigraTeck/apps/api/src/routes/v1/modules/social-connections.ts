import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import {
  completeSocialConnectionOAuth,
  createSocialConnectionOAuthStart,
  getSocialConnectionOperationsSnapshot,
} from "../../../lib/social-connection-sync.js";

const connectionParamsSchema = z.object({
  connectionId: z.string().trim().min(1).max(160),
});

const platformParamsSchema = z.object({
  platform: z.string().trim().min(1).max(40),
});

const oauthCompleteSchema = z.object({
  code: z.string().trim().min(1).max(4096).optional(),
  state: z.string().trim().min(1).max(16384),
  providerError: z.string().trim().min(1).max(240).optional(),
});

export async function registerSocialConnectionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/social/connections", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.social.read",
    ]);
    return {
      authority: {
        canManage: authority.permissions.includes("platform.social.manage"),
      },
      ...(await getSocialConnectionOperationsSnapshot()),
    };
  });

  app.post(
    "/social/connections/:connectionId/oauth/start",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.social.manage",
      ]);
      const { connectionId } = connectionParamsSchema.parse(request.params);
      return createSocialConnectionOAuthStart({
        connectionId,
        actorId: authority.platformUserId,
      });
    },
  );

  app.post(
    "/social/connections/oauth/:platform/complete",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.social.manage",
      ]);
      const { platform } = platformParamsSchema.parse(request.params);
      const body = oauthCompleteSchema.parse(request.body);
      return completeSocialConnectionOAuth({
        platform,
        code: body.code ?? null,
        stateToken: body.state,
        actorId: authority.platformUserId,
        providerError: body.providerError ?? null,
      });
    },
  );
}
