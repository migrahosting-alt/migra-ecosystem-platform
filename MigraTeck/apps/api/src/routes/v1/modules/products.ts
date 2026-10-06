import type { FastifyInstance } from "fastify";
import { requireApiKeyScope } from "../../../lib/machine-auth.js";

const products = [
  "migrateck",
  "migrahosting",
  "migraintake",
  "migramail",
  "migramarketing",
  "migrapanel",
  "migrapilot",
  "migravoice",
  "migradrive",
  "migrainvoice",
] as const;

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get("/products", async (request) => {
    const principal = requireApiKeyScope(request, "products:read");

    return {
      version: "v1",
      organizationId: principal.orgId,
      credential: {
        id: principal.id,
        name: principal.name,
        publicKeyId: principal.publicKeyId,
      },
      products,
    };
  });
}
