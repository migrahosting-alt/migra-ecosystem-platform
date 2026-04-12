import { type NextRequest, type NextResponse } from "next/server";
import { authCookieDomain, authCookieName, authCookieSecure } from "@/lib/env";

export function setRefreshCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
  path = "/api/auth",
) {
  response.cookies.set(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: authCookieSecure,
    domain: authCookieDomain || undefined,
    path,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(response: NextResponse, path = "/api/auth") {
  response.cookies.set(authCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: authCookieSecure,
    domain: authCookieDomain || undefined,
    path,
    maxAge: 0,
    expires: new Date(0),
  });
}

export function readRefreshCookie(request: NextRequest): string | undefined {
  return request.cookies.get(authCookieName)?.value;
}