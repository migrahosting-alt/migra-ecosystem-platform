/**
 * Admin routes — user management, audit log access.
 * These should be protected by admin role checks in production.
 */
import type { FastifyInstance } from "fastify";
import { adminUserIdSchema, adminActionSchema } from "../lib/schemas.js";
import { findUserById, lockUser, unlockUser, disableUser } from "../modules/users/index.js";
import { getAuditLogs, logAuditEvent } from "../modules/audit/index.js";
import { requireSession, getClientIp } from "../middleware/session.js";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // All admin routes require session (should also require admin role in production)
  app.addHook("preHandler", requireSession);

  // ── GET /v1/admin/users/:id ───────────────────────────────────────
  app.get("/v1/admin/users/:id", async (request, reply) => {
    const { id } = adminUserIdSchema.parse(request.params);
    const user = await findUserById(id);
    if (!user) {
      return reply.code(404).send({ error: { code: "not_found", message: "User not found." } });
    }
    return reply.code(200).send({
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        email_verified: !!user.emailVerifiedAt,
        display_name: user.displayName,
        created_at: user.createdAt.toISOString(),
        last_login_at: user.lastLoginAt?.toISOString() ?? null,
        locked_at: user.lockedAt?.toISOString() ?? null,
        disabled_at: user.disabledAt?.toISOString() ?? null,
      },
    });
  });

  // ── POST /v1/admin/users/:id/lock ─────────────────────────────────
  app.post("/v1/admin/users/:id/lock", async (request, reply) => {
    const { id } = adminUserIdSchema.parse(request.params);
    const { reason } = adminActionSchema.parse(request.body);
    const actor = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    await lockUser(id);

    await logAuditEvent({
      actorUserId: actor.id,
      targetUserId: id,
      eventType: "ACCOUNT_LOCKED",
      eventData: { reason },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ success: true, message: "User locked." });
  });

  // ── POST /v1/admin/users/:id/unlock ───────────────────────────────
  app.post("/v1/admin/users/:id/unlock", async (request, reply) => {
    const { id } = adminUserIdSchema.parse(request.params);
    const { reason } = adminActionSchema.parse(request.body);
    const actor = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    await unlockUser(id);

    await logAuditEvent({
      actorUserId: actor.id,
      targetUserId: id,
      eventType: "ACCOUNT_UNLOCKED",
      eventData: { reason },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ success: true, message: "User unlocked." });
  });

  // ── POST /v1/admin/users/:id/disable ──────────────────────────────
  app.post("/v1/admin/users/:id/disable", async (request, reply) => {
    const { id } = adminUserIdSchema.parse(request.params);
    const { reason } = adminActionSchema.parse(request.body);
    const actor = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    await disableUser(id);

    await logAuditEvent({
      actorUserId: actor.id,
      targetUserId: id,
      eventType: "ACCOUNT_DISABLED",
      eventData: { reason },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ success: true, message: "User disabled." });
  });

  // ── GET /v1/admin/audit ───────────────────────────────────────────
  app.get("/v1/admin/audit", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const logs = await getAuditLogs({
      userId: query["user_id"],
      limit: query["limit"] ? parseInt(query["limit"], 10) : 50,
      offset: query["offset"] ? parseInt(query["offset"], 10) : 0,
    });

    return reply.code(200).send({
      audit_logs: logs.map((l) => ({
        id: l.id,
        actor_user_id: l.actorUserId,
        actor_type: l.actorType,
        target_user_id: l.targetUserId,
        client_id: l.clientId,
        event_type: l.eventType,
        event_data: l.eventData,
        ip_address: l.ipAddress,
        user_agent: l.userAgent,
        created_at: l.createdAt.toISOString(),
      })),
    });
  });
}
