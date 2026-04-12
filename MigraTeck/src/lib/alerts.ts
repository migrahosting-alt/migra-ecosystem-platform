import { Prisma, AlertSeverity, AlertStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyOrgMembers, createNotification } from "@/lib/notifications";

// ─── Types ──────────────────────────────────────────────────────────────

export interface CreateAlertRuleInput {
  name: string;
  description?: string | undefined;
  eventType: string;
  condition: Prisma.InputJsonValue;
  severity?: AlertSeverity | undefined;
  cooldownMinutes?: number | undefined;
  notifyChannels: string[];
  notifyRoleMin?: string | undefined;
}

export interface RaiseAlertInput {
  ruleId?: string | undefined;
  orgId?: string | undefined;
  severity?: AlertSeverity | undefined;
  title: string;
  message: string;
  source: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

// ─── Alert Rules CRUD ───────────────────────────────────────────────────

export async function createAlertRule(input: CreateAlertRuleInput) {
  const data: Record<string, unknown> = {
    name: input.name,
    eventType: input.eventType,
    condition: input.condition,
    severity: input.severity ?? "WARNING",
    cooldownMinutes: input.cooldownMinutes ?? 60,
    notifyChannels: input.notifyChannels as unknown as Prisma.InputJsonValue,
  };
  if (input.description !== undefined) data.description = input.description;
  if (input.notifyRoleMin !== undefined) data.notifyRoleMin = input.notifyRoleMin;

  return prisma.alertRule.create({ data: data as Parameters<typeof prisma.alertRule.create>[0]["data"] });
}

export async function listAlertRules() {
  return prisma.alertRule.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { alerts: true } } },
  });
}

export async function updateAlertRule(
  ruleId: string,
  data: Partial<Pick<CreateAlertRuleInput, "name" | "description" | "eventType" | "condition" | "severity" | "cooldownMinutes" | "notifyChannels" | "notifyRoleMin">> & { status?: "ENABLED" | "DISABLED" | undefined }
) {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.eventType !== undefined) updateData.eventType = data.eventType;
  if (data.condition !== undefined) updateData.condition = data.condition;
  if (data.severity !== undefined) updateData.severity = data.severity;
  if (data.cooldownMinutes !== undefined) updateData.cooldownMinutes = data.cooldownMinutes;
  if (data.notifyChannels !== undefined) updateData.notifyChannels = data.notifyChannels as unknown as Prisma.InputJsonValue;
  if (data.notifyRoleMin !== undefined) updateData.notifyRoleMin = data.notifyRoleMin;
  if (data.status !== undefined) updateData.status = data.status;

  return prisma.alertRule.update({
    where: { id: ruleId },
    data: updateData,
  });
}

export async function deleteAlertRule(ruleId: string) {
  return prisma.alertRule.delete({ where: { id: ruleId } });
}

// ─── Alert Lifecycle ────────────────────────────────────────────────────

export async function raiseAlert(input: RaiseAlertInput) {
  // Check cooldown if rule-based
  if (input.ruleId) {
    const rule = await prisma.alertRule.findUnique({
      where: { id: input.ruleId },
    });
    if (rule?.lastFiredAt) {
      const cooldownMs = (rule.cooldownMinutes ?? 60) * 60 * 1000;
      if (Date.now() - rule.lastFiredAt.getTime() < cooldownMs) {
        return null; // in cooldown
      }
    }
    if (rule?.status === "SNOOZED" && rule.snoozedUntil && rule.snoozedUntil > new Date()) {
      return null; // snoozed
    }
  }

  const alertData: Record<string, unknown> = {
    severity: input.severity ?? "WARNING",
    title: input.title,
    message: input.message,
    source: input.source,
  };
  if (input.ruleId !== undefined) alertData.ruleId = input.ruleId;
  if (input.orgId !== undefined) alertData.orgId = input.orgId;
  if (input.entityType !== undefined) alertData.entityType = input.entityType;
  if (input.entityId !== undefined) alertData.entityId = input.entityId;
  if (input.metadata !== undefined) alertData.metadata = input.metadata;

  const alert = await prisma.alert.create({ data: alertData as Parameters<typeof prisma.alert.create>[0]["data"] });

  // Update rule lastFiredAt
  if (input.ruleId) {
    await prisma.alertRule.update({
      where: { id: input.ruleId },
      data: { lastFiredAt: new Date() },
    }).catch(() => {/* non-critical */});
  }

  // Send notifications
  if (input.orgId) {
    notifyOrgMembers({
      orgId: input.orgId,
      title: `[${input.severity ?? "WARNING"}] ${input.title}`,
      body: input.message,
      category: "alert",
      metadata: { alertId: alert.id, severity: input.severity ?? "WARNING" } as unknown as Prisma.InputJsonValue,
      minRole: "ADMIN",
    }).catch(() => {/* non-critical */});
  }

  return alert;
}

