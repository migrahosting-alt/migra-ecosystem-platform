import { type EnvironmentTier, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Environment Config CRUD ────────────────────────────────────────────

export async function createEnvironmentConfig(input: {
  tier: EnvironmentTier;
  name: string;
  description?: string | undefined;
  configJson: Prisma.InputJsonValue;
  allowedOrgIds?: string[] | undefined;
  isDefault?: boolean | undefined;
  isolationLevel?: string | undefined;
}) {
  const data: Record<string, unknown> = {
    tier: input.tier,
    name: input.name,
    configJson: input.configJson,
  };
  if (input.description !== undefined) data.description = input.description;
  if (input.allowedOrgIds !== undefined) data.allowedOrgIds = input.allowedOrgIds;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.isolationLevel !== undefined) data.isolationLevel = input.isolationLevel;

  return prisma.environmentConfig.create({
    data: data as Parameters<typeof prisma.environmentConfig.create>[0]["data"],
  });
}

export async function listEnvironmentConfigs(tier?: EnvironmentTier | undefined) {
  const where: Record<string, unknown> = { isActive: true };
  if (tier !== undefined) where.tier = tier;

  return prisma.environmentConfig.findMany({
    where: where as Prisma.EnvironmentConfigWhereInput,
    orderBy: [{ tier: "asc" }, { name: "asc" }],
  });
}

export async function getEnvironmentConfig(configId: string) {
  return prisma.environmentConfig.findUniqueOrThrow({ where: { id: configId } });
}

export async function getDefaultEnvironment(tier: EnvironmentTier) {
  return prisma.environmentConfig.findFirst({
    where: { tier, isDefault: true, isActive: true },
  });
}

export async function updateEnvironmentConfig(
  configId: string,
  input: {
    description?: string | undefined;
    configJson?: Prisma.InputJsonValue | undefined;
    allowedOrgIds?: string[] | undefined;
    isDefault?: boolean | undefined;
    isActive?: boolean | undefined;
    isolationLevel?: string | undefined;
  }
) {
  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description;
  if (input.configJson !== undefined) data.configJson = input.configJson;
  if (input.allowedOrgIds !== undefined) data.allowedOrgIds = input.allowedOrgIds;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.isolationLevel !== undefined) data.isolationLevel = input.isolationLevel;

  return prisma.environmentConfig.update({
    where: { id: configId },
    data: data as Parameters<typeof prisma.environmentConfig.update>[0]["data"],
  });
}

export async function deleteEnvironmentConfig(configId: string) {
  return prisma.environmentConfig.delete({ where: { id: configId } });
}

// ─── Org Environment Resolution ─────────────────────────────────────────

export async function resolveOrgEnvironment(orgId: string, tier: EnvironmentTier) {
  // First check for org-specific allow-list
  const configs = await prisma.environmentConfig.findMany({
    where: { tier, isActive: true },
    orderBy: { isDefault: "desc" },
  });

  // Find config that explicitly allows this org
  const orgSpecific = configs.find((c) => {
    const allowed = c.allowedOrgIds as string[];
    return allowed.length > 0 && allowed.includes(orgId);
  });
  if (orgSpecific) return orgSpecific;

  // Fall back to default (allowedOrgIds empty = all)
  const defaultConfig = configs.find((c) => {
    const allowed = c.allowedOrgIds as string[];
    return allowed.length === 0 || c.isDefault;
  });

  return defaultConfig ?? null;
}

// ─── Validation ─────────────────────────────────────────────────────────

export function validateEnvironmentIsolation(
  currentTier: EnvironmentTier,
  targetTier: EnvironmentTier
): { allowed: boolean; reason?: string | undefined } {
  // Production cannot be accessed from development/testing
  if (
    targetTier === "PRODUCTION" &&
    (currentTier === "DEVELOPMENT" || currentTier === "TESTING")
  ) {
    return {
      allowed: false,
      reason: `Cannot access PRODUCTION from ${currentTier} environment`,
    };
  }
  return { allowed: true };
}

export async function getEnvironmentSummary() {
  const configs = await prisma.environmentConfig.findMany({
    where: { isActive: true },
    orderBy: { tier: "asc" },
  });

  const byTier: Record<string, number> = {};
  for (const config of configs) {
    byTier[config.tier] = (byTier[config.tier] || 0) + 1;
  }

  return {
    total: configs.length,
    byTier,
    configs: configs.map((c) => ({
      id: c.id,
      tier: c.tier,
      name: c.name,
      isolationLevel: c.isolationLevel,
      isDefault: c.isDefault,
      orgCount: (c.allowedOrgIds as string[]).length,
    })),
  };
}
