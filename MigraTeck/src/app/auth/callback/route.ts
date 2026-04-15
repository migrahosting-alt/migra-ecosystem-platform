import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { writeAuditLog } from "@/lib/audit";
import { attachSessionCookie, createUserSession } from "@/lib/auth/manual-session";
import { clearOAuthCookies, exchangeCodeForTokens, fetchUserInfo, readOAuthCookies } from "@/lib/auth/migraauth";
import { linkOrCreateUser } from "@/lib/auth/migraauth-user";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const errorUrl = new URL("/auth/error", request.url);

  if (!code || !state) {
    return NextResponse.redirect(errorUrl);
  }

  const oauth = await readOAuthCookies();
  if (!oauth.state || oauth.state !== state || !oauth.verifier || !oauth.clientId || !oauth.redirectUri) {
    return NextResponse.redirect(errorUrl);
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: oauth.verifier,
      clientId: oauth.clientId,
      redirectUri: oauth.redirectUri,
    });

    const userInfo = await fetchUserInfo(tokens.access_token);
    const linked = await linkOrCreateUser({
      authUserId: userInfo.sub,
      email: userInfo.email,
      displayName: userInfo.name,
      ip,
      userAgent,
    });

    if (userInfo.email_verified) {
      await prisma.user.update({
        where: { id: linked.user.id },
        data: {
          emailVerified: linked.user.emailVerified ?? new Date(),
        },
      }).catch(() => undefined);
    }

    const { sessionToken, expiresAt } = await createUserSession(linked.user.id);
    const destination = oauth.nextPath && oauth.nextPath.startsWith("/") && !oauth.nextPath.startsWith("//")
      ? oauth.nextPath
      : "/app";

    const response = NextResponse.redirect(new URL(destination, request.url));
    attachSessionCookie(request, response, sessionToken, expiresAt);
    clearOAuthCookies(response);

    if (linked.user.defaultOrgId) {
      response.cookies.set(ACTIVE_ORG_COOKIE, linked.user.defaultOrgId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    await writeAuditLog({
      userId: linked.user.id,
      orgId: linked.user.defaultOrgId,
      action: "AUTH_LOGIN_COMPLETED",
      ip,
      userAgent,
      metadata: {
        clientId: oauth.clientId,
        migrationAction: linked.action,
      },
    });

    return response;
  } catch (error) {
    await writeAuditLog({
      action: "AUTH_LOGIN_CALLBACK_FAILED",
      ip,
      userAgent,
      metadata: {
        message: error instanceof Error ? error.message : "Unknown callback error",
      },
    });

    return NextResponse.redirect(errorUrl);
  }
}
