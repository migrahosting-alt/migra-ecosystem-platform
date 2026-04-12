import { NextRequest, NextResponse } from "next/server";
import { mapAuthPayload } from "@/lib/auth/auth-payload";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "@/lib/auth/access-token";
import { readRefreshCookie, setRefreshCookie } from "@/lib/auth/refresh-cookie";
import { detectTokenReuse, findValidRefreshSession, revokeFamilySessions, rotateRefreshSession } from "@/lib/auth/refresh-session";
import { authAccessTokenTtlSeconds, authRefreshTokenTtlDays } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { recordSecurityEvent } from "@/lib/security/security-events";

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const refreshToken = readRefreshCookie(request);
  if (!refreshToken) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const tokenHash = hashRefreshToken(refreshToken);

  // ── Stolen-token detection: if the token was already revoked, kill the family ──
  const reusedFamilyId = await detectTokenReuse(tokenHash);
  if (reusedFamilyId) {
    const revokedCount = await revokeFamilySessions(reusedFamilyId);
    await recordSecurityEvent({
      eventType: "REFRESH_TOKEN_REUSE",
      severity: "CRITICAL",
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      metadata: { familyId: reusedFamilyId, revokedSessionCount: revokedCount },
    });
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const session = await findValidRefreshSession(tokenHash);
  if (!session || !session.user.email) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.userId,
      orgId: session.orgId,
    },
    include: { org: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membership not found" }, { status: 401 });
  }

  const driveTenant = await prisma.driveTenant.findUnique({
    where: { orgId: membership.orgId },
    select: { id: true, status: true, planCode: true, storageQuotaGb: true },
  });

  const accessToken = signAccessToken({
    sub: session.userId,
    orgId: session.orgId,
    role: membership.role,
    email: session.user.email,
    type: "access",
  }, authAccessTokenTtlSeconds);

  const nextRefreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + authRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await rotateRefreshSession(tokenHash, {
    userId: session.userId,
    orgId: session.orgId,
    tokenHash: hashRefreshToken(nextRefreshToken),
    userAgent: getUserAgent(request),
    ipAddress: getClientIp(request),
    expiresAt: refreshExpiresAt,
  });

  const response = NextResponse.json({
    ok: true,
    data: mapAuthPayload({
      user: session.user,
      organization: membership.org,
      membership: { role: membership.role },
      tenant: driveTenant,
      accessToken,
    }),
  });
  setRefreshCookie(response, nextRefreshToken, refreshExpiresAt);
  return response;
}