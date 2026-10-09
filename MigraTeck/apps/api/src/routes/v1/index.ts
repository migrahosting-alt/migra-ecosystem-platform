import type { FastifyInstance } from "fastify";
import { registerDownloadRoutes } from "./modules/downloads.js";
import { registerDistributionRoutes } from "./modules/distribution.js";
import { registerProductRoutes } from "./modules/products.js";
import { registerBillingRoutes } from "./modules/billing.js";
import { registerDeveloperRoutes } from "./modules/developer.js";
import { registerCommerceCatalogRoutes } from "./modules/commerce-catalog.js";
import { registerCommerceBillingRoutes } from "./modules/commerce-billing.js";
import { registerCommerceUsageRoutes } from "./modules/commerce-usage.js";
import { registerCommerceAuditRoutes } from "./modules/commerce-audit.js";
import { registerCommerceRevenueExceptionRoutes } from "./modules/commerce-revenue-exceptions.js";
import { registerCommerceRevenueAnalyticsRoutes } from "./modules/commerce-revenue-analytics.js";
import { registerCommerceBillingReadinessRoutes } from "./modules/commerce-billing-readiness.js";
import { registerHostingRoutes } from "./modules/hosting.js";
import { registerIntakeRoutes } from "./modules/intake.js";
import { registerOrganizationDirectoryRoutes } from "./modules/organization-directory.js";
import { registerComplianceRoutes } from "./modules/compliance.js";
import { registerPlatformSearchRoutes } from "./modules/search.js";
import { registerAuthRoutes } from "./modules/auth.js";
import { registerInfrastructureRoutes } from "./modules/infrastructure.js";

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await app.register(async (instance) => {
    await registerProductRoutes(instance);
    await registerDownloadRoutes(instance);
    await registerDistributionRoutes(instance);
    await registerBillingRoutes(instance);
    await registerDeveloperRoutes(instance);
    await registerCommerceCatalogRoutes(instance);
    await registerCommerceBillingRoutes(instance);
    await registerCommerceUsageRoutes(instance);
    await registerCommerceAuditRoutes(instance);
    await registerCommerceRevenueAnalyticsRoutes(instance);
    await registerCommerceBillingReadinessRoutes(instance);
    await registerCommerceRevenueExceptionRoutes(instance);
    await registerHostingRoutes(instance);
    await registerIntakeRoutes(instance);
    await registerOrganizationDirectoryRoutes(instance);
    await registerComplianceRoutes(instance);
    await registerPlatformSearchRoutes(instance);
    await registerAuthRoutes(instance);
    await registerInfrastructureRoutes(instance);
  }, {
    prefix: "/v1",
  });
}
