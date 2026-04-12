import { writeAuditLog } from "@migrateck/audit-core";
import { emitPlatformEvent, recordSecurityEvent } from "@migrateck/events";
import { prisma } from "@/lib/prisma";

export async function logoutAllIdentitySessions(input: {
  userId: string;
  orgId?: string | null | undefined;
  ip: string;
  userAgent: string;
}) {
  const [deletedSessions, revokedRefreshSessions] = await prisma.$transaction([
    prisma.session.deleteMany({
      where: { userId: input.userId },
    }),
    prisma.refreshSession.updateMany({
      where: {
        userId: input.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    }),
  ]);

  await writeAuditLog({
    userId: input.userId,
    orgId: input.orgId ?? null,
    action: "AUTH_LOGOUT_ALL_DEVICES",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      sessionCount: deletedSessions.count,
      refreshSessionCount: revokedRefreshSessions.count,
    },
  });
  await recordSecurityEvent({
    userId: input.userId,
    orgId: input.orgId ?? null,
    eventType: "ALL_SESSIONS_REVOKED",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      sessionCount: deletedSessions.count,
      refreshSessionCount: revokedRefreshSessions.count,
    },
  });
  await emitPlatformEvent({
    eventType: "user.login",
    source: "auth-core.logout-all",
    orgId: input.orgId || undefined,
    actorId: input.userId,
    entityType: "User",
    entityId: input.userId,
    payload: {
      action: "logout_all",
      sessionCount: deletedSessions.count,
      refreshSessionCount: revokedRefreshSessions.count,
    },
  });

  return {
    message: "All active sessions invalidated.",
    sessionCount: deletedSessions.count,
    refreshSessionCount: revokedRefreshSessions.count,
  };
}