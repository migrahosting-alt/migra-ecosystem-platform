import type { FastifyInstance } from "fastify";
import { registerSitesRoutes } from "./sites.js";
import { registerPagesRoutes } from "./pages.js";
import { registerThemePresetsRoutes } from "./theme-presets.js";
import { registerSiteBrandingRoutes } from "./site-branding.js";
import { registerPreviewRoutes } from "./preview.js";

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (v1) => {
      await registerSitesRoutes(v1);
      await registerPagesRoutes(v1);
      await registerThemePresetsRoutes(v1);
      await registerSiteBrandingRoutes(v1);
      await registerPreviewRoutes(v1);
    },
    { prefix: "/api/v1" },
  );
}
