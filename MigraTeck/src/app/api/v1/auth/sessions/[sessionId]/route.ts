import { NextRequest } from "next/server";
import { revokeIdentitySession } from "@migrateck/auth-core";
import { requireApiSession } from "@/lib/auth/api-auth";
import { clearRefreshCookie, readRefreshCookie } from "@/lib/auth/refresh-cookie";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";
import { readSessionCookie } from "@/lib/auth/session-token";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { jsonError, jsonFromError, jsonSuccess } from "@/lib/http/v1-response";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return jsonError("CSRF_FAILED", "CSRF validation failed.", 403);
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return jsonError("UNAUTHORIZED", "Unauthorized.", 401);
  }

  try {
    const { sessionId } = await context.params;
    const result = await revokeIdentitySession({
      userId: authResult.session.user.id,
      refreshSessionId: sessionId,
      currentRefreshToken: readRefreshCookie(request),
      currentSessionToken: readSessionCookie(request),
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    const response = jsonSuccess({ message: result.message });
    if (result.wasCurrent) {
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
    }

    return response;
  } catch (error) {
    return jsonFromError(error);
  }
}