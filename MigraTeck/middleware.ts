import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (!path.startsWith("/app") && !path.startsWith("/admin")) {
    return NextResponse.next();
  }

  const hasSessionCookie = SESSION_COOKIE_NAMES.some((cookieName) => request.cookies.has(cookieName));

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = request.nextUrl.pathname + request.nextUrl.search;
  if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    loginUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
