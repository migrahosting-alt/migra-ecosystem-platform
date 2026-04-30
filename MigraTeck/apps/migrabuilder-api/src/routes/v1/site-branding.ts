import { query } from "../../db/client.js";
import { requireAuth } from "../../lib/auth.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

const UpdateBrandingSchema = z.object({
  logoUrl: z.string().url().max(2048).nullable().optional(),
  iconUrl: z.string().url().max(2048).nullable().optional(),
});

async function assertSiteOwner(siteId: string, userId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT id FROM mb_sites WHERE id = $1 AND owner_id = $2`,
    [siteId, userId],
  );
  return rows.length > 0;
}

export async function registerSiteBrandingRoutes(app: FastifyInstance): Promise<void> {
  // Get site branding
  app.get("/sites/:siteId/branding", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const { rows } = await query(
      `SELECT logo_url, icon_url FROM mb_site_branding WHERE site_id = $1`,
      [siteId],
    );

    return reply.send({
      logoUrl: rows[0]?.logo_url ?? null,
      iconUrl: rows[0]?.icon_url ?? null,
      canManage: true,
    });
  });

  // Update site branding
  app.patch("/sites/:siteId/branding", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const parsed = UpdateBrandingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const { logoUrl, iconUrl } = parsed.data;

    await query(
      `INSERT INTO mb_site_branding (site_id, logo_url, icon_url, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (site_id) DO UPDATE
       SET logo_url = COALESCE(EXCLUDED.logo_url, mb_site_branding.logo_url),
           icon_url = COALESCE(EXCLUDED.icon_url, mb_site_branding.icon_url),
           updated_at = NOW()`,
      [siteId, logoUrl ?? null, iconUrl ?? null],
    );

    const { rows } = await query(
      `SELECT logo_url, icon_url FROM mb_site_branding WHERE site_id = $1`,
      [siteId],
    );

    return reply.send({
      logoUrl: rows[0]?.logo_url ?? null,
      iconUrl: rows[0]?.icon_url ?? null,
      canManage: true,
    });
  });
}
