import type { FastifyInstance } from "fastify";
import { z } from "zod";

const artifactSchema = z.object({
  channel: z.enum(["stable", "beta"]).default("stable"),
});

export async function registerDownloadRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/downloads", async (request) => {
    const query = artifactSchema.parse(request.query);

    return {
      status: "prepared",
      channel: query.channel,
      checksum: "pending-publish",
      verifiedSource: true,
    };
  });
}
