import type { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./modules/auth.js";
import { registerDownloadRoutes } from "./modules/downloads.js";
import { registerProductRoutes } from "./modules/products.js";
import { registerBillingRoutes } from "./modules/billing.js";
import { registerBillingAdminRoutes } from "./modules/billing-admin.js";

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await app.register(async (instance) => {
    await registerAuthRoutes(instance);
    await registerProductRoutes(instance);
    await registerDownloadRoutes(instance);
    await registerBillingRoutes(instance);
    await registerBillingAdminRoutes(instance);
  }, {
    prefix: "/v1",
  });
}
