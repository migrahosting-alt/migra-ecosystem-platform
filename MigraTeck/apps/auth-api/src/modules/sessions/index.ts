/**
 * Sessions module — central auth sessions (cookie-backed, server-side).
 */
import { db } from "../../lib/db.js";
import { generateToken, hashToken, verifyTokenHash } from "../../lib/crypto.js";
import { config } from "../../config/env.js";
import type { Session } from "../../prisma-client.js";

export type { Session };

export interface SessionCreateResult {
  session: Session;
  /** Raw session secret — set this in the cookie, never store raw. */
  sessionSecret: string;
}

export async function createAuthSession(
  userId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<SessionCreateResult> {
  const sessionSecret = generateToken(32);
  const sessionSecretHash = hashToken(sessionSecret);
  const expiresAt = new Date(Date.now() + config.sessionTtl * 1000);

  const session = await db.session.create({
    data: {
      userId,
      sessionType: "AUTH",
      sessionSecretHash,
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });

  return { session, sessionSecret };
}

export async function validateSession(
  sessionSecret: string,
): Promise<Session | null> {
  const sessionSecretHash = hashToken(sessionSecret);
  const session = await db.session.findFirst({
    where: {
      sessionSecretHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!session) return null;

  // Touch last-seen
  await db.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  return session;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function listUserSessions(
  userId: string,
): Promise<Session[]> {
  return db.session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}
