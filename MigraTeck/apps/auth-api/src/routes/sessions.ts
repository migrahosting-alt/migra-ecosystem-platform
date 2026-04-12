/**
 * Session management routes — list and revoke sessions.
 */
import type { FastifyInstance } from "fastify";
import { sessionIdSchema } from "../lib/schemas.js";
import { listUserSessions, revokeSession } from "../modules/sessions/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { requireSession, getClientIp } from "../middleware/session.js";

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /v1/sessions ──────────────────────────────────────────────
  app.get("/v1/sessions", { preHandler: requireSession }, async (request, reply) => {
    const user = request.authUser!;
    const currentSessionId = request.authSession!.id;
    const sessions = await listUserSessions(user.id);

    return reply.code(200).send({
      sessions: sessions.map((s) => ({
        id: s.id,
        session_type: s.sessionType,
        client_id: s.clientId,
        created_at: s.createdAt.toISOString(),
        expires_at: s.expiresAt.toISOString(),
        last_seen_at: s.lastSeenAt?.toISOString() ?? null,
        ip_address: s.ipAddress,
        user_agent: s.userAgent,
        device_name: s.deviceName,
        current: s.id === currentSessionId,
      })),
    });
  });

  // ── DELETE /v1/sessions/:id ───────────────────────────────────────
  app.delete("/v1/sessions/:id", { preHandler: requireSession }, async (request, reply) => {
    const { id } = sessionIdSchema.parse(request.params);
    const user = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Verify the session belongs to the user
    const sessions = await listUserSessions(user.id);
    const target = sessions.find((s) => s.id === id);
    if (!target) {
      return reply.code(404).send({ error: { code: "not_found", message: "Session not found." } });
    }

    await revokeSession(id);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "SESSION_REVOKE",
      eventData: { sessionId: id },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ revoked: true });
  });
}
