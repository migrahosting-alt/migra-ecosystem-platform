import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { consumeMagicLinkToken, normalizeMagicLinkCallbackUrl } from "@/lib/auth/magic-link";
import { attachSessionCookie, createUserSession } from "@/lib/auth/manual-session";
import { isEmailVerificationRequiredForLogin } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";

export const dynamic = "force-dynamic";

function redirectToLogin(request: NextRequest, reason: string) {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("magicLink", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const callbackUrl = normalizeMagicLinkCallbackUrl(request.nextUrl.searchParams.get("callbackUrl"));
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  if (!token) {
    return redirectToLogin(request, "invalid");
  }

  const verification = await consumeMagicLinkToken(token);
  if (!verification) {
    await writeAuditLog({
      action: "AUTH_MAGIC_LINK_INVALID",
      ip,
      userAgent,
    });
    return redirectToLogin(request, "expired");
  }

  const user = await prisma.user.findUnique({
    where: { email: verification.identifier.toLowerCase() },
    select: {
      id: true,
      email: true,
      emailVerified: true,
    },
  });

  if (!user || (isEmailVerificationRequiredForLogin && !user.emailVerified)) {
    await writeAuditLog({
      action: "AUTH_MAGIC_LINK_REJECTED",
      userId: user?.id,
      ip,
      userAgent,
      metadata: {
        reason: user ? "email_not_verified" : "user_missing",
      },
    });
    return redirectToLogin(request, "unavailable");
  }

  const { sessionToken, expiresAt, prunedSessions } = await createUserSession(user.id);
  const response = NextResponse.redirect(new URL(callbackUrl, request.nextUrl.origin));
  attachSessionCookie(request, response, sessionToken, expiresAt);

  await writeAuditLog({
    action: "AUTH_MAGIC_LINK_CONSUMED",
    userId: user.id,
    ip,
    userAgent,
    metadata: {
      sessionPrunedCount: prunedSessions,
    },
  });

  return response;
}
