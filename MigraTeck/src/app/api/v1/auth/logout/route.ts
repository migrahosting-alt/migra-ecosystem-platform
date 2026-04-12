import { NextRequest } from "next/server";
import { logoutIdentitySession } from "@migrateck/auth-core";
import { clearRefreshCookie, readRefreshCookie } from "@/lib/auth/refresh-cookie";
import { readSessionCookie } from "@/lib/auth/session-token";
import { requireApiSession } from "@/lib/auth/api-auth";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return jsonError("CSRF_FAILED", "CSRF validation failed.", 403);
  }

  try {
    const authResult = await requireApiSession();
    const userId = authResult.ok ? authResult.session.user.id : null;
    const orgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? null;

    await logoutIdentitySession({
      refreshToken: readRefreshCookie(request),
      currentSessionToken: readSessionCookie(request),
      userId,
      orgId,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    const response = jsonSuccess({ message: "Logged out." });
    clearRefreshCookie(response, "/api");
    clearRefreshCookie(response, "/api/auth");

    for (const cookieName of SESSION_COOKIE_NAMES) {
      response.cookies.set(cookieName, "", {
        httpOnly: true,
        secure: cookieName.startsWith("__Secure-"),
        sameSite: "lax",
        path: "/",
        maxAge: 0,
        expires: new Date(0),
      });
    }

    response.cookies.set(ACTIVE_ORG_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });

    return response;
  } catch (error) {
    return jsonFromError(error);
  }
}