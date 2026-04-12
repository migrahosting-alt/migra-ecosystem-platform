import { NextRequest, NextResponse } from "next/server";
import { OrgRole } from "@prisma/client";
import { z } from "zod";
import { signAccessToken, generateRefreshToken, hashRefreshToken } from "@/lib/auth/access-token";
import { mapAuthPayload } from "@/lib/auth/auth-payload";
import { writeAuditLog } from "@/lib/audit";
import { attachSessionCookie, createUserSession } from "@/lib/auth/manual-session";
import { setRefreshCookie } from "@/lib/auth/refresh-cookie";
import { createRefreshSession } from "@/lib/auth/refresh-session";
import { authAccessTokenTtlSeconds, authRefreshTokenTtlDays } from "@/lib/env";
import { isEmailVerificationRequiredForLogin } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { verifyPassword } from "@/lib/security/password";
import { assertRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});

export const dynamic = "force-dynamic";

function jsonNoStore(payload: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(headers || {}),
    },
  });
}

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid payload." }, 400);
  }

  const email = parsed.data.email.toLowerCase();

  const limiter = await assertRateLimit({
    key: `${email}:${ip}`,
    action: "auth:login",
    maxAttempts: 10,
    windowSeconds: 600,
  });

  if (!limiter.ok) {
    await writeAuditLog({
      action: "AUTH_LOGIN_RATE_LIMITED",
      ip,
      userAgent,
      metadata: { email },
    });

    return jsonNoStore(
      { error: "Too many login attempts. Try again later." },
      429,
      { "Retry-After": String(limiter.retryAfterSeconds) },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      emailVerified: true,
      phoneVerifiedAt: true,
      failedLoginAttempts: true,
      accountLockedUntil: true,
    },
  });

  if (!user?.passwordHash) {
    await writeAuditLog({
      action: "AUTH_LOGIN_FAILED",
      userId: user?.id,
      ip,
      userAgent,
      metadata: { reason: "user_missing_or_no_password" },
    });

    return jsonNoStore({ error: "Invalid credentials." }, 401);
  }

  // --- Account lockout check ---
  if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
    await writeAuditLog({
      action: "AUTH_LOGIN_LOCKED",
      userId: user.id,
      ip,
      userAgent,
      metadata: { lockedUntil: user.accountLockedUntil.toISOString() },
    });

    return jsonNoStore({ error: "Account temporarily locked. Try again later." }, 423);
  }

  const isValid = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!isValid) {
    const attempts = user.failedLoginAttempts + 1;
    const LOCKOUT_THRESHOLD = 10;
    const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

    const lockData: { failedLoginAttempts: number; accountLockedUntil?: Date } = {
      failedLoginAttempts: attempts,
    };

    if (attempts >= LOCKOUT_THRESHOLD) {
      lockData.accountLockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: lockData,
    });

    await writeAuditLog({
      action: attempts >= LOCKOUT_THRESHOLD ? "AUTH_LOGIN_LOCKED" : "AUTH_LOGIN_FAILED",
      userId: user.id,
      ip,
      userAgent,
      metadata: { reason: "invalid_password", failedAttempts: attempts },
    });

    if (attempts >= LOCKOUT_THRESHOLD) {
      return jsonNoStore({ error: "Account temporarily locked. Try again later." }, 423);
    }

    return jsonNoStore({ error: "Invalid credentials." }, 401);
  }

  if (isEmailVerificationRequiredForLogin && !user.emailVerified && !user.phoneVerifiedAt) {
    await writeAuditLog({
      action: "AUTH_LOGIN_FAILED",
      userId: user.id,
      ip,
      userAgent,
      metadata: { reason: "account_not_verified" },
    });

    return jsonNoStore({ error: "Account verification required." }, 403);
  }

  const { sessionToken, expiresAt, prunedSessions } = await createUserSession(user.id);
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });

  const driveTenant = membership
    ? await prisma.driveTenant.findUnique({
        where: { orgId: membership.orgId },
        select: { id: true, status: true, planCode: true, storageQuotaGb: true },
      })
    : null;

  const accessToken = membership && user.email
    ? signAccessToken({
        sub: user.id,
        orgId: membership.orgId,
        role: membership.role as OrgRole,
        email: user.email,
        type: "access",
      }, authAccessTokenTtlSeconds)
    : null;
  const refreshToken = membership ? generateRefreshToken() : null;
  const refreshExpiresAt = new Date(Date.now() + authRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

  if (membership && refreshToken) {
    await createRefreshSession({
      userId: user.id,
      orgId: membership.orgId,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent,
      ipAddress: ip,
      expiresAt: refreshExpiresAt,
    });
  }

  // Reset lockout counters on successful login
  if (user.failedLoginAttempts > 0 || user.accountLockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, accountLockedUntil: null },
    });
  }

  await writeAuditLog({
    action: "AUTH_LOGIN_SUCCESS",
    userId: user.id,
    ip,
    userAgent,
    metadata: {
      sessionPrunedCount: prunedSessions,
    },
  });

  const response = jsonNoStore({
    ok: true,
    data: membership && accessToken && user.email
      ? mapAuthPayload({
          user,
          organization: membership.org,
          membership: { role: membership.role },
          tenant: driveTenant,
          accessToken,
        })
      : {
          user: {
            id: user.id,
            fullName: user.name,
            email: user.email,
          },
        },
  });

  attachSessionCookie(request, response, sessionToken, expiresAt);
  if (refreshToken) {
    setRefreshCookie(response, refreshToken, refreshExpiresAt);
  }

  return response;
}
