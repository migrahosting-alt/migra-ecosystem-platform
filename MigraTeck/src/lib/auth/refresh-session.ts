import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export function generateFamilyId(): string {
  return randomBytes(16).toString("hex");
}

export async function createRefreshSession(input: {
  userId: string;
  orgId: string;
  sessionId?: string | null;
  tokenHash: string;
  familyId?: string | undefined;
  parentId?: string | undefined;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: Date;
}) {
  return prisma.refreshSession.create({
    data: {
      userId: input.userId,
      orgId: input.orgId,
      sessionId: input.sessionId || null,
      tokenHash: input.tokenHash,
      familyId: input.familyId || generateFamilyId(),
      parentId: input.parentId || null,
      userAgent: input.userAgent || null,
      ipAddress: input.ipAddress || null,
      expiresAt: input.expiresAt,
    },
  });
}

export async function findValidRefreshSession(tokenHash: string) {
  return prisma.refreshSession.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: true,
      session: true,
    },
  });
}

export async function revokeRefreshSessionByHash(tokenHash: string) {
  await prisma.refreshSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      lastUsedAt: new Date(),
    },
  });
}

export async function revokeAllRefreshSessionsForUser(userId: string) {
  await prisma.refreshSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      lastUsedAt: new Date(),
    },
  });
}

/**
 * Revoke all sessions in the same family.
 * This is the core stolen-token defense: if a revoked token is reused,
 * every session in its family is killed.
 */
export async function revokeFamilySessions(familyId: string): Promise<number> {
  const result = await prisma.refreshSession.updateMany({
    where: {
      familyId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
  return result.count;
}

/**
 * Detect a reused (already-revoked) refresh token.
 * Returns the familyId if the token exists but is revoked — meaning theft.
 */
export async function detectTokenReuse(tokenHash: string): Promise<string | null> {
  const session = await prisma.refreshSession.findFirst({
    where: { tokenHash },
    select: { familyId: true, revokedAt: true },
  });
  if (session && session.revokedAt) {
    return session.familyId;
  }
  return null;
}

export async function rotateRefreshSession(
  oldTokenHash: string,
  replacement: {
    userId: string;
    orgId: string;
    sessionId?: string | null;
    tokenHash: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresAt: Date;
  },
) {
  return prisma.$transaction(async (tx) => {
    const old = await tx.refreshSession.findFirst({
      where: { tokenHash: oldTokenHash, revokedAt: null },
      select: { id: true, familyId: true, sessionId: true },
    });

    if (!old) {
      return null;
    }

    await tx.refreshSession.updateMany({
      where: {
        tokenHash: oldTokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });

    return tx.refreshSession.create({
      data: {
        userId: replacement.userId,
        orgId: replacement.orgId,
        sessionId: old.sessionId || replacement.sessionId || null,
        tokenHash: replacement.tokenHash,
        familyId: old.familyId,
        parentId: old.id,
        userAgent: replacement.userAgent || null,
        ipAddress: replacement.ipAddress || null,
        expiresAt: replacement.expiresAt,
      },
    });
  });
}