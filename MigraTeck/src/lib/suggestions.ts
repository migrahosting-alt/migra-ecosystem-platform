import { Prisma, SuggestionStatus, SuggestionTrigger, ProductKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Rule Management ────────────────────────────────────────────────────

interface CreateRuleInput {
  name: string;
  description?: string | undefined;
  trigger: SuggestionTrigger;
  sourceProduct?: ProductKey | undefined;
  targetProduct: ProductKey;
  priority?: number | undefined;
  title: string;
  body: string;
  actionLabel?: string | undefined;
  actionUrl?: string | undefined;
  conditions?: Prisma.InputJsonValue | undefined;
  maxPerOrg?: number | undefined;
}

export async function createSuggestionRule(input: CreateRuleInput) {
  const data: Record<string, unknown> = {
    name: input.name,
    trigger: input.trigger,
    targetProduct: input.targetProduct,
    title: input.title,
    body: input.body,
  };
  if (input.description !== undefined) data.description = input.description;
  if (input.sourceProduct !== undefined) data.sourceProduct = input.sourceProduct;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.actionLabel !== undefined) data.actionLabel = input.actionLabel;
  if (input.actionUrl !== undefined) data.actionUrl = input.actionUrl;
  if (input.conditions !== undefined) data.conditions = input.conditions;
  if (input.maxPerOrg !== undefined) data.maxPerOrg = input.maxPerOrg;

  return prisma.suggestionRule.create({
    data: data as Parameters<typeof prisma.suggestionRule.create>[0]["data"],
  });
}

export async function listSuggestionRules(activeOnly = true) {
  return prisma.suggestionRule.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });
}

export async function updateSuggestionRule(
  ruleId: string,
  updates: Partial<Pick<CreateRuleInput, "name" | "title" | "body" | "priority" | "actionLabel" | "actionUrl" | "conditions">> & { isActive?: boolean | undefined }
) {
  const data: Record<string, unknown> = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.title !== undefined) data.title = updates.title;
  if (updates.body !== undefined) data.body = updates.body;
  if (updates.priority !== undefined) data.priority = updates.priority;
  if (updates.actionLabel !== undefined) data.actionLabel = updates.actionLabel;
  if (updates.actionUrl !== undefined) data.actionUrl = updates.actionUrl;
  if (updates.conditions !== undefined) data.conditions = updates.conditions;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;

  return prisma.suggestionRule.update({
    where: { id: ruleId },
    data: data as Parameters<typeof prisma.suggestionRule.update>[0]["data"],
  });
}

export async function deleteSuggestionRule(ruleId: string) {
  return prisma.suggestionRule.delete({ where: { id: ruleId } });
}

// ─── Suggestion Lifecycle ───────────────────────────────────────────────

interface FireSuggestionInput {
  orgId: string;
  ruleId: string;
  userId?: string | undefined;
  triggerEvent?: string | undefined;
  triggerData?: Prisma.InputJsonValue | undefined;
}

export async function fireSuggestion(input: FireSuggestionInput) {
  const rule = await prisma.suggestionRule.findUnique({
    where: { id: input.ruleId },
  });
  if (!rule || !rule.isActive) return null;

  // Check org already has this suggestion (respect maxPerOrg)
  const existing = await prisma.suggestion.count({
    where: {
      orgId: input.orgId,
      ruleId: input.ruleId,
      status: { in: ["ACTIVE", "ACCEPTED"] },
    },
  });
  if (existing >= rule.maxPerOrg) return null;

  // Check org doesn't already have the target product active
  const entitlement = await prisma.orgEntitlement.findUnique({
    where: { orgId_product: { orgId: input.orgId, product: rule.targetProduct } },
  });
  if (entitlement && entitlement.status === "ACTIVE") return null;

  const data: Record<string, unknown> = {
    orgId: input.orgId,
    ruleId: input.ruleId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  };
  if (input.userId !== undefined) data.userId = input.userId;
  if (input.triggerEvent !== undefined) data.triggerEvent = input.triggerEvent;
  if (input.triggerData !== undefined) data.triggerData = input.triggerData;

  return prisma.suggestion.create({
    data: data as Parameters<typeof prisma.suggestion.create>[0]["data"],
    include: { rule: true },
  });
}

// ─── Evaluate Rules for a Trigger ───────────────────────────────────────

export async function evaluateTrigger(
  trigger: SuggestionTrigger,
  orgId: string,
  context?: { userId?: string; eventType?: string; data?: Prisma.InputJsonValue }
) {
  const rules = await prisma.suggestionRule.findMany({
    where: { trigger, isActive: true },
    orderBy: { priority: "asc" },
  });

  const results: Awaited<ReturnType<typeof fireSuggestion>>[] = [];

  for (const rule of rules) {
    const result = await fireSuggestion({
      orgId,
      ruleId: rule.id,
      userId: context?.userId,
      triggerEvent: context?.eventType,
      triggerData: context?.data,
    });
    if (result) results.push(result);
  }

  return results;
}

// ─── Query Suggestions ──────────────────────────────────────────────────

export async function listSuggestions(
  orgId: string,
  options?: { status?: SuggestionStatus | undefined; limit?: number | undefined }
) {
  const where: Record<string, unknown> = { orgId };
  if (options?.status) where.status = options.status;

  return prisma.suggestion.findMany({
    where,
    include: { rule: true },
    orderBy: [{ rule: { priority: "asc" } }, { createdAt: "desc" }],
    take: options?.limit ?? 10,
  });
}

export async function getActiveSuggestionCount(orgId: string) {
  return prisma.suggestion.count({
    where: { orgId, status: "ACTIVE" },
  });
}

export async function dismissSuggestion(suggestionId: string) {
  return prisma.suggestion.update({
    where: { id: suggestionId },
    data: { status: "DISMISSED", dismissedAt: new Date() },
  });
}

export async function acceptSuggestion(suggestionId: string) {
  return prisma.suggestion.update({
    where: { id: suggestionId },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
}

export async function cleanupExpiredSuggestions() {
  const { count } = await prisma.suggestion.updateMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return count;
}