export async function acknowledgeAlert(alertId: string, userId: string) {
  return prisma.alert.update({
    where: { id: alertId },
    data: {
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
    },
  });
}

export async function resolveAlert(alertId: string, userId: string) {
  return prisma.alert.update({
    where: { id: alertId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: userId,
    },
  });
}

export async function silenceAlert(alertId: string) {
  return prisma.alert.update({
    where: { id: alertId },
    data: { status: "SILENCED" },
  });
}

// ─── Query Alerts ───────────────────────────────────────────────────────

export interface ListAlertsInput {
  orgId?: string | undefined;
  status?: AlertStatus | undefined;
  severity?: AlertSeverity | undefined;
  since?: Date | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function listAlerts(input: ListAlertsInput) {
  const limit = Math.min(input.limit ?? 50, 200);

  const where: Prisma.AlertWhereInput = {
    ...(input.orgId ? { orgId: input.orgId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.since ? { createdAt: { gte: input.since } } : {}),
  };

  const alerts = await prisma.alert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: { rule: { select: { name: true, eventType: true } } },
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = alerts.length > limit;
  const items = hasMore ? alerts.slice(0, limit) : alerts;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
  };
}

export async function getActiveAlertCount(orgId?: string) {
  return prisma.alert.count({
    where: {
      status: { in: ["ACTIVE", "ACKNOWLEDGED"] },
      ...(orgId ? { orgId } : {}),
    },
  });
}

// ─── Rule Evaluation Engine ─────────────────────────────────────────────

interface ConditionSpec {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "exists";
  value: unknown;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(payload: unknown, condition: ConditionSpec): boolean {
  const actual = getNestedValue(payload, condition.field);

  switch (condition.op) {
    case "eq": return actual === condition.value;
    case "ne": return actual !== condition.value;
    case "gt": return typeof actual === "number" && actual > (condition.value as number);
    case "gte": return typeof actual === "number" && actual >= (condition.value as number);
    case "lt": return typeof actual === "number" && actual < (condition.value as number);
    case "lte": return typeof actual === "number" && actual <= (condition.value as number);
    case "contains": return typeof actual === "string" && actual.includes(String(condition.value));
    case "exists": return actual !== undefined && actual !== null;
    default: return false;
  }
}

export async function evaluateAlertRules(eventType: string, payload: unknown, orgId?: string) {
  const rules = await prisma.alertRule.findMany({
    where: {
      status: "ENABLED",
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
    },
  });

  const matched: string[] = [];

  for (const rule of rules) {
    // Check event type pattern match
    if (rule.eventType === "*" || rule.eventType === eventType) {
      // pass
    } else if (rule.eventType.endsWith(".*") && eventType.startsWith(rule.eventType.slice(0, -1))) {
      // wildcard prefix match
    } else {
      continue;
    }

    const condition = rule.condition as unknown as ConditionSpec;
    if (condition && condition.field && condition.op) {
      if (!evaluateCondition(payload, condition)) continue;
    }

    const alert = await raiseAlert({
      ruleId: rule.id,
      orgId,
      severity: rule.severity as AlertSeverity,
      title: `Alert: ${rule.name}`,
      message: `Rule "${rule.name}" triggered on ${eventType}`,
      source: "alert-engine",
      metadata: { eventType, ruleId: rule.id } as unknown as Prisma.InputJsonValue,
    });

    if (alert) matched.push(alert.id);
  }

  return matched;
}
