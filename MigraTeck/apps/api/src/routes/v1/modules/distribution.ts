import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRODUCT_KEYS } from "../../../lib/commerce-catalog.js";
import {
  activateDistributionArtifact,
  deactivateDistributionArtifact,
  getDistributionSnapshot,
  registerDistributionArtifact,
  verifyDistributionArtifact,
} from "../../../lib/download-distribution.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";

const artifactParamsSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
});

const createArtifactSchema = z.object({
  name: z.string().trim().min(2).max(200),
  product: z.enum(PRODUCT_KEYS),
  version: z.string().trim().min(1).max(80),
  fileKey: z.string().trim().min(1).max(1024),
});

const transitionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export async function registerDistributionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/distribution/artifacts", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.downloads.read",
    ]);

    return {
      authority: {
        roles: authority.roles,
        canVerify: authority.permissions.includes("platform.downloads.verify"),
        canManage: authority.permissions.includes("platform.downloads.manage"),
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getDistributionSnapshot()),
    };
  });

  app.post("/distribution/artifacts", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.downloads.manage",
    ]);
    const body = createArtifactSchema.parse(request.body);

    const artifact = await registerDistributionArtifact({
      actorId: authority.platformUserId,
      name: body.name,
      product: body.product,
      version: body.version,
      fileKey: body.fileKey,
      request,
    });

    return reply.code(201).send({
      artifact,
      message:
        "Artifact registered inactive after deriving checksum and size from object storage.",
    });
  });

  app.post(
    "/distribution/artifacts/:artifactId/verify",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.downloads.verify",
      ]);
      const { artifactId } = artifactParamsSchema.parse(request.params);

      return verifyDistributionArtifact({
        actorId: authority.platformUserId,
        artifactId,
        request,
      });
    },
  );

  app.post(
    "/distribution/artifacts/:artifactId/activate",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.downloads.manage",
      ]);
      const { artifactId } = artifactParamsSchema.parse(request.params);
      const body = transitionSchema.parse(request.body);

      return activateDistributionArtifact({
        actorId: authority.platformUserId,
        artifactId,
        reason: body.reason,
        request,
      });
    },
  );

  app.post(
    "/distribution/artifacts/:artifactId/deactivate",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.downloads.manage",
      ]);
      const { artifactId } = artifactParamsSchema.parse(request.params);
      const body = transitionSchema.parse(request.body);

      return deactivateDistributionArtifact({
        actorId: authority.platformUserId,
        artifactId,
        reason: body.reason,
        request,
      });
    },
  );
}
