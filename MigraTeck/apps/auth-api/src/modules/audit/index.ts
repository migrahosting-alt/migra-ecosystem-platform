/**
 * Audit module — event logging for all security-relevant actions.
 * eventType is now a free-form string (varchar 80), not a Prisma enum.
 * actorType distinguishes user / system / admin / service actors.
 */
import { db } from "../../lib/db.js";
import type { AuditActorType } from "../../prisma-client.js";

const AUTH_EVENT_TYPES = new Set([
  "SIGNUP",
  "SIGNUP_VERIFIED",
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "REFRESH_SUCCESS",
  "REFRESH_FAILURE",
  "LOGOUT",
  "EMAIL_VERIFIED",
  "PASSWORD_RESET_REQUEST",
  "PASSWORD_RESET_COMPLETE",
  "SESSION_REVOKE",
  "SESSION_REVOKE_OTHERS",
  "TOKEN_REFRESH",
  "TOKEN_REUSE_DETECTED",
  "TOKEN_REVOKE",
  "MFA_ENROLL",
  "MFA_VERIFY",
  "MFA_DISABLE",
]);

const AUTH_EVENT_FAILURE_TYPES = new Set([
  "LOGIN_FAILURE",
  "REFRESH_FAILURE",
  "TOKEN_REUSE_DETECTED",
]);

function shouldPersistAuthEvent(eventType: string): boolean {
  return AUTH_EVENT_TYPES.has(eventType);
}

function inferAuthEventSuccess(eventType: string): boolean {
  return !AUTH_EVENT_FAILURE_TYPES.has(eventType);
}

function extractAuthEventIdentifier(
  eventData?: Record<string, string | number | boolean | null>,
): string | null {
  const identifier = eventData?.["identifier"];
  return typeof identifier === "string" ? identifier : null;
}

export async function logAuditEvent(params: {
  actorUserId?: string;
  actorType?: AuditActorType;
  targetUserId?: string;
  clientId?: string;
  eventType: string;
  eventData?: Record<string, string | number | boolean | null>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  const eventData = params.eventData ?? {};

  await db.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        actorUserId: params.actorUserId ?? null,
        actorType: params.actorType ?? "USER",
        targetUserId: params.targetUserId ?? null,
        clientId: params.clientId ?? null,
        eventType: params.eventType,
        eventData,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });

    if (!shouldPersistAuthEvent(params.eventType)) {
      return;
    }

    await tx.authEvent.create({
      data: {
        userId: params.actorUserId ?? params.targetUserId ?? null,
        identifier: extractAuthEventIdentifier(eventData),
        eventType: params.eventType,
        success: inferAuthEventSuccess(params.eventType),
        metadataJson: eventData,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  });
}

export async function getAuditLogs(opts: {
  userId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}) {
  return db.auditLog.findMany({
    where: {
      ...(opts.userId
        ? {
            OR: [
              { actorUserId: opts.userId },
              { targetUserId: opts.userId },
            ],
          }
        : {}),
      ...(opts.eventType ? { eventType: opts.eventType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    skip: opts.offset ?? 0,
  });
}

export async function getAuthEvents(opts: {
  userId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}) {
  return db.authEvent.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.eventType ? { eventType: opts.eventType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    skip: opts.offset ?? 0,
  });
}
