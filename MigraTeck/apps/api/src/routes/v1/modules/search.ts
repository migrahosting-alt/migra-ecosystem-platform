import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import { searchPlatform } from "../../../lib/platform-search.js";

const querySchema = z.object({
  q: z.string().trim().min(2).max(160),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

export async function registerPlatformSearchRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/search", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.self.read",
    ]);
    const query = querySchema.parse(request.query);

    return searchPlatform(request, authority, query.q, query.limit);
  });
}
