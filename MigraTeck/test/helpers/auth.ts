import { randomBytes } from "node:crypto";
import { APP_SECURE_SESSION_COOKIE, APP_SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { HttpClient } from "./http";
import { prisma } from "./prisma";

function getSessionCookieNames(baseUrl: string): string[] {
  if (baseUrl.startsWith("https://")) {
    return [APP_SECURE_SESSION_COOKIE];
  }

  return [APP_SESSION_COOKIE];
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
