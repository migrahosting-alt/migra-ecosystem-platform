import type { Prisma } from "@prisma/client";
import type { SecurityActivityItem, SecurityActivityResponseData } from "@migrateck/api-contracts";
import { prisma } from "@/lib/prisma";

function toRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toRiskScore(metadata: Record<string, unknown> | null) {
  const riskScore = metadata?.riskScore;
  return typeof riskScore === "number" ? riskScore : null;
}

function toSecurityActivityItem(event: {
  id: string;
  eventType: string;
  severity: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}): SecurityActivityItem {
  const metadata = toRecord(event.metadata);

  return {
    id: event.id,
    type: event.eventType,
    severity: event.severity,
    createdAt: event.createdAt.toISOString(),
    ip: event.ip,
    userAgent: event.userAgent,
    country: event.country,
    riskScore: toRiskScore(metadata),
    metadata,
  };
}

export async function listIdentitySecurityActivity(input: {
  userId: string;
  orgId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}): Promise<SecurityActivityResponseData> {
  const take = Math.min(input.limit || 25, 100);
  const rows = await prisma.securityEvent.findMany({
    where: {
      userId: input.userId,
      ...(input.orgId ? { orgId: input.orgId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      eventType: true,
      severity: true,
      ip: true,
      userAgent: true,
      country: true,
      metadata: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;

  return {
    events: items.map(toSecurityActivityItem),
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}