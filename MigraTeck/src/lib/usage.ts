import { ProductKey, UsageMetric, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ── Record usage events ──

interface RecordUsageInput {
  orgId: string;
  product: ProductKey;
  metric: UsageMetric;
  quantity?: bigint | number;
  metadata?: Record<string, unknown>;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const quantity = BigInt(input.quantity ?? 1);

  await prisma.$transaction([
    prisma.usageEvent.create({
      data: {
        orgId: input.orgId,
        product: input.product,
        metric: input.metric,
        quantity,
        ...(input.metadata
          ? { metadata: input.metadata as unknown as Prisma.InputJsonValue }
          : {}),
      },
    }),
    // Increment current period quota counter if a quota exists
    prisma.usageQuota.updateMany({
      where: {
        orgId: input.orgId,
        product: input.product,
        metric: input.metric,
        periodStart: { lte: new Date() },
        periodEnd: { gt: new Date() },
      },
      data: {
        currentUsed: { increment: quantity },
      },
    }),
  ]);
}

// ── Quota enforcement ──

export class QuotaExceededError extends Error {
  code = "QUOTA_EXCEEDED" as const;
  httpStatus = 429;
  metric: UsageMetric;
  limit: bigint;
  used: bigint;

  constructor(metric: UsageMetric, limit: bigint, used: bigint) {
    super(`Usage quota exceeded for ${metric}`);
    this.name = "QuotaExceededError";
    this.metric = metric;
    this.limit = limit;
    this.used = used;
  }
}

interface AssertQuotaInput {
  orgId: string;
  product: ProductKey;
  metric: UsageMetric;
  requestedQuantity?: bigint | number;
}

export async function assertQuota(input: AssertQuotaInput): Promise<void> {
  const requested = BigInt(input.requestedQuantity ?? 1);

  const quota = await prisma.usageQuota.findFirst({
    where: {
      orgId: input.orgId,
      product: input.product,
      metric: input.metric,
      periodStart: { lte: new Date() },
      periodEnd: { gt: new Date() },
    },
    select: {
      limitValue: true,
      currentUsed: true,
    },
  });

  // No quota defined → unlimited
  if (!quota) {
    return;
  }

  if (quota.currentUsed + requested > quota.limitValue) {
    throw new QuotaExceededError(input.metric, quota.limitValue, quota.currentUsed);
  }
}

// ── Query usage ──

interface UsageSummary {
  metric: UsageMetric;
  total: bigint;
}

export async function getUsageSummary(
  orgId: string,
  product: ProductKey,
  since: Date,
  until?: Date,
): Promise<UsageSummary[]> {
  const rows = await prisma.usageEvent.groupBy({
    by: ["metric"],
    where: {
      orgId,
      product,
      timestamp: {
        gte: since,
        ...(until ? { lt: until } : {}),
      },
    },
    _sum: { quantity: true },
  });

  return rows.map((row) => ({
    metric: row.metric,
    total: row._sum.quantity ?? BigInt(0),
  }));
}

export async function getOrgQuotas(orgId: string) {
  const now = new Date();
  return prisma.usageQuota.findMany({
    where: {
      orgId,
      periodStart: { lte: now },
      periodEnd: { gt: now },
    },
    select: {
      product: true,
      metric: true,
      limitValue: true,
      currentUsed: true,
      periodStart: true,
      periodEnd: true,
    },
    orderBy: [{ product: "asc" }, { metric: "asc" }],
  });
}

// ── Quota provisioning ──

export async function upsertQuota(input: {
  orgId: string;
  product: ProductKey;
  metric: UsageMetric;
  limitValue: bigint | number;
  periodStart: Date;
  periodEnd: Date;
}): Promise<void> {
  const limitValue = BigInt(input.limitValue);

  await prisma.usageQuota.upsert({
    where: {
      orgId_product_metric_periodStart: {
        orgId: input.orgId,
        product: input.product,
        metric: input.metric,
        periodStart: input.periodStart,
      },
    },
    update: { limitValue, periodEnd: input.periodEnd },
    create: {
      orgId: input.orgId,
      product: input.product,
      metric: input.metric,
      limitValue,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
  });
}
