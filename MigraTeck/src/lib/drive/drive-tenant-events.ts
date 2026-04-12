import type { DriveTenantActorType, DriveTenantStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ── Append a tenant lifecycle event ─────────────────────────

export interface AppendTenantEventInput {
  tenantId: string;
  orgId: string;
  action: string;
  previousStatus?: DriveTenantStatus | null | undefined;
  newStatus?: DriveTenantStatus | null | undefined;
  previousPlanCode?: string | null | undefined;
  newPlanCode?: string | null | undefined;
  previousQuotaGb?: number | null | undefined;
  newQuotaGb?: number | null | undefined;
  subscriptionId?: string | null | undefined;
  entitlementId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  traceId?: string | null | undefined;
  actorType: DriveTenantActorType;
  actorId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export async function appendTenantEvent(input: AppendTenantEventInput) {
  return prisma.driveTenantEvent.create({
    data: {
      tenantId: input.tenantId,
      orgId: input.orgId,
      action: input.action,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
      previousPlanCode: input.previousPlanCode ?? null,
      newPlanCode: input.newPlanCode ?? null,
      previousQuotaGb: input.previousQuotaGb ?? null,
      newQuotaGb: input.newQuotaGb ?? null,
      subscriptionId: input.subscriptionId ?? null,
      entitlementId: input.entitlementId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      traceId: input.traceId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

// ── Query events for a tenant ───────────────────────────────

export async function listTenantEvents(
  tenantId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Prisma.DriveTenantEventWhereInput = { tenantId };

  if (opts.cursor) {
    where.id = { lt: opts.cursor };
  }

  const events = await prisma.driveTenantEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = events.length > limit;
  const items = hasMore ? events.slice(0, limit) : events;
  const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

  return { items, nextCursor };
}

// ── Query events for an org ─────────────────────────────────

export async function listOrgTenantEvents(
  orgId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Prisma.DriveTenantEventWhereInput = { orgId };

  if (opts.cursor) {
    where.id = { lt: opts.cursor };
  }

  const events = await prisma.driveTenantEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = events.length > limit;
  const items = hasMore ? events.slice(0, limit) : events;
  const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

  return { items, nextCursor };
}
