import type { FastifyInstance } from "fastify";

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
  app.get("/products", async () => ({
    status: "prepared",
    version: "v1",
    products,
  }));
}
