import { NextRequest } from "next/server";
import { refreshIdentitySession } from "@migrateck/auth-core";
import { readRefreshCookie, setRefreshCookie } from "@/lib/auth/refresh-cookie";
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

  const refreshToken = readRefreshCookie(request);
  if (!refreshToken) {
    return jsonError("INVALID_SESSION", "Invalid session.", 401);
  }

  try {
    const result = await refreshIdentitySession({
      refreshToken,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    const response = jsonSuccess(result.data);
    setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt, "/api");
    response.cookies.set(ACTIVE_ORG_COOKIE, result.activeOrgId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    return jsonFromError(error);
  }
}