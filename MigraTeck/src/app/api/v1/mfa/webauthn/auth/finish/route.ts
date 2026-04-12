import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { signAccessToken, generateRefreshToken, hashRefreshToken } from "@/lib/auth/access-token";
import { mapAuthPayload } from "@/lib/auth/auth-payload";
import { attachSessionCookie, createUserSession } from "@/lib/auth/manual-session";
import { setRefreshCookie } from "@/lib/auth/refresh-cookie";
import { createRefreshSession } from "@/lib/auth/refresh-session";
import { authAccessTokenTtlSeconds, authRefreshTokenTtlDays } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { finishAuthentication } from "@/lib/security/webauthn";
import { recordSecurityEvent } from "@/lib/security/security-events";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const challengeKey = typeof body.challengeKey === "string" ? body.challengeKey : "__discoverable__";

  try {
    const result = await finishAuthentication(challengeKey, body);
    const user = result.user;

    if (!user.email) {
      return NextResponse.json({ error: "User has no email" }, { status: 400 });
    }

    await recordSecurityEvent({
      userId: user.id,
      eventType: "PASSKEY_AUTH_SUCCESS",
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      metadata: { passkeyId: result.passkeyId },
    });

    // Create session, access token, refresh token — same pattern as login route
    const { sessionToken, expiresAt } = await createUserSession(user.id);
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

    const accessToken = membership
      ? signAccessToken({
          sub: user.id,
          orgId: membership.orgId,
          role: membership.role,
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
        userAgent: getUserAgent(request),
        ipAddress: getClientIp(request),
        expiresAt: refreshExpiresAt,
      });
    }

    await writeAuditLog({
      actorId: user.id,
      action: "AUTH_PASSKEY_LOGIN",
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      metadata: { passkeyId: result.passkeyId },
    });

    const response = NextResponse.json({
      ok: true,
      data: membership && accessToken
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
  } catch (error) {
    const ip = getClientIp(request);
    await recordSecurityEvent({
      eventType: "PASSKEY_AUTH_FAILED",
      severity: "WARNING",
      ip,
      userAgent: getUserAgent(request),
      metadata: { error: error instanceof Error ? error.message : "unknown" },
    });
    const message = error instanceof Error ? error.message : "Authentication verification failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
