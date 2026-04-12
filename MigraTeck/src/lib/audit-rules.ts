import { prisma } from "@/lib/prisma";

// ─── Immutable Audit Trail Rules ────────────────────────────────────────
// These rules enforce minimum retention periods and prevent deletion/modification
// of audit records below the threshold.

export async function createAuditRetentionRule(input: {
  name: string;
  description?: string | undefined;
  entityType?: string | undefined;
  minRetentionDays?: number | undefined;
  preventDeletion?: boolean | undefined;
  preventModification?: boolean | undefined;
  requireApproval?: boolean | undefined;
}) {
  const data: Record<string, unknown> = { name: input.name };
  if (input.description !== undefined) data.description = input.description;
  if (input.entityType !== undefined) data.entityType = input.entityType;
  if (input.minRetentionDays !== undefined) data.minRetentionDays = input.minRetentionDays;
  if (input.preventDeletion !== undefined) data.preventDeletion = input.preventDeletion;
  if (input.preventModification !== undefined) data.preventModification = input.preventModification;
  if (input.requireApproval !== undefined) data.requireApproval = input.requireApproval;

  return prisma.auditRetentionRule.create({
    data: data as Parameters<typeof prisma.auditRetentionRule.create>[0]["data"],
  });
}

export async function listAuditRetentionRules() {
  return prisma.auditRetentionRule.findMany({
    orderBy: { entityType: "asc" },
  });
}

export async function getActiveRulesForEntity(entityType: string) {
  return prisma.auditRetentionRule.findMany({
    where: { entityType, isActive: true },
  });
}

export async function updateAuditRetentionRule(
  ruleId: string,
  input: {
    name?: string | undefined;
    description?: string | undefined;
    minRetentionDays?: number | undefined;
    preventDeletion?: boolean | undefined;
    preventModification?: boolean | undefined;
    requireApproval?: boolean | undefined;
    isActive?: boolean | undefined;
  }
) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.minRetentionDays !== undefined) data.minRetentionDays = input.minRetentionDays;
  if (input.preventDeletion !== undefined) data.preventDeletion = input.preventDeletion;
  if (input.preventModification !== undefined) data.preventModification = input.preventModification;
  if (input.requireApproval !== undefined) data.requireApproval = input.requireApproval;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return prisma.auditRetentionRule.update({
    where: { id: ruleId },
    data: data as Parameters<typeof prisma.auditRetentionRule.update>[0]["data"],
  });
}

// ─── Enforcement Checks ─────────────────────────────────────────────────

export interface ImmutabilityCheck {
  allowed: boolean;
  reason?: string | undefined;
  rule?: { id: string; name: string; minRetentionDays: number } | undefined;
}

/**
 * Check if an audit record (or any protected entity) can be deleted.
 * Returns { allowed: false, reason } if an immutability rule blocks it.
 */
export async function canDeleteAuditRecord(
  entityType: string,
  createdAt: Date
): Promise<ImmutabilityCheck> {
  const rules = await getActiveRulesForEntity(entityType);

  for (const rule of rules) {
    if (rule.preventDeletion) {
      const age = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      if (age < rule.minRetentionDays) {
        return {
          allowed: false,
          reason: `Rule "${rule.name}" prevents deletion before ${rule.minRetentionDays} days (current age: ${age} days)`,
          rule: { id: rule.id, name: rule.name, minRetentionDays: rule.minRetentionDays },
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Check if an audit record can be modified.
 */
export async function canModifyAuditRecord(
  entityType: string
): Promise<ImmutabilityCheck> {
  const rules = await getActiveRulesForEntity(entityType);

  for (const rule of rules) {
    if (rule.preventModification) {
      return {
        allowed: false,
        reason: `Rule "${rule.name}" prevents modification of ${entityType} records`,
        rule: { id: rule.id, name: rule.name, minRetentionDays: rule.minRetentionDays },
      };
    }
  }

  return { allowed: true };
}

/**
 * Get the maximum retention requirement across all active rules for an entity type.
 */
export async function getMaxRetentionDays(entityType: string): Promise<number> {
  const rules = await getActiveRulesForEntity(entityType);
  if (rules.length === 0) return 0;
  return Math.max(...rules.map((r) => r.minRetentionDays));
}

/**
 * Validate that a retention policy doesn't conflict with immutability rules.
 */
export async function validateRetentionAgainstImmutability(
  entityType: string,
  proposedRetentionDays: number
): Promise<ImmutabilityCheck> {
  const maxRequired = await getMaxRetentionDays(entityType);
  if (proposedRetentionDays < maxRequired) {
    return {
      allowed: false,
      reason: `Proposed retention (${proposedRetentionDays}d) is less than immutable minimum (${maxRequired}d)`,
    };
  }
  return { allowed: true };
}
