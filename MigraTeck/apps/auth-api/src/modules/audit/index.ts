/**
 * Audit module — event logging for all security-relevant actions.
 * eventType is now a free-form string (varchar 80), not a Prisma enum.
 * actorType distinguishes user / system / admin / service actors.
 */
import { db } from "../../lib/db.js";
import type { AuditActorType } from "../../prisma-client.js";

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
  await db.auditLog.create({
    data: {
      actorUserId: params.actorUserId ?? null,
      actorType: params.actorType ?? "USER",
      targetUserId: params.targetUserId ?? null,
      clientId: params.clientId ?? null,
      eventType: params.eventType,
      eventData: params.eventData ?? {},
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
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
