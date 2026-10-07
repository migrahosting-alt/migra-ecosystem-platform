import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrganizationPrincipal } from "../../../lib/migraauth.js";
import {
  listDownloadArtifacts,
  signDownloadArtifact,
  type DownloadMemberRole,
} from "../../../lib/downloads.js";

const artifactParamsSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
});

const DOWNLOAD_ROLES = [
  "OWNER",
  "ADMIN",
  "BILLING_ADMIN",
  "MEMBER",
] as const;

export async function registerDownloadRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/downloads", async (request) => {
    const principal = await requireOrganizationPrincipal(
      request,
      DOWNLOAD_ROLES,
    );

    return listDownloadArtifacts({
      orgId: principal.platformOrgId,
      userId: principal.platformUserId,
      role: principal.membership.role.toUpperCase() as DownloadMemberRole,
      request,
    });
  });

  app.post("/downloads/:artifactId/sign", async (request, reply) => {
    const principal = await requireOrganizationPrincipal(
      request,
      DOWNLOAD_ROLES,
    );
    const { artifactId } = artifactParamsSchema.parse(request.params);

    try {
      return await signDownloadArtifact({
        orgId: principal.platformOrgId,
        userId: principal.platformUserId,
        role: principal.membership.role.toUpperCase() as DownloadMemberRole,
        artifactId,
        request,
      });
    } catch (error) {
      const candidate = error as Error & {
        statusCode?: number;
        retryAfterSeconds?: number;
      };
      if (candidate.statusCode === 429 && candidate.retryAfterSeconds) {
        reply.header("Retry-After", String(candidate.retryAfterSeconds));
        reply.code(429);
      }
      throw error;
    }
  });
}
