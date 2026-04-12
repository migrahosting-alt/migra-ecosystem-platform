import type { OrgRole } from "@prisma/client";
import { MembershipStatus } from "@prisma/client";
import { writeAuditLog } from "@migrateck/audit-core";
import { emitPlatformEvent, recordSecurityEvent } from "@migrateck/events";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "@/lib/auth/access-token";
import { authAccessTokenTtlSeconds, authRefreshTokenTtlDays } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { detectTokenReuse, findValidRefreshSession, revokeFamilySessions, rotateRefreshSession } from "@/lib/auth/refresh-session";
import type { IdentityContextView } from "@migrateck/api-contracts";
import { AuthCoreError } from "../errors";
import { buildIdentityContext } from "../context/views";

export async function refreshIdentitySession(input: {
  refreshToken: string;
  ip: string;
  userAgent: string;
}): Promise<{
  refreshToken: string;
  refreshExpiresAt: Date;
  activeOrgId: string;
  data: IdentityContextView;
}> {
  const tokenHash = hashRefreshToken(input.refreshToken);
  const reusedFamilyId = await detectTokenReuse(tokenHash);
  if (reusedFamilyId) {
    const revokedCount = await revokeFamilySessions(reusedFamilyId);
    await recordSecurityEvent({
      eventType: "REFRESH_TOKEN_REUSE_DETECTED",
      severity: "CRITICAL",
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { familyId: reusedFamilyId, revokedSessionCount: revokedCount },
    });
    throw new AuthCoreError("INVALID_SESSION", "Invalid session.", 401);
  }

  const session = await findValidRefreshSession(tokenHash);
  if (!session?.user.email) {
    throw new AuthCoreError("INVALID_SESSION", "Invalid session.", 401);
  }

  const memberships = await prisma.membership.findMany({
    where: {
      userId: session.userId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const activeMembership = memberships.find((membership) => membership.orgId === session.orgId);
  if (!activeMembership) {
    throw new AuthCoreError("MEMBERSHIP_NOT_FOUND", "Membership not found.", 401);
  }

  const accessToken = signAccessToken({
    sub: session.userId,
    orgId: session.orgId,
    role: activeMembership.role as OrgRole,
    email: session.user.email,
    type: "access",
  }, authAccessTokenTtlSeconds);
  const nextRefreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + authRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await rotateRefreshSession(tokenHash, {
    userId: session.userId,
    orgId: session.orgId,
    sessionId: session.sessionId,
    tokenHash: hashRefreshToken(nextRefreshToken),
    userAgent: input.userAgent,
    ipAddress: input.ip,
    expiresAt: refreshExpiresAt,
  });

  await writeAuditLog({
    userId: session.userId,
    orgId: session.orgId,
    action: "AUTH_REFRESH_ROTATED",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordSecurityEvent({
    userId: session.userId,
    orgId: session.orgId,
    eventType: "REFRESH_TOKEN_ROTATED",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await emitPlatformEvent({
    eventType: "user.login",
    source: "auth-core.refresh",
    orgId: session.orgId,
    actorId: session.userId,
    entityType: "RefreshSession",
    entityId: session.id,
  });

  return {
    refreshToken: nextRefreshToken,
    refreshExpiresAt,
    activeOrgId: session.orgId,
    data: buildIdentityContext({
      user: session.user,
      memberships,
      activeMembership,
      accessToken,
      session: {
        expiresAt: new Date(Date.now() + authAccessTokenTtlSeconds * 1000).toISOString(),
        refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
        trusted: false,
      },
    }),
  };
}