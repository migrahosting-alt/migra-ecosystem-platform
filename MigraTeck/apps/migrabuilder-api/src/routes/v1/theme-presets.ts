import { query } from "../../db/client.js";
import { requireAuth } from "../../lib/auth.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

const ThemeTokensSchema = z.object({
  accent: z.string(),
  accent2: z.string(),
  bg: z.string(),
  panel: z.string(),
  panel2: z.string(),
  text: z.string(),
  muted: z.string(),
  border: z.string(),
  shadow: z.string(),
  radius: z.number(),
});

const ThemePresetSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  theme: ThemeTokensSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  pinned: z.boolean().optional(),
});

const UpsertSchema = z.object({
  scope: z.enum(["user", "global"]),
  preset: ThemePresetSchema,
});

const DeleteSchema = z.object({
  scope: z.enum(["user", "global"]),
  id: z.string(),
});

const ShareSchema = z.object({
  preset: ThemePresetSchema,
  ttlSeconds: z.number().int().positive().max(604800).optional().default(86400),
});

const ImportSchema = z.object({
  shareId: z.string(),
  scope: z.enum(["user", "global"]).default("user"),
});

function formatPresets(rows: Record<string, unknown>[]): { id: string; name: string; theme: unknown; createdAt: number; updatedAt: number; pinned: boolean }[] {
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    theme: r.theme_json,
    createdAt: new Date(String(r.created_at)).getTime(),
    updatedAt: new Date(String(r.updated_at)).getTime(),
    pinned: Boolean(r.pinned),
  }));
}

export async function registerThemePresetsRoutes(app: FastifyInstance): Promise<void> {
  // List presets
  app.get("/theme-presets", { preHandler: requireAuth }, async (request, reply) => {
    const { scope = "user" } = request.query as { scope?: string };
    const userId = request.authUser!.sub;

    let rows: Record<string, unknown>[];
    if (scope === "global") {
      ({ rows } = await query(
        `SELECT id, name, theme_json, pinned, created_at, updated_at
         FROM mb_theme_presets WHERE scope = 'global' ORDER BY created_at DESC`,
      ));
    } else {
      ({ rows } = await query(
        `SELECT id, name, theme_json, pinned, created_at, updated_at
         FROM mb_theme_presets WHERE scope = 'user' AND user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      ));
    }

    return reply.send({ scope, presets: formatPresets(rows) });
  });

  // Upsert preset
  app.post("/theme-presets/upsert", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = UpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const userId = request.authUser!.sub;
    const { scope, preset } = parsed.data;

    await query(
      `INSERT INTO mb_theme_presets (id, user_id, scope, name, theme_json, pinned)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           theme_json = EXCLUDED.theme_json,
           pinned = EXCLUDED.pinned,
           updated_at = NOW()`,
      [preset.id, scope === "user" ? userId : null, scope, preset.name, JSON.stringify(preset.theme), preset.pinned ?? false],
    );

    // Return full list for this scope
    const userPresets = scope === "user"
      ? await query(`SELECT id, name, theme_json, pinned, created_at, updated_at FROM mb_theme_presets WHERE scope = 'user' AND user_id = $1 ORDER BY created_at DESC`, [userId])
      : await query(`SELECT id, name, theme_json, pinned, created_at, updated_at FROM mb_theme_presets WHERE scope = 'global' ORDER BY created_at DESC`);

    return reply.send({ scope, presets: formatPresets(userPresets.rows) });
  });

  // Delete preset
  app.post("/theme-presets/delete", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = DeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const userId = request.authUser!.sub;
    const { scope, id } = parsed.data;

    if (scope === "global") {
      await query(`DELETE FROM mb_theme_presets WHERE id = $1 AND scope = 'global'`, [id]);
    } else {
      await query(`DELETE FROM mb_theme_presets WHERE id = $1 AND scope = 'user' AND user_id = $2`, [id, userId]);
    }

    const remaining = scope === "user"
      ? await query(`SELECT id, name, theme_json, pinned, created_at, updated_at FROM mb_theme_presets WHERE scope = 'user' AND user_id = $1 ORDER BY created_at DESC`, [userId])
      : await query(`SELECT id, name, theme_json, pinned, created_at, updated_at FROM mb_theme_presets WHERE scope = 'global' ORDER BY created_at DESC`);

    return reply.send({ scope, presets: formatPresets(remaining.rows) });
  });

  // Share preset
  app.post("/theme-presets/share", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ShareSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const { preset, ttlSeconds } = parsed.data;
    const shareId = nanoid(12);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await query(
      `INSERT INTO mb_shared_presets (id, share_id, preset_json, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [nanoid(), shareId, JSON.stringify(preset), expiresAt.toISOString()],
    );

    const url = `${process.env.CORS_ORIGINS?.split(",")[0] ?? ""}/theme-presets/shared/${shareId}`;
    return reply.send({ shareId, url, preset });
  });

  // Get shared preset
  app.get("/theme-presets/shared/:shareId", async (request, reply) => {
    const { shareId } = request.params as { shareId: string };
    const { rows } = await query(
      `SELECT share_id, preset_json, expires_at FROM mb_shared_presets
       WHERE share_id = $1 AND expires_at > NOW()`,
      [shareId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found_or_expired" });
    return reply.send({
      shareId: rows[0].share_id,
      preset: rows[0].preset_json,
      expiresAt: new Date(String(rows[0].expires_at)).getTime(),
    });
  });

  // Import from share
  app.post("/theme-presets/import", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = ImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const { shareId, scope } = parsed.data;

    const { rows } = await query(
      `SELECT preset_json FROM mb_shared_presets WHERE share_id = $1 AND expires_at > NOW()`,
      [shareId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found_or_expired" });

    const preset = rows[0].preset_json as Record<string, unknown>;
    const newId = nanoid();
    const userId = request.authUser!.sub;

    await query(
      `INSERT INTO mb_theme_presets (id, user_id, scope, name, theme_json, pinned)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [newId, scope === "user" ? userId : null, scope, preset.name ?? "Imported Preset", JSON.stringify(preset.theme)],
    );

    return reply.send({ ok: true, imported: { ...preset, id: newId } });
  });
}
