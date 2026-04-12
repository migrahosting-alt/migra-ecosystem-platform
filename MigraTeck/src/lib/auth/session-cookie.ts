import { NextRequest } from "next/server";

export const NEXTAUTH_SESSION_COOKIE = "next-auth.session-token";
export const NEXTAUTH_SECURE_SESSION_COOKIE = "__Secure-next-auth.session-token";
export const AUTHJS_SESSION_COOKIE = "authjs.session-token";
export const AUTHJS_SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";

export const SESSION_COOKIE_NAMES = [
  NEXTAUTH_SESSION_COOKIE,
  NEXTAUTH_SECURE_SESSION_COOKIE,
  AUTHJS_SESSION_COOKIE,
  AUTHJS_SECURE_SESSION_COOKIE,
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
    return NEXTAUTH_SECURE_SESSION_COOKIE;
  }

  return NEXTAUTH_SESSION_COOKIE;
}
