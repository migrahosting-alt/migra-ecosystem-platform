import type { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./modules/auth.js";
import { registerDownloadRoutes } from "./modules/downloads.js";
import { registerProductRoutes } from "./modules/products.js";
import { registerBillingRoutes } from "./modules/billing.js";
import { registerBillingAdminRoutes } from "./modules/billing-admin.js";
import { registerDeveloperRoutes } from "./modules/developer.js";
import { registerWebhookRoutes } from "./modules/webhooks.js";
import { registerCommerceCatalogRoutes } from "./modules/commerce-catalog.js";
import { registerCommerceBillingRoutes } from "./modules/commerce-billing.js";
import { registerCommerceUsageRoutes } from "./modules/commerce-usage.js";
import { registerHostingRoutes } from "./modules/hosting.js";

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await app.register(async (instance) => {
    await registerAuthRoutes(instance);
    await registerProductRoutes(instance);
    await registerDownloadRoutes(instance);
    await registerBillingRoutes(instance);
    await registerBillingAdminRoutes(instance);
    await registerDeveloperRoutes(instance);
    await registerWebhookRoutes(instance);
    await registerCommerceCatalogRoutes(instance);
    await registerCommerceBillingRoutes(instance);
    await registerCommerceUsageRoutes(instance);
    await registerHostingRoutes(instance);
  }, {
    prefix: "/v1",
  });
}
