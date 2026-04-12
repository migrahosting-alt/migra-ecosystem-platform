import { NextRequest, NextResponse } from "next/server";
import { loginRequestSchema } from "@migrateck/api-contracts";
import { loginWithPassword } from "@migrateck/auth-core";
import { attachSessionCookie } from "@/lib/auth/manual-session";
import { setRefreshCookie } from "@/lib/auth/refresh-cookie";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";

function setActiveOrgCookie(orgId: string | null | undefined, response: NextResponse) {
  if (!orgId) {
    return;
  }

  response.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return jsonError("CSRF_FAILED", "CSRF validation failed.", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = loginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_PAYLOAD", "Invalid payload.", 400);
  }

  try {
    const result = await loginWithPassword({
      ...parsed.data,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    const response = jsonSuccess(result.data);
    attachSessionCookie(request, response, result.sessionToken, result.sessionExpiresAt);
    if (result.refreshToken && result.refreshExpiresAt) {
      setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt, "/api");
    }
    setActiveOrgCookie(result.activeOrgId, response);
    return response;
  } catch (error) {
    return jsonFromError(error);
  }
}