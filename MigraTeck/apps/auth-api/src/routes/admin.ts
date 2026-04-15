/**
 * Admin routes — user management, audit log access.
 * These should be protected by admin role checks in production.
 */
import type { FastifyInstance } from "fastify";
import {
  adminActionSchema,
  adminAuditQuerySchema,
  adminClientListQuerySchema,
  adminUserIdSchema,
  adminUserListQuerySchema,
} from "../lib/schemas.js";
import { db } from "../lib/db.js";
import { findUserById, lockUser, unlockUser, disableUser } from "../modules/users/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { listUserSessions } from "../modules/sessions/index.js";
import { requireAuthenticatedUser, getClientIp } from "../middleware/session.js";

function serializeAuditLog(log: {
  id: string;
  actorUserId: string | null;
  actorType: string;
  targetUserId: string | null;
  clientId: string | null;
  eventType: string;
  eventData: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}) {
  return {
    id: log.id,
    actor_user_id: log.actorUserId,
    actor_type: log.actorType,
    target_user_id: log.targetUserId,
    client_id: log.clientId,
    event_type: log.eventType,
    event_data: log.eventData,
    ip_address: log.ipAddress,
    user_agent: log.userAgent,
    created_at: log.createdAt.toISOString(),
  };
}

function serializeAdminClient(client: {
  id: string;
  clientId: string;
  clientName: string;
  description: string | null;
  clientType: string;
  isActive: boolean;
  isFirstParty: boolean;
  tokenAuthMethod: string;
  allowedScopes: unknown;
  ownerUserId: string | null;
  ownerOrganizationId: string | null;
  ownerOrganization?: { id: string; name: string; slug: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: client.id,
    client_id: client.clientId,
    client_name: client.clientName,
    description: client.description,
    client_type: client.clientType,
    is_active: client.isActive,
    is_first_party: client.isFirstParty,
    token_auth_method: client.tokenAuthMethod,
    allowed_scopes: client.allowedScopes as string[],
    owner_user_id: client.ownerUserId,
    owner_org_id: client.ownerOrganizationId,
    owner_organization: client.ownerOrganization
      ? {
          id: client.ownerOrganization.id,
          name: client.ownerOrganization.name,
          slug: client.ownerOrganization.slug,
        }
      : null,
    created_at: client.createdAt.toISOString(),
    updated_at: client.updatedAt.toISOString(),
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // All admin routes require an authenticated operator (should also require admin role in production)
  app.addHook("preHandler", requireAuthenticatedUser);

  // ── GET /v1/admin/users ───────────────────────────────────────────
  app.get("/v1/admin/users", async (request, reply) => {
    const query = adminUserListQuerySchema.parse(request.query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: "insensitive" as const } },
              { displayName: { contains: query.q, mode: "insensitive" as const } },
              { givenName: { contains: query.q, mode: "insensitive" as const } },
              { familyName: { contains: query.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      db.user.count({ where }),
    ]);

    return reply.code(200).send({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        status: user.status,
        email_verified: !!user.emailVerifiedAt,
        display_name: user.displayName,
        created_at: user.createdAt.toISOString(),
        last_login_at: user.lastLoginAt?.toISOString() ?? null,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  // ── GET /v1/admin/users/:id ───────────────────────────────────────
  app.get("/v1/admin/users/:id", async (request, reply) => {
    const { id } = adminUserIdSchema.parse(request.params);
    const user = await findUserById(id);
    if (!user) {
      return reply.code(404).send({ error: { code: "not_found", message: "User not found." } });
    }

    const [memberships, sessions, recentAudit] = await Promise.all([
      db.organizationMember.findMany({
        where: { userId: id },
        include: { organization: true },
        orderBy: { createdAt: "desc" },
      }),
      listUserSessions(id),
      db.auditLog.findMany({
        where: {
          OR: [{ actorUserId: id }, { targetUserId: id }],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

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
      memberships: memberships.map((membership) => ({
        id: membership.id,
        organization_id: membership.organizationId,
        organization_name: membership.organization.name,
        organization_slug: membership.organization.slug,
        role: membership.role,
        status: membership.status,
        joined_at: membership.joinedAt?.toISOString() ?? null,
        created_at: membership.createdAt.toISOString(),
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        client_id: session.clientId,
        device_name: session.deviceName,
        ip_address: session.ipAddress,
        user_agent: session.userAgent,
        created_at: session.createdAt.toISOString(),
        last_seen_at: session.lastSeenAt?.toISOString() ?? null,
        expires_at: session.expiresAt.toISOString(),
      })),
      recent_audit: recentAudit.map(serializeAuditLog),
    });
  });

  // ── GET /v1/admin/clients ─────────────────────────────────────────
  app.get("/v1/admin/clients", async (request, reply) => {
    const query = adminClientListQuerySchema.parse(request.query);

    const where = {
      ...(query.is_active ? { isActive: query.is_active === "true" } : {}),
      ...(query.q
        ? {
            OR: [
              { clientId: { contains: query.q, mode: "insensitive" as const } },
              { clientName: { contains: query.q, mode: "insensitive" as const } },
              { description: { contains: query.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [clients, total] = await Promise.all([
      db.oAuthClient.findMany({
        where,
        include: { ownerOrganization: true },
        orderBy: { updatedAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      db.oAuthClient.count({ where }),
    ]);

    return reply.code(200).send({
      clients: clients.map(serializeAdminClient),
      total,
      limit: query.limit,
      offset: query.offset,
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
    const query = adminAuditQuerySchema.parse(request.query);

    const where = {
      ...(query.user_id
        ? {
            OR: [{ actorUserId: query.user_id }, { targetUserId: query.user_id }],
          }
        : {}),
      ...(query.event_type ? { eventType: query.event_type } : {}),
      ...(query.client_id ? { clientId: query.client_id } : {}),
    };

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      db.auditLog.count({ where }),
    ]);

    return reply.code(200).send({
      audit_logs: logs.map(serializeAuditLog),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  });
}
