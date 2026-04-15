import { NextRequest } from "next/server";

export const APP_SESSION_COOKIE = "mh_session";
export const APP_SECURE_SESSION_COOKIE = "__Secure-mh_session";

export const SESSION_COOKIE_NAMES = [
  APP_SESSION_COOKIE,
  APP_SECURE_SESSION_COOKIE,
] as const;

export function shouldUseSecureSessionCookies(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  if (request.nextUrl.protocol === "https:") {
    return true;
  }

  if (process.env.NEXTAUTH_URL?.startsWith("https://")) {
    return true;
  }

  return process.env.NODE_ENV === "production";
}

export function getCanonicalSessionCookieNameForRequest(request: NextRequest): string {
  if (shouldUseSecureSessionCookies(request)) {
    return APP_SECURE_SESSION_COOKIE;
  }

  return APP_SESSION_COOKIE;
}
