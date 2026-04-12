import { type RetentionAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Policy CRUD ────────────────────────────────────────────────────────

export async function createRetentionPolicy(input: {
  entityType: string;
  retentionDays: number;
  action?: RetentionAction | undefined;
  orgId?: string | undefined;
  description?: string | undefined;
}) {
  const data: Record<string, unknown> = {
    entityType: input.entityType,
    retentionDays: input.retentionDays,
  };
  if (input.action !== undefined) data.action = input.action;
  if (input.orgId !== undefined) {
    data.orgId = input.orgId;
    data.scope = "ORGANIZATION";
  }
  if (input.description !== undefined) data.description = input.description;

  return prisma.retentionPolicy.create({
    data: data as Parameters<typeof prisma.retentionPolicy.create>[0]["data"],
  });
}

export async function listRetentionPolicies(orgId?: string | undefined) {
  const where: Record<string, unknown> = { isActive: true };
  if (orgId !== undefined) {
    where.OR = [{ scope: "PLATFORM" }, { orgId }];
  } else {
    where.scope = "PLATFORM";
  }

  return prisma.retentionPolicy.findMany({
    where: where as Prisma.RetentionPolicyWhereInput,
    include: { executions: { take: 5, orderBy: { startedAt: "desc" as const } } },
    orderBy: { entityType: "asc" },
  });
}

export async function updateRetentionPolicy(
  policyId: string,
  input: {
    retentionDays?: number | undefined;
    action?: RetentionAction | undefined;
    isActive?: boolean | undefined;
    description?: string | undefined;
  }
) {
  const data: Record<string, unknown> = {};
  if (input.retentionDays !== undefined) data.retentionDays = input.retentionDays;
  if (input.action !== undefined) data.action = input.action;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.description !== undefined) data.description = input.description;

  return prisma.retentionPolicy.update({
    where: { id: policyId },
    data: data as Parameters<typeof prisma.retentionPolicy.update>[0]["data"],
  });
}

export async function deleteRetentionPolicy(policyId: string) {
  return prisma.retentionPolicy.delete({ where: { id: policyId } });
}

// ─── Enforcement ────────────────────────────────────────────────────────

const ENTITY_TABLE_MAP: Record<string, string> = {
  AuditLog: "auditLog",
  UsageEvent: "usageEvent",
  DataExport: "dataExport",
  SecurityEvent: "securityEvent",
  PlatformEvent: "platformEvent",
  Notification: "notification",
  WebhookDelivery: "webhookDelivery",
};

export async function enforceRetentionPolicy(policyId: string) {
  const policy = await prisma.retentionPolicy.findUniqueOrThrow({
    where: { id: policyId },
  });

  const tableName = ENTITY_TABLE_MAP[policy.entityType];
  if (!tableName) {
    throw new Error(`No table mapping for entity type: ${policy.entityType}`);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - policy.retentionDays);

  // Create execution record
  const execution = await prisma.retentionExecution.create({
    data: { policyId },
  });

  try {
    let recordsAffected = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[tableName];
    if (!model) throw new Error(`Prisma model not found: ${tableName}`);

    if (policy.action === "DELETE") {
      const result = await model.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      recordsAffected = result.count;
    } else if (policy.action === "ANONYMIZE") {
      // Anonymize by nullifying user-identifiable fields
      const result = await model.updateMany({
        where: { createdAt: { lt: cutoff } },
        data: {
          ...(tableName === "auditLog" ? { userId: null, ip: null, userAgent: null } : {}),
          ...(tableName === "securityEvent" ? { ip: null, userAgent: null, country: null } : {}),
        },
      });
      recordsAffected = result.count;
    }
    // ARCHIVE: would write to cold storage then delete — placeholder

    await prisma.retentionExecution.update({
      where: { id: execution.id },
      data: { completedAt: new Date(), recordsAffected },
    });

    return { executionId: execution.id, recordsAffected };
  } catch (error) {
    await prisma.retentionExecution.update({
      where: { id: execution.id },
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

export async function runAllDueRetentionPolicies() {
  const policies = await prisma.retentionPolicy.findMany({
    where: { isActive: true },
  });

  const results: { policyId: string; entityType: string; recordsAffected: number; error?: string }[] = [];

  for (const policy of policies) {
    try {
      const result = await enforceRetentionPolicy(policy.id);
      results.push({ policyId: policy.id, entityType: policy.entityType, recordsAffected: result.recordsAffected });
    } catch (error) {
      results.push({
        policyId: policy.id,
        entityType: policy.entityType,
        recordsAffected: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export async function getRetentionExecutionHistory(policyId: string, limit = 20) {
  return prisma.retentionExecution.findMany({
    where: { policyId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
