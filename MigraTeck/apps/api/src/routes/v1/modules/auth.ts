import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPlatformIdentityDiagnostic } from "../../../lib/migraauth.js";

const sessionRequestSchema = z.object({
  organizationId: z.string().trim().min(1).max(120).optional(),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/session", async (request) => {
    const query = sessionRequestSchema.parse(request.query);
    return getPlatformIdentityDiagnostic(
      request,
      query.organizationId ?? null,
    );
  });
}
