/**
 * Admin routes — user management, audit log access.
 * Protected by `requireAdmin`: an explicit operator allowlist that authorizes
 * nobody when unset. Previously these were open to any signed-in user.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  adminActionSchema,
  adminAuditQuerySchema,
  adminClientListQuerySchema,
  adminUserIdSchema,
  adminUserSessionParamsSchema,
  adminUserListQuerySchema,
  platformRoleGrantSchema,
  platformRoleRevokeSchema,
} from "../lib/schemas.js";
import { db } from "../lib/db.js";
import {
  createInvitedUser,
  createPasswordResetToken,
  findIdentifierByParsedValue,
  findUserById,
  lockUserWithContainment,
  unlockUser,
  disableUserWithContainment,
} from "../modules/users/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { parseIdentifier } from "../lib/identifier.js";
import { sendInternalInviteEmail } from "../lib/email.js";
import { hasTotpEnabled, disableTotp } from "../modules/mfa/index.js";
import {
  listUserSessions,
  revokeAllUserAccessForOperator,
  revokeUserSessionForOperator,
} from "../modules/sessions/index.js";
import { requirePermission, getClientIp } from "../middleware/session.js";
import {
  grantRole,
  revokeRole,
  listGrants,
  PLATFORM_PERMISSIONS,
  rolesForUser,
} from "../modules/authorization/platformRoles.js";
import type { PlatformRole } from "../prisma-client.js";

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

async function containmentBlockReason(
  request: FastifyRequest,
  targetUserId: string,
  opts: { persistent: boolean },
): Promise<string | null> {
  const actor = request.authUser;
  if (!actor) return "Authenticated operator identity is unavailable.";

  if (opts.persistent && actor.id === targetUserId) {
    return "You cannot lock or disable your own platform operator account.";
  }

  const targetRoles = await rolesForUser(targetUserId);
  if (!targetRoles.includes("OWNER")) return null;

  if (!request.platformAuthority?.permissions.has("platform.roles.manage")) {
    return "Platform OWNER accounts can only be contained by another OWNER.";
  }

  if (!opts.persistent) return null;

  const otherActiveOwners = await db.platformRoleGrant.count({
    where: {
      role: "OWNER",
      revokedAt: null,
      userId: { not: targetUserId },
      user: { status: "ACTIVE" },
    },
  });
  if (otherActiveOwners === 0) {
    return "This is the last active platform OWNER. Make another OWNER active before suspending this account.";
  }

  return null;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /*
   * EACH ROUTE NAMES THE AUTHORITY IT NEEDS.
   *
   * This was one blanket hook over the whole surface: anyone who could read a
   * user could also disable one. That is the wrong shape for support work, which
   * is overwhelmingly "what happened to this account?" and needs no power to
   * change anything. Reading and suspending are now different permissions, so a
   * support role can exist at all.
   *
   * There is deliberately NO blanket `addHook` any more: a route added later
   * without a guard would inherit nothing and fail closed as a 401 rather than
   * silently inheriting operator authority.
   */

  /**
   * ── PLATFORM ROLES ────────────────────────────────────────────────
   *
   * Authority over authority. Only OWNER holds `platform.roles.manage`, so an
   * operator can act on accounts but cannot widen anyone's access — including
   * their own. Separating "can act" from "can decide who acts" is the reason
   * there is more than one role.
   *
   * Every grant and revocation is audited with WHO did it to WHOM. An env var
   * could record none of that, which is the point of moving off one.
   */
  app.get("/v1/admin/roles", { preHandler: requirePermission("platform.roles.manage") }, async (_request, reply) => {
    return reply.code(200).send({
      grants: (await listGrants()).map((g) => ({
        user_id: g.userId,
        email: g.email,
        role: g.role.toLowerCase(),
        granted_at: g.grantedAt.toISOString(),
        granted_by_user_id: g.grantedByUserId,
        note: g.note,
      })),
      // Published so an interface can render what a role means rather than
      // hardcoding its own copy of the bundles and drifting from the server.
      permissions: PLATFORM_PERMISSIONS,
    });
  });

  app.post<{ Body: { user_id?: string; role?: string; note?: string } }>(
    "/v1/admin/roles",
    { preHandler: requirePermission("platform.roles.manage") },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = platformRoleGrantSchema.parse(request.body ?? {});
      const role = body.role.toUpperCase() as PlatformRole;

      const outcome = await grantRole({
        userId: body.user_id,
        role,
        grantedByUserId: actor.id,
        note: body.note,
      });
      if (!outcome.ok) {
        return reply.code(outcome.code === "unknown_user" ? 404 : 409).send({
          error: { code: outcome.code, message: outcome.message },
        });
      }

      await logAuditEvent({
        actorUserId: actor.id,
        targetUserId: body.user_id,
        eventType: "PLATFORM_ROLE_GRANTED",
        eventData: { role: body.role, note: body.note ?? null },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });

      return reply.code(200).send({ granted: true, user_id: body.user_id, role: body.role });
    },
  );

  app.delete<{ Body: { user_id?: string; role?: string } }>(
    "/v1/admin/roles",
    { preHandler: requirePermission("platform.roles.manage") },
    async (request, reply) => {
      const actor = request.authUser!;
      const body = platformRoleRevokeSchema.parse(request.body ?? {});
      const role = body.role.toUpperCase() as PlatformRole;

      const outcome = await revokeRole({
        userId: body.user_id,
        role,
        revokedByUserId: actor.id,
      });
      if (!outcome.ok) {
        /*
         * `last_owner` is a 409 with an instruction, not a bare refusal: the
         * person is trying to do something reasonable and needs to know the
         * order to do it in. Same shape as refusing to unlink a last sign-in
         * method.
         */
        await logAuditEvent({
          actorUserId: actor.id,
          targetUserId: body.user_id,
          eventType: "PLATFORM_ROLE_REVOKE_REFUSED",
          eventData: { role: body.role, reason: outcome.code ?? "unknown" },
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"],
        });
        return reply.code(409).send({ error: { code: outcome.code, message: outcome.message } });
      }

      await logAuditEvent({
        actorUserId: actor.id,
        targetUserId: body.user_id,
        eventType: "PLATFORM_ROLE_REVOKED",
        eventData: { role: body.role },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });

      return reply.code(200).send({ revoked: true, user_id: body.user_id, role: body.role });
    },
  );

  /**
   * What the CALLER may do. Lets an interface hide controls it cannot use,
   * without inventing its own copy of the role bundles.
   *
   * Guarded by the weakest platform permission, so anyone with any operator
   * authority can ask — and nobody without it learns the surface exists.
   */
  app.get("/v1/admin/me", { preHandler: requirePermission("platform.self.read") }, async (request, reply) => {
    const authority = request.platformAuthority!;
    const user = request.authUser!;
    return reply.code(200).send({
      /*
       * THE CANONICAL IDENTITY, FROM THE AUTHORITY THAT ESTABLISHED IT.
       *
       * The operator tool derives its approver from this and nothing else — not
       * from a flag it was passed, and not by decoding a token itself. One
       * authority answers "who is this" and "what may they do", so the two can
       * never disagree; a caller that decoded its own token would be a second
       * opinion on the first question with no way to settle a conflict.
       */
      user_id: user.id,
      email: user.email,
      roles: authority.roles.map((r) => r.toLowerCase()),
      permissions: [...authority.permissions],
      // Surfaced so an interface can WARN that this deployment is still running
      // on the bootstrap env var instead of real grants.
      via_bootstrap: authority.viaBootstrap,
    });
  });

  // ── POST /v1/admin/users/invite ─────────────────────────────────────
  app.post<{ Body: { email?: string; display_name?: string } }>(
    "/v1/admin/users/invite",
    { preHandler: requirePermission("platform.users.create") },
    async (request, reply) => {
      const actor = request.authUser!;
      const ip = getClientIp(request);
      const ua = request.headers["user-agent"];

      const email = String(request.body?.email ?? "").trim();
      const displayName = String(request.body?.display_name ?? "").trim();

      let parsed;
      try {
        parsed = parseIdentifier(email);
      } catch (error) {
        return reply.code(400).send({
          error: {
            code: "invalid_email",
            message: error instanceof Error ? error.message : "Enter a valid email address.",
          },
        });
      }

      if (parsed.kind !== "EMAIL") {
        return reply.code(400).send({
          error: { code: "email_required", message: "Internal invitations require an email address." },
        });
      }

      const existingIdentifier = await findIdentifierByParsedValue(parsed);
      if (existingIdentifier) {
        return reply.code(409).send({
          error: {
            code: "identifier_taken",
            message: "An account with this email already exists. Add or delegate access to the existing identity instead.",
          },
        });
      }

      const created = await createInvitedUser(parsed, displayName || undefined);
      const token = await createPasswordResetToken(created.user.id, ip, ua);

      try {
        await sendInternalInviteEmail(parsed.normalized, token, displayName || undefined);
      } catch (error) {
        await logAuditEvent({
          actorUserId: actor.id,
          targetUserId: created.user.id,
          eventType: "INTERNAL_USER_INVITE_DELIVERY_FAILED",
          eventData: {
            email: parsed.normalized,
            reason: error instanceof Error ? error.message : String(error),
          },
          ipAddress: ip,
          userAgent: ua,
        });

        return reply.code(502).send({
          error: {
            code: "invite_delivery_failed",
            message: "The identity was created but the invitation email could not be delivered. Retry invitation delivery before granting authority.",
          },
          user_id: created.user.id,
        });
      }

      await logAuditEvent({
        actorUserId: actor.id,
        targetUserId: created.user.id,
        eventType: "INTERNAL_USER_INVITED",
        eventData: {
          email: parsed.normalized,
          display_name: displayName || null,
        },
        ipAddress: ip,
        userAgent: ua,
      });

      return reply.code(201).send({
        invited: true,
        user: {
          id: created.user.id,
          email: created.user.email,
          display_name: created.user.displayName,
          status: created.user.status,
        },
      });
    },
  );

  // ── GET /v1/admin/users ───────────────────────────────────────────
  app.get("/v1/admin/users", { preHandler: requirePermission("platform.users.read") }, async (request, reply) => {
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
  app.get("/v1/admin/users/:id", { preHandler: requirePermission("platform.users.read") }, async (request, reply) => {
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
  app.get("/v1/admin/clients", { preHandler: requirePermission("platform.clients.read") }, async (request, reply) => {
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
  app.post("/v1/admin/users/:id/lock", { preHandler: requirePermission("platform.users.suspend") }, async (request, reply) => {
    const { id } = adminUserIdSchema.parse(request.params);
    const { reason } = adminActionSchema.parse(request.body);
    const actor = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];
    const target = await findUserById(id);
    if (!target) {
      return reply.code(404).send({ error: { code: "not_found", message: "User not found." } });
    }

    const blocked = await containmentBlockReason(request, id, { persistent: true });
    if (blocked) {
      return reply.code(409).send({ error: { code: "protected_operator", message: blocked } });
    }

    const containment = await lockUserWithContainment(id);

    await logAuditEvent({
      actorUserId: actor.id,
      targetUserId: id,
      eventType: "ACCOUNT_LOCKED",
      eventData: {
        reason,
        revoked_sessions: containment.revokedSessions,
        revoked_refresh_tokens: containment.revokedRefreshTokens,
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      success: true,
      message: "User locked and renewable access revoked.",
      revoked_sessions: containment.revokedSessions,
      revoked_refresh_tokens: containment.revokedRefreshTokens,
    });
  });

  // ── POST /v1/admin/users/:id/unlock ───────────────────────────────
  app.post("/v1/admin/users/:id/unlock", { preHandler: requirePermission("platform.users.suspend") }, async (request, reply) => {
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
  app.post("/v1/admin/users/:id/disable", { preHandler: requirePermission("platform.users.suspend") }, async (request, reply) => {
    const { id } = adminUserIdSchema.parse(request.params);
    const { reason } = adminActionSchema.parse(request.body);
    const actor = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];
    const target = await findUserById(id);
    if (!target) {
      return reply.code(404).send({ error: { code: "not_found", message: "User not found." } });
    }

    const blocked = await containmentBlockReason(request, id, { persistent: true });
    if (blocked) {
      return reply.code(409).send({ error: { code: "protected_operator", message: blocked } });
    }

    const containment = await disableUserWithContainment(id);

    await logAuditEvent({
      actorUserId: actor.id,
      targetUserId: id,
      eventType: "ACCOUNT_DISABLED",
      eventData: {
        reason,
        revoked_sessions: containment.revokedSessions,
        revoked_refresh_tokens: containment.revokedRefreshTokens,
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      success: true,
      message: "User disabled and renewable access revoked.",
      revoked_sessions: containment.revokedSessions,
      revoked_refresh_tokens: containment.revokedRefreshTokens,
    });
  });

  // ── POST /v1/admin/users/:id/sessions/:sessionId/revoke ───────────
  app.post<{ Params: { id: string; sessionId: string } }>(
    "/v1/admin/users/:id/sessions/:sessionId/revoke",
    { preHandler: requirePermission("platform.users.sessions.manage") },
    async (request, reply) => {
      const { id, sessionId } = adminUserSessionParamsSchema.parse(request.params);
      const { reason } = adminActionSchema.parse(request.body);
      const actor = request.authUser!;
      const target = await findUserById(id);
      if (!target) {
        return reply.code(404).send({ error: { code: "not_found", message: "User not found." } });
      }

      const blocked = await containmentBlockReason(request, id, { persistent: false });
      if (blocked) {
        return reply.code(409).send({ error: { code: "protected_operator", message: blocked } });
      }

      const containment = await revokeUserSessionForOperator(id, sessionId);
      if (!containment) {
        return reply.code(404).send({
          error: { code: "not_found", message: "Active session not found for this user." },
        });
      }

      await logAuditEvent({
        actorUserId: actor.id,
        targetUserId: id,
        eventType: "ADMIN_SESSION_REVOKED",
        eventData: {
          reason,
          session_id: sessionId,
          revoked_sessions: containment.revokedSessions,
          revoked_refresh_tokens: containment.revokedRefreshTokens,
        },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });

      return reply.code(200).send({
        revoked: true,
        session_id: sessionId,
        revoked_sessions: containment.revokedSessions,
        revoked_refresh_tokens: containment.revokedRefreshTokens,
      });
    },
  );

  // ── POST /v1/admin/users/:id/sessions/revoke-all ──────────────────
  app.post<{ Params: { id: string } }>(
    "/v1/admin/users/:id/sessions/revoke-all",
    { preHandler: requirePermission("platform.users.sessions.manage") },
    async (request, reply) => {
      const { id } = adminUserIdSchema.parse(request.params);
      const { reason } = adminActionSchema.parse(request.body);
      const actor = request.authUser!;
      const target = await findUserById(id);
      if (!target) {
        return reply.code(404).send({ error: { code: "not_found", message: "User not found." } });
      }

      const blocked = await containmentBlockReason(request, id, { persistent: false });
      if (blocked) {
        return reply.code(409).send({ error: { code: "protected_operator", message: blocked } });
      }

      const containment = await revokeAllUserAccessForOperator(id);

      await logAuditEvent({
        actorUserId: actor.id,
        targetUserId: id,
        eventType: "ADMIN_SESSIONS_REVOKED",
        eventData: {
          reason,
          revoked_sessions: containment.revokedSessions,
          revoked_refresh_tokens: containment.revokedRefreshTokens,
        },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });

      return reply.code(200).send({
        revoked: true,
        revoked_sessions: containment.revokedSessions,
        revoked_refresh_tokens: containment.revokedRefreshTokens,
      });
    },
  );

  // ── GET /v1/admin/audit ───────────────────────────────────────────
  app.get("/v1/admin/audit", { preHandler: requirePermission("platform.audit.read") }, async (request, reply) => {
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

  /**
   * ── POST /v1/admin/users/:id/mfa/reset ───────────────────────────
   *
   * Clear a user's TOTP enrolment and recovery codes.
   *
   * WHY THIS HAS TO EXIST. Two-step verification is the one credential a user
   * can lose completely: the authenticator is on a device that can be wiped, and
   * the recovery codes are shown exactly once. Without an operator path, such an
   * account is unrecoverable — the disable endpoint requires precisely the thing
   * that was lost. Support cannot fix it, and neither can the owner.
   *
   * IT REMOVES A FACTOR, SO IT IS LOUD. The event names the target, not just the
   * actor, because "an operator turned off someone's second factor" is exactly
   * the action an audit trail exists to record.
   *
   * It does NOT touch sessions, providers or the password. Resetting a lost
   * factor is not a reason to sign someone out of everything.
   */
  app.post<{ Params: { id: string } }>(
    "/v1/admin/users/:id/mfa/reset",
    { preHandler: requirePermission("platform.users.mfa_reset") },
    async (request, reply) => {
      const { id } = adminUserIdSchema.parse(request.params);
      const { reason } = adminActionSchema.parse(request.body);
      const target = await findUserById(id);
      if (!target) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such user." } });
      }

      const blocked = await containmentBlockReason(request, id, { persistent: false });
      if (blocked) {
        return reply.code(409).send({ error: { code: "protected_operator", message: blocked } });
      }

      const hadTotp = await hasTotpEnabled(target.id);
      await disableTotp(target.id);
      await db.userCredential.deleteMany({
        where: { userId: target.id, type: "RECOVERY_CODE" },
      });

      await logAuditEvent({
        actorUserId: request.authUser!.id,
        targetUserId: target.id,
        eventType: "ADMIN_MFA_RESET",
        eventData: { had_totp: hadTotp, reason },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });

      return reply.code(200).send({ reset: true, had_totp: hadTotp });
    },
  );

}
