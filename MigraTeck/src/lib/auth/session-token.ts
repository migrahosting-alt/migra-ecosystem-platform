import { type NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";

export function readSessionCookie(request: NextRequest): string | undefined {
  for (const cookieName of SESSION_COOKIE_NAMES) {
    const value = request.cookies.get(cookieName)?.value;
    if (value) {
      return value;
    }
  }

  return undefined;
}