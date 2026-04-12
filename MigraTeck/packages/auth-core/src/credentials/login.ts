import { MembershipStatus, type OrgRole } from "@prisma/client";
import { writeAuditLog } from "@migrateck/audit-core";
import { emitPlatformEvent, recordSecurityEvent } from "@migrateck/events";
import { signAccessToken, generateRefreshToken, hashRefreshToken } from "@/lib/auth/access-token";
import { createUserSession } from "@/lib/auth/manual-session";
import { createRefreshSession } from "@/lib/auth/refresh-session";
import { authAccessTokenTtlSeconds, authRefreshTokenTtlDays } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/security/password";
import { assertRateLimit } from "@/lib/security/rate-limit";
import type { IdentityContextView } from "@migrateck/api-contracts";
import { AuthCoreError } from "../errors";
import { buildIdentityContext } from "../context/views";

export async function loginWithPassword(input: {
  email: string;
  password: string;
  ip: string;
  userAgent: string;
}): Promise<{
  sessionToken: string;
  sessionExpiresAt: Date;
  refreshToken: string | null;
  refreshExpiresAt: Date | null;
  activeOrgId: string | null;
  data: IdentityContextView;
}> {
  const email = input.email.toLowerCase();
  const limiter = await assertRateLimit({
    key: `${email}:${input.ip}`,
    action: "auth:v1:login",
    maxAttempts: 10,
    windowSeconds: 10 * 60,
  });

  if (!limiter.ok) {
    throw new AuthCoreError("RATE_LIMITED", "Too many login attempts. Try again later.", 429);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      emailVerified: true,
      failedLoginAttempts: true,
      accountLockedUntil: true,
      defaultOrgId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user?.passwordHash) {
    await recordSecurityEvent({
      eventType: "LOGIN_FAILED",
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { email, reason: "user_missing_or_no_password" },
    });
    throw new AuthCoreError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
  }

  if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
    await recordSecurityEvent({
      userId: user.id,
      eventType: "ACCOUNT_LOCKED",
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { lockedUntil: user.accountLockedUntil.toISOString() },
    });
    throw new AuthCoreError("ACCOUNT_LOCKED", "Account temporarily locked. Try again later.", 423);
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const lockData: { failedLoginAttempts: number; accountLockedUntil?: Date } = {
      failedLoginAttempts: attempts,
    };

    if (attempts >= 10) {
      lockData.accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: lockData,
    });

    await recordSecurityEvent({
      userId: user.id,
      eventType: attempts >= 10 ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { failedAttempts: attempts },
    });

    throw new AuthCoreError(
      attempts >= 10 ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS",
      attempts >= 10 ? "Account temporarily locked. Try again later." : "Invalid email or password.",
      attempts >= 10 ? 423 : 401,
    );
  }

  if (!user.emailVerified) {
    await recordSecurityEvent({
      userId: user.id,
      eventType: "LOGIN_FAILED",
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { reason: "email_verification_required" },
    });
    throw new AuthCoreError("EMAIL_VERIFICATION_REQUIRED", "Email verification required before login.", 403);
  }

  const memberships = await prisma.membership.findMany({
    where: {
      userId: user.id,
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

  const activeMembership = memberships.find((membership) => membership.orgId === user.defaultOrgId)
    ?? memberships[0]
    ?? null;

  const session = await createUserSession(user.id);
  const refreshToken = activeMembership ? generateRefreshToken() : null;
  const refreshExpiresAt = activeMembership
    ? new Date(Date.now() + authRefreshTokenTtlDays * 24 * 60 * 60 * 1000)
    : null;

  if (activeMembership && refreshToken && refreshExpiresAt) {
    await createRefreshSession({
      userId: user.id,
      orgId: activeMembership.orgId,
      sessionId: session.sessionId,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent: input.userAgent,
      ipAddress: input.ip,
      expiresAt: refreshExpiresAt,
    });
  }

  if (user.failedLoginAttempts > 0 || user.accountLockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        accountLockedUntil: null,
      },
    });
  }

  const accessToken = activeMembership && user.email
    ? signAccessToken({
        sub: user.id,
        orgId: activeMembership.orgId,
        role: activeMembership.role as OrgRole,
        email: user.email,
        type: "access",
      }, authAccessTokenTtlSeconds)
    : undefined;

  await writeAuditLog({
    userId: user.id,
    orgId: activeMembership?.orgId ?? null,
    action: "AUTH_LOGIN_SUCCESS",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { prunedSessions: session.prunedSessions },
  });
  await recordSecurityEvent({
    userId: user.id,
    orgId: activeMembership?.orgId ?? null,
    eventType: "LOGIN_SUCCEEDED",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordSecurityEvent({
    userId: user.id,
    orgId: activeMembership?.orgId ?? null,
    eventType: "SESSION_CREATED",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { sessionExpiresAt: session.expiresAt.toISOString() },
  });
  await emitPlatformEvent({
    eventType: "user.login",
    source: "auth-core.login",
    orgId: activeMembership?.orgId,
    actorId: user.id,
    entityType: "User",
    entityId: user.id,
  });

  return {
    sessionToken: session.sessionToken,
    sessionExpiresAt: session.expiresAt,
    refreshToken,
    refreshExpiresAt,
    activeOrgId: activeMembership?.orgId ?? null,
    data: buildIdentityContext({
      user,
      memberships,
      activeMembership,
      ...(accessToken ? { accessToken } : {}),
      session: {
        expiresAt: session.expiresAt.toISOString(),
        refreshTokenExpiresAt: refreshExpiresAt?.toISOString() ?? null,
        trusted: false,
      },
    }),
  };
}