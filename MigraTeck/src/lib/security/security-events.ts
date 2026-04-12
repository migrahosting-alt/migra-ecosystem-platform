import type { Prisma, SecurityEventSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type SecurityEventType =
  | "REFRESH_TOKEN_REUSE"
  | "SUSPICIOUS_LOGIN"
  | "BRUTE_FORCE_DETECTED"
  | "ACCOUNT_LOCKED"
  | "PASSKEY_REGISTERED"
  | "PASSKEY_REMOVED"
  | "PASSKEY_AUTH_SUCCESS"
  | "PASSKEY_AUTH_FAILED"
  | "MFA_ENROLLED"
  | "MFA_REMOVED"
  | "ORG_POLICY_VIOLATION"
  | "SESSION_ANOMALY"
  | "IP_CHANGE_MID_SESSION"
  | "COUNTRY_CHANGE_MID_SESSION"
  | "PERMISSION_ESCALATION"
  | "ADMIN_IMPERSONATION";

interface RecordSecurityEventInput {
  userId?: string | null | undefined;
  orgId?: string | null | undefined;
  eventType: SecurityEventType;
  severity?: SecurityEventSeverity | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  country?: string | null | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

function deriveSeverity(eventType: SecurityEventType): SecurityEventSeverity {
  switch (eventType) {
    case "REFRESH_TOKEN_REUSE":
    case "BRUTE_FORCE_DETECTED":
    case "PERMISSION_ESCALATION":
    case "ADMIN_IMPERSONATION":
      return "CRITICAL";
    case "SUSPICIOUS_LOGIN":
    case "ACCOUNT_LOCKED":
    case "ORG_POLICY_VIOLATION":
    case "SESSION_ANOMALY":
    case "IP_CHANGE_MID_SESSION":
    case "COUNTRY_CHANGE_MID_SESSION":
    case "PASSKEY_AUTH_FAILED":
      return "WARNING";
    default:
      return "INFO";
  }
}

export async function recordSecurityEvent(input: RecordSecurityEventInput): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        userId: input.userId ?? null,
        orgId: input.orgId ?? null,
        eventType: input.eventType,
        severity: input.severity ?? deriveSeverity(input.eventType),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        country: input.country ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (error) {
    console.error("Failed to record security event", error);
  }
}

export async function countRecentSecurityEvents(input: {
  userId?: string | undefined;
  ip?: string | undefined;
  eventType: SecurityEventType;
  windowSeconds: number;
}): Promise<number> {
  const since = new Date(Date.now() - input.windowSeconds * 1000);
  const where: Prisma.SecurityEventWhereInput = {
    eventType: input.eventType,
    createdAt: { gte: since },
  };
  if (input.userId) where.userId = input.userId;
  if (input.ip) where.ip = input.ip;

  return prisma.securityEvent.count({ where });
}

export async function querySecurityEvents(input: {
  userId?: string | undefined;
  orgId?: string | undefined;
  eventType?: string | undefined;
  severity?: SecurityEventSeverity | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}) {
  const where: Prisma.SecurityEventWhereInput = {};
  if (input.userId) where.userId = input.userId;
  if (input.orgId) where.orgId = input.orgId;
  if (input.eventType) where.eventType = input.eventType;
  if (input.severity) where.severity = input.severity;
  if (input.since || input.until) {
    where.createdAt = {};
    if (input.since) where.createdAt.gte = input.since;
    if (input.until) where.createdAt.lte = input.until;
  }

  const take = Math.min(input.limit || 50, 200);

  return prisma.securityEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      orgId: true,
      eventType: true,
      severity: true,
      ip: true,
      country: true,
      metadata: true,
      createdAt: true,
    },
  });
}
