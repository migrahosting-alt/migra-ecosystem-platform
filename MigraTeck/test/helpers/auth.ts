import { randomBytes } from "node:crypto";
import {
  AUTHJS_SECURE_SESSION_COOKIE,
  AUTHJS_SESSION_COOKIE,
  NEXTAUTH_SECURE_SESSION_COOKIE,
  NEXTAUTH_SESSION_COOKIE,
} from "@/lib/auth/session-cookie";
import { HttpClient } from "./http";
import { prisma } from "./prisma";

interface LoginResult {
  status: number;
  sessionEstablished: boolean;
  cacheControl: string | null;
}

function hasSessionCookie(client: HttpClient): boolean {
  return (
    client.hasCookie(AUTHJS_SESSION_COOKIE) ||
    client.hasCookie(AUTHJS_SECURE_SESSION_COOKIE) ||
    client.hasCookie(NEXTAUTH_SESSION_COOKIE) ||
    client.hasCookie(NEXTAUTH_SECURE_SESSION_COOKIE)
  );
}

function getSessionCookieNames(baseUrl: string): string[] {
  if (baseUrl.startsWith("https://")) {
    return [NEXTAUTH_SECURE_SESSION_COOKIE];
  }

  return [NEXTAUTH_SESSION_COOKIE];
}

export async function signInWithPassword(client: HttpClient, email: string, password: string): Promise<LoginResult> {
  const response = await client.post("/api/auth/login", {
    json: {
      email,
      password,
    },
  });

  return {
    status: response.status,
    sessionEstablished: hasSessionCookie(client),
    cacheControl: response.headers.get("cache-control"),
  };
}

export async function createSessionForUser(client: HttpClient, userId: string): Promise<string> {
  const sessionToken = randomBytes(32).toString("hex");

  await prisma.session.create({
    data: {
      sessionToken,
      userId,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  for (const cookieName of getSessionCookieNames(client.baseUrl)) {
    client.setCookie(cookieName, sessionToken);
  }

  return sessionToken;
}
