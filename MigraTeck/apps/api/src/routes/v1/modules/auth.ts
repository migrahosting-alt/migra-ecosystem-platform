import type { FastifyInstance } from "fastify";
import { z } from "zod";

const sessionRequestSchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/session", async (request) => {
    const query = sessionRequestSchema.parse(request.query);

    return {
      status: "prepared",
      strategy: "future-argon2id-session-isolation",
      organizationId: query.organizationId ?? null,
    };
  });
}
