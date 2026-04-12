import { writeAuditLog } from "@migrateck/audit-core";
import { recordSecurityEvent } from "@migrateck/events";
import { hashRefreshToken } from "@/lib/auth/access-token";
import { revokeRefreshSessionByHash } from "@/lib/auth/refresh-session";
import { prisma } from "@/lib/prisma";

export async function logoutIdentitySession(input: {
  refreshToken?: string | null | undefined;
  currentSessionToken?: string | null | undefined;
  userId?: string | null | undefined;
  orgId?: string | null | undefined;
  ip: string;
  userAgent: string;
}) {
  if (input.refreshToken) {
    await revokeRefreshSessionByHash(hashRefreshToken(input.refreshToken));
  }

  if (input.userId && input.currentSessionToken) {
    await prisma.session.deleteMany({
      where: {
        userId: input.userId,
        sessionToken: input.currentSessionToken,
      },
    });
  }

  if (input.userId) {
    await writeAuditLog({
      userId: input.userId,
      orgId: input.orgId ?? null,
      action: "AUTH_LOGOUT",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await recordSecurityEvent({
      userId: input.userId,
      orgId: input.orgId ?? null,
      eventType: "SESSION_REVOKED",
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
}