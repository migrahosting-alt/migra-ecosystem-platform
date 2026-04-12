import { writeAuditLog } from "@migrateck/audit-core";
import { recordSecurityEvent } from "@migrateck/events";
import type { Prisma } from "@prisma/client";
import type { IdentityManagedSessionView, IdentitySessionListResponseData } from "@migrateck/api-contracts";
import { hashRefreshToken } from "@/lib/auth/access-token";
import { prisma } from "@/lib/prisma";
import { AuthCoreError } from "../errors";

function toManagedSessionView(
  session: {
    id: string;
    createdAt: Date;
    expiresAt: Date;
    lastUsedAt: Date | null;
    userAgent: string | null;
    ipAddress: string | null;
    revokedAt: Date | null;
    tokenHash: string;
    sessionId: string | null;
    org: { id: string; name: string; slug: string };
  },
  currentRefreshHash?: string | null,
  currentSessionId?: string | null,
): IdentityManagedSessionView {
  return {
    id: session.id,
    organization: {
      id: session.org.id,
      name: session.org.name,
      slug: session.org.slug,
    },
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    lastSeenAt: (session.lastUsedAt || session.createdAt).toISOString(),
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    current: session.tokenHash === currentRefreshHash || (!!currentSessionId && session.sessionId === currentSessionId),
    revokedAt: session.revokedAt?.toISOString() ?? null,
  };
}

async function resolveCurrentSessionId(currentSessionToken?: string | undefined) {
  if (!currentSessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken: currentSessionToken },
    select: { id: true },
  });

  return session?.id ?? null;
}

export async function listIdentitySessions(input: {
  userId: string;
  currentRefreshToken?: string | undefined;
  currentSessionToken?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}): Promise<IdentitySessionListResponseData> {
  const take = Math.min(input.limit || 20, 100);
  const currentRefreshHash = input.currentRefreshToken ? hashRefreshToken(input.currentRefreshToken) : null;
  const currentSessionId = await resolveCurrentSessionId(input.currentSessionToken);

  const rows = await prisma.refreshSession.findMany({
    where: {
      userId: input.userId,
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      userAgent: true,
      ipAddress: true,
      revokedAt: true,
      tokenHash: true,
      sessionId: true,
      org: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;

  return {
    sessions: items.map((item) => toManagedSessionView(item, currentRefreshHash, currentSessionId)),
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}

export async function revokeIdentitySession(input: {
  userId: string;
  refreshSessionId: string;
  currentRefreshToken?: string | undefined;
  currentSessionToken?: string | undefined;
  ip: string;
  userAgent: string;
}): Promise<{ message: string; revokedId: string; wasCurrent: boolean; orgId: string | null }> {
  const target = await prisma.refreshSession.findFirst({
    where: {
      id: input.refreshSessionId,
      userId: input.userId,
    },
    select: {
      id: true,
      orgId: true,
      tokenHash: true,
      revokedAt: true,
      sessionId: true,
    },
  });

  if (!target) {
    throw new AuthCoreError("SESSION_NOT_FOUND", "Session not found.", 404);
  }

  const currentRefreshHash = input.currentRefreshToken ? hashRefreshToken(input.currentRefreshToken) : null;
  const currentSessionId = await resolveCurrentSessionId(input.currentSessionToken);
  const wasCurrent = target.tokenHash === currentRefreshHash || (!!currentSessionId && target.sessionId === currentSessionId);

  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.refreshSession.updateMany({
      where: {
        id: target.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    }),
  ];

  if (target.sessionId) {
    operations.push(
      prisma.session.deleteMany({
        where: {
          id: target.sessionId,
          userId: input.userId,
        },
      }),
    );
  } else if (wasCurrent && input.currentSessionToken) {
    operations.push(
      prisma.session.deleteMany({
        where: {
          sessionToken: input.currentSessionToken,
          userId: input.userId,
        },
      }),
    );
  }

  await prisma.$transaction(operations);

  await writeAuditLog({
    userId: input.userId,
    orgId: target.orgId,
    action: "AUTH_SESSION_REVOKED",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      refreshSessionId: target.id,
      wasCurrent,
    },
  });
  await recordSecurityEvent({
    userId: input.userId,
    orgId: target.orgId,
    eventType: "SESSION_REVOKED",
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      refreshSessionId: target.id,
      wasCurrent,
    },
  });

  return {
    message: "Session revoked.",
    revokedId: target.id,
    wasCurrent,
    orgId: target.orgId,
  };
}