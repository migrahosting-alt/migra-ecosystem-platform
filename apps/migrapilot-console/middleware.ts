import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, locales } from "./i18n/routing";
import {
  PORTAL_SESSION_COOKIE,
  portalAuthEnabled,
  portalSessionToken,
} from "./lib/shared/portal-auth";

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "never", // URLs stay clean: /autonomy not /en/autonomy
});

const AUTH_FREE_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
]);

function isStaticPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/icon.svg") return true;
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

export default function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isStaticPath(pathname)) return NextResponse.next();
  if (!portalAuthEnabled()) {
    if (pathname.startsWith("/api/")) return NextResponse.next();
    return intlMiddleware(request);
  }

  if (AUTH_FREE_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(PORTAL_SESSION_COOKIE)?.value ?? "";
  const isAuthenticated = sessionCookie === portalSessionToken();

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
    }

    const nextUrl = `${pathname}${search || ""}`;
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", nextUrl);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith("/api/")) return NextResponse.next();
  return NextResponse.next();
}

export const config = {
  // Match pages + API, skipping static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
