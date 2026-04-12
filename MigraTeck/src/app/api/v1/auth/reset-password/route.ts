import { NextRequest } from "next/server";
import { resetPasswordRequestSchema } from "@migrateck/api-contracts";
import { resetPasswordWithToken } from "@migrateck/auth-core";
import { clearRefreshCookie } from "@/lib/auth/refresh-cookie";
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

  const body = await request.json().catch(() => null);
  const parsed = resetPasswordRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("INVALID_PAYLOAD", "Invalid payload.", 400);
  }

  try {
    const result = await resetPasswordWithToken({
      token: parsed.data.token,
      password: parsed.data.password,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    const response = jsonSuccess(result);
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