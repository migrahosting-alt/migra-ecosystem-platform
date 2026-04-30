import { query } from "../../db/client.js";
import { requireAuth } from "../../lib/auth.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

const CreateSiteSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().max(255).optional(),
});

const UpdateSiteSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().max(255).optional().nullable(),
  status: z.enum(["active", "archived"]).optional(),
});

export async function registerSitesRoutes(app: FastifyInstance): Promise<void> {
  // List sites for current user
  app.get("/sites", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const { rows } = await query(
      `SELECT id, owner_id, name, domain, status, created_at, updated_at
       FROM mb_sites WHERE owner_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return reply.send({ sites: rows });
  });

  // Create site
  app.post("/sites", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateSiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const userId = request.authUser!.sub;
    const { name, domain } = parsed.data;

    const { rows } = await query(
      `INSERT INTO mb_sites (owner_id, name, domain)
       VALUES ($1, $2, $3)
       RETURNING id, owner_id, name, domain, status, created_at, updated_at`,
      [userId, name, domain ?? null],
    );
    return reply.code(201).send({ site: rows[0] });
  });

  // Get single site
  app.get("/sites/:siteId", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const userId = request.authUser!.sub;

    const { rows } = await query(
      `SELECT id, owner_id, name, domain, status, created_at, updated_at
       FROM mb_sites WHERE id = $1 AND owner_id = $2`,
      [siteId, userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    return reply.send({ site: rows[0] });
  });

  // Update site
  app.patch("/sites/:siteId", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const userId = request.authUser!.sub;

    const parsed = UpdateSiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const { name, domain, status } = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [siteId, userId];

    if (name !== undefined) { sets.push(`name = $${vals.length + 1}`); vals.push(name); }
    if (domain !== undefined) { sets.push(`domain = $${vals.length + 1}`); vals.push(domain); }
    if (status !== undefined) { sets.push(`status = $${vals.length + 1}`); vals.push(status); }
    sets.push("updated_at = NOW()");

    if (sets.length === 1) return reply.code(400).send({ error: "nothing_to_update" });

    const { rows } = await query(
      `UPDATE mb_sites SET ${sets.join(", ")}
       WHERE id = $1 AND owner_id = $2
       RETURNING id, owner_id, name, domain, status, created_at, updated_at`,
      vals,
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    return reply.send({ site: rows[0] });
  });

  // Delete site
  app.delete("/sites/:siteId", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const userId = request.authUser!.sub;

    const { rowCount } = await query(
      `DELETE FROM mb_sites WHERE id = $1 AND owner_id = $2`,
      [siteId, userId],
    );
    if (!rowCount) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });
}
