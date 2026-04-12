import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { clearRefreshCookie, readRefreshCookie } from "@/lib/auth/refresh-cookie";
import { revokeRefreshSessionByHash } from "@/lib/auth/refresh-session";
import { hashRefreshToken } from "@/lib/auth/access-token";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";
import { requireSameOrigin } from "@/lib/security/csrf";

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const refreshToken = readRefreshCookie(request);
  if (refreshToken) {
    await revokeRefreshSessionByHash(hashRefreshToken(refreshToken));
  }

  const response = NextResponse.json({ ok: true });
  clearRefreshCookie(response);

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
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}