import { JourneyStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Journey CRUD ───────────────────────────────────────────────────────

export async function getOrCreateJourney(orgId: string) {
  const existing = await prisma.customerJourney.findUnique({
    where: { orgId },
  });
  if (existing) return existing;

  return prisma.customerJourney.create({
    data: { orgId },
  });
}

export async function getJourney(orgId: string) {
  return prisma.customerJourney.findUnique({ where: { orgId } });
}

// ─── Lifecycle Scoring ──────────────────────────────────────────────────

interface ScoreInput {
  productsActive: number;
  hasRecentActivity: boolean; // activity in last 7 days
  daysSinceFirstProduct: number;
  hasPayingSubscription: boolean;
  entitlementCount: number;
}

export function computeHealthScore(input: ScoreInput): number {
  let score = 0;

  // Products active (0-40 points)
  score += Math.min(input.productsActive * 10, 40);

  // Recent activity (0-20 points)
  if (input.hasRecentActivity) score += 20;

  // Has paying subscription (0-20 points)
  if (input.hasPayingSubscription) score += 20;

  // Tenure bonus (0-10 points)
  if (input.daysSinceFirstProduct > 30) score += 5;
  if (input.daysSinceFirstProduct > 90) score += 5;

  // Multi-product bonus (0-10 points)
  if (input.entitlementCount >= 3) score += 10;

  return Math.min(score, 100);
}

export function computeChurnRisk(input: ScoreInput): number {
  let risk = 50; // baseline

  // No recent activity = high risk
  if (!input.hasRecentActivity) risk += 30;

  // Low product adoption
  if (input.productsActive <= 1) risk += 15;

  // No paying subscription
  if (!input.hasPayingSubscription) risk += 20;

  // Multi-product = lower risk
  if (input.productsActive >= 3) risk -= 25;
  if (input.hasRecentActivity) risk -= 20;
  if (input.daysSinceFirstProduct > 90 && input.hasRecentActivity) risk -= 15;

  return Math.max(0, Math.min(risk, 100));
}

export function deriveStage(healthScore: number, churnRisk: number, productsActive: number): JourneyStage {
  if (churnRisk >= 80) return "CHURNED";
  if (churnRisk >= 60) return "AT_RISK";
  if (productsActive === 0) return "ONBOARDING";
  if (healthScore >= 80 && productsActive >= 3) return "POWER_USER";
  if (healthScore >= 50) return "ENGAGED";
  return "ACTIVATED";
}

// ─── Recalculate Journey for Org ────────────────────────────────────────

export async function recalculateJourney(orgId: string) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [entitlements, recentActivity, subscription, journey] = await Promise.all([
    prisma.orgEntitlement.findMany({
      where: { orgId, status: "ACTIVE" },
      select: { product: true, startsAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { orgId, createdAt: { gte: sevenDaysAgo } },
      select: { id: true },
    }),
    prisma.billingSubscription.findFirst({
      where: { orgId, status: { in: ["ACTIVE", "TRIALING"] } },
      select: { id: true },
    }),
    getOrCreateJourney(orgId),
  ]);

  const productsActive = entitlements.length;
  const hasRecentActivity = !!recentActivity;
  const hasPayingSubscription = !!subscription;

  // Find earliest product activation
  const earliest = entitlements
    .map((e) => e.startsAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const daysSinceFirstProduct = earliest
    ? Math.floor((Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const healthScore = computeHealthScore({
    productsActive,
    hasRecentActivity,
    daysSinceFirstProduct,
    hasPayingSubscription,
    entitlementCount: entitlements.length,
  });
  const churnRisk = computeChurnRisk({
    productsActive,
    hasRecentActivity,
    daysSinceFirstProduct,
    hasPayingSubscription,
    entitlementCount: entitlements.length,
  });
  const stage = deriveStage(healthScore, churnRisk, productsActive);

  const updateData: Record<string, unknown> = {
    stage,
    score: healthScore,
    churnRiskScore: churnRisk,
    productsActive,
    lastActivityAt: hasRecentActivity ? new Date() : journey.lastActivityAt,
  };
  if (!journey.firstProductAt && productsActive > 0 && earliest) {
    updateData.firstProductAt = earliest;
  }

  return prisma.customerJourney.update({
    where: { orgId },
    data: updateData as Parameters<typeof prisma.customerJourney.update>[0]["data"],
  });
}

// ─── Record Milestone ───────────────────────────────────────────────────

export async function recordMilestone(orgId: string, milestoneKey: string) {
  const journey = await getOrCreateJourney(orgId);
  const milestones = (journey.milestones as Record<string, string>) ?? {};

  if (milestones[milestoneKey]) return journey; // already recorded

  milestones[milestoneKey] = new Date().toISOString();

  return prisma.customerJourney.update({
    where: { orgId },
    data: { milestones: milestones as unknown as Prisma.InputJsonValue },
  });
}

// ─── Journey Analytics ──────────────────────────────────────────────────

export async function getJourneyDistribution() {
  const stages = await prisma.customerJourney.groupBy({
    by: ["stage"],
    _count: { id: true },
    _avg: { score: true, churnRiskScore: true },
  });

  return stages.map((s) => ({
    stage: s.stage,
    count: s._count.id,
    avgScore: Math.round(s._avg.score ?? 0),
    avgChurnRisk: Math.round(s._avg.churnRiskScore ?? 0),
  }));
}

export async function getAtRiskOrgs(limit = 20) {
  return prisma.customerJourney.findMany({
    where: {
      stage: { in: ["AT_RISK", "CHURNED"] },
    },
    include: { org: { select: { id: true, name: true, slug: true } } },
    orderBy: { churnRiskScore: "desc" },
    take: limit,
  });
}

export async function getAdoptionFunnel() {
  const [totalOrgs, withProduct, withMultiProduct, withSubscription] = await Promise.all([
    prisma.organization.count(),
    prisma.customerJourney.count({ where: { productsActive: { gte: 1 } } }),
    prisma.customerJourney.count({ where: { productsActive: { gte: 2 } } }),
    prisma.billingSubscription.groupBy({
      by: ["orgId"],
      where: { status: { in: ["ACTIVE", "TRIALING"] } },
    }),
  ]);

  return {
    totalOrgs,
    withProduct,
    withMultiProduct,
    withSubscription: withSubscription.length,
  };
}
