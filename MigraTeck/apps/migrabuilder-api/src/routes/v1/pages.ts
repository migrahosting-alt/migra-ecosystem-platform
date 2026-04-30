import { query } from "../../db/client.js";
import { requireAuth } from "../../lib/auth.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

const CreatePageSchema = z.object({
  title: z.string().min(1).max(500).default("Untitled Page"),
  slug: z.string().max(500).default(""),
});

const SaveDocSchema = z.object({
  doc: z.unknown(),
  status: z.enum(["draft", "published"]).default("draft"),
});

async function assertSiteOwner(siteId: string, userId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT id FROM mb_sites WHERE id = $1 AND owner_id = $2`,
    [siteId, userId],
  );
  return rows.length > 0;
}

export async function registerPagesRoutes(app: FastifyInstance): Promise<void> {
  // List pages for a site
  app.get("/sites/:siteId/pages", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const { rows } = await query(
      `SELECT id, site_id, title, slug, status, created_at, updated_at
       FROM mb_pages WHERE site_id = $1 ORDER BY created_at DESC`,
      [siteId],
    );
    return reply.send({ pages: rows });
  });

  // Create page
  app.post("/sites/:siteId/pages", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const parsed = CreatePageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const { title, slug } = parsed.data;

    const { rows } = await query(
      `INSERT INTO mb_pages (site_id, title, slug)
       VALUES ($1, $2, $3)
       RETURNING id, site_id, title, slug, status, created_at, updated_at`,
      [siteId, title, slug],
    );
    return reply.code(201).send({ page: rows[0] });
  });

  // Get page (with doc_json)
  app.get("/sites/:siteId/pages/:pageId", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId, pageId } = request.params as { siteId: string; pageId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const { rows } = await query(
      `SELECT id, site_id, title, slug, doc_json, status, created_at, updated_at
       FROM mb_pages WHERE id = $1 AND site_id = $2`,
      [pageId, siteId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    return reply.send({ page: rows[0] });
  });

  // Save page doc (main editor save endpoint)
  app.post("/sites/:siteId/pages/:pageId/doc", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId, pageId } = request.params as { siteId: string; pageId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const parsed = SaveDocSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const { doc, status } = parsed.data;

    const { rows } = await query(
      `UPDATE mb_pages
       SET doc_json = $1, status = $2, updated_at = NOW()
       WHERE id = $3 AND site_id = $4
       RETURNING id, site_id, title, slug, status, updated_at`,
      [JSON.stringify(doc), status, pageId, siteId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    return reply.send({ success: true, page: rows[0] });
  });

  // Update page metadata (title, slug)
  app.patch("/sites/:siteId/pages/:pageId", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId, pageId } = request.params as { siteId: string; pageId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const body = request.body as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [pageId, siteId];

    if (typeof body.title === "string") { sets.push(`title = $${vals.length + 1}`); vals.push(body.title); }
    if (typeof body.slug === "string") { sets.push(`slug = $${vals.length + 1}`); vals.push(body.slug); }
    sets.push("updated_at = NOW()");

    if (sets.length === 1) return reply.code(400).send({ error: "nothing_to_update" });

    const { rows } = await query(
      `UPDATE mb_pages SET ${sets.join(", ")}
       WHERE id = $1 AND site_id = $2
       RETURNING id, site_id, title, slug, status, created_at, updated_at`,
      vals,
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    return reply.send({ page: rows[0] });
  });

  // Delete page
  app.delete("/sites/:siteId/pages/:pageId", { preHandler: requireAuth }, async (request, reply) => {
    const { siteId, pageId } = request.params as { siteId: string; pageId: string };
    const userId = request.authUser!.sub;

    if (!(await assertSiteOwner(siteId, userId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const { rowCount } = await query(
      `DELETE FROM mb_pages WHERE id = $1 AND site_id = $2`,
      [pageId, siteId],
    );
    if (!rowCount) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });
}
