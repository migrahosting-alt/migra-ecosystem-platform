import type { BillingContext } from "../context";
import type { BillingUsageEvent, UsageSource, ProductFamily } from "../types";

export interface RecordUsageInput {
  orgId: string;
  productFamily: ProductFamily;
  meterName: string;
  quantity: number;
  windowStart: Date;
  windowEnd: Date;
  idempotencyKey: string;
  source?: UsageSource;
}

/**
 * Record a usage event to the internal ledger.
 * Usage is recorded locally first, then reported to Stripe by a worker.
 */
export async function recordUsage(
  ctx: BillingContext,
  input: RecordUsageInput,
): Promise<BillingUsageEvent> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId: input.orgId },
  });
  if (!account) {
    throw new Error(`No billing account for org ${input.orgId}`);
  }

  // Idempotent insert — if key exists, return existing
  const existing = await ctx.db.billingUsageEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing as BillingUsageEvent;

  const event = await ctx.db.billingUsageEvent.create({
    data: {
      orgId: input.orgId,
      billingAccountId: account.id,
      productFamily: input.productFamily,
      meterName: input.meterName,
      quantity: input.quantity,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      idempotencyKey: input.idempotencyKey,
      source: (input.source ?? "api").toUpperCase(),
    },
  });

  return event as BillingUsageEvent;
}

/**
 * Get usage summary for an org, grouped by product family and meter.
 */
export async function getUsageSummary(
  ctx: BillingContext,
  orgId: string,
  opts?: { productFamily?: ProductFamily; meterName?: string; since?: Date },
): Promise<UsageSummaryEntry[]> {
  const where: Record<string, unknown> = { orgId };
  if (opts?.productFamily) where.productFamily = opts.productFamily;
  if (opts?.meterName) where.meterName = opts.meterName;
  if (opts?.since) where.windowStart = { gte: opts.since };

  const events = await ctx.db.billingUsageEvent.findMany({ where });

  // Aggregate by product family + meter name
  const groups = new Map<string, { productFamily: string; meterName: string; totalQuantity: number; eventCount: number }>();

  for (const event of events) {
    const key = `${event.productFamily}:${event.meterName}`;
    const group = groups.get(key) ?? {
      productFamily: event.productFamily,
      meterName: event.meterName,
      totalQuantity: 0,
      eventCount: 0,
    };
    group.totalQuantity += event.quantity;
    group.eventCount += 1;
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

export interface UsageSummaryEntry {
  productFamily: string;
  meterName: string;
  totalQuantity: number;
  eventCount: number;
}

/**
 * Get unreported usage events (for the worker that syncs to Stripe).
 */
export async function getUnreportedUsage(
  ctx: BillingContext,
  limit?: number,
): Promise<BillingUsageEvent[]> {
  const events = await ctx.db.billingUsageEvent.findMany({
    where: { reportedToStripeAt: null },
    orderBy: { createdAt: "asc" },
    take: limit ?? 100,
  });
  return events as BillingUsageEvent[];
}

/**
 * Mark usage events as reported to Stripe.
 */
export async function markUsageReported(
  ctx: BillingContext,
  eventIds: string[],
): Promise<void> {
  for (const id of eventIds) {
    await ctx.db.billingUsageEvent.update({
      where: { id },
      data: { reportedToStripeAt: new Date() },
    });
  }
}
