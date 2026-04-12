import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AuditRiskTier = 0 | 1 | 2;

interface AuditInput {
  actorId?: string | null | undefined;
  actorRole?: string | null | undefined;
  userId?: string | null | undefined;
  orgId?: string | null | undefined;
  action: string;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  riskTier?: AuditRiskTier | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

function deriveRiskTier(action: string): AuditRiskTier {
  const normalized = action.toUpperCase();

  if (
    normalized.includes("DELETE") ||
    normalized.includes("REVOKE") ||
    normalized.includes("DOWNGRADE") ||
    normalized.includes("EXPIRE") ||
    normalized.includes("MAINTENANCE") ||
    normalized.includes("FREEZE")
  ) {
    return 2;
  }

  if (
    normalized.includes("VIEW") ||
    normalized.includes("READ") ||
    normalized.includes("LIST") ||
    normalized.endsWith("_GET")
  ) {
    return 0;
  }

  return 1;
}

function toJsonValue(input: Prisma.InputJsonValue | undefined): Prisma.InputJsonValue | undefined {
  if (input === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    const actorId = input.actorId ?? input.userId ?? null;
    const resourceType = input.resourceType ?? input.entityType ?? null;
    const resourceId = input.resourceId ?? input.entityId ?? null;
    const riskTier = input.riskTier ?? deriveRiskTier(input.action);
    const metadataDetails = toJsonValue(input.metadata);

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        orgId: input.orgId ?? null,
        action: input.action,
        entityType: resourceType,
        entityId: resourceId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: {
          actorId,
          actorRole: input.actorRole || null,
          orgId: input.orgId || null,
          action: input.action,
          resourceType,
          resourceId,
          ip: input.ip || null,
          userAgent: input.userAgent || null,
          riskTier,
          details: metadataDetails || null,
        },
      },
    });
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}
