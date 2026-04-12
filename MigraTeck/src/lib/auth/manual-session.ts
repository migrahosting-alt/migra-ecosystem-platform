import { randomBytes } from "crypto";
import { type NextRequest, type NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCanonicalSessionCookieNameForRequest } from "@/lib/auth/session-cookie";

const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const maxSessionsPerUser = 20;

export async function createUserSession(userId: string) {
  const sessionToken = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  let prunedSessions = 0;

  await prisma.$transaction(async (tx) => {
    await tx.session.create({
      data: {
        sessionToken,
        userId,
        expires: expiresAt,
      },
    });

    const overflowSessions = await tx.session.findMany({
      where: { userId },
      orderBy: { expires: "desc" },
      skip: maxSessionsPerUser,
      select: { sessionToken: true },
    });

    if (overflowSessions.length > 0) {
      prunedSessions = overflowSessions.length;
      await tx.session.deleteMany({
        where: {
          userId,
          sessionToken: {
            in: overflowSessions.map((session) => session.sessionToken),
          },
        },
      });
    }
  });

  return {
    sessionToken,
    expiresAt,
    prunedSessions,
  };
}

export function attachSessionCookie(request: NextRequest, response: NextResponse, sessionToken: string, expiresAt: Date) {
  const sessionCookieName = getCanonicalSessionCookieNameForRequest(request);
  response.cookies.set(sessionCookieName, sessionToken, {
    httpOnly: true,
    secure: sessionCookieName.startsWith("__Secure-"),
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
    expires: expiresAt,
  });
}
