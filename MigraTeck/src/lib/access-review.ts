import { type AccessReviewStatus, type AccessReviewDecision, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Campaign CRUD ──────────────────────────────────────────────────────

export async function createAccessReview(input: {
  orgId: string;
  title: string;
  description?: string | undefined;
  initiatedById: string;
  dueDate: Date;
}) {
  // Create review and auto-populate entries from current memberships
  const memberships = await prisma.membership.findMany({
    where: { orgId: input.orgId, status: "ACTIVE" },
    select: { id: true, userId: true, role: true },
  });

  const review = await prisma.accessReview.create({
    data: {
      orgId: input.orgId,
      title: input.title,
      description: input.description ?? null,
      initiatedById: input.initiatedById,
      dueDate: input.dueDate,
      entries: {
        create: memberships.map((m) => ({
          userId: m.userId,
          membershipId: m.id,
          currentRole: m.role,
        })),
      },
    },
    include: { entries: true },
  });

  return review;
}

export async function listAccessReviews(
  orgId: string,
  status?: AccessReviewStatus | undefined
) {
  const where: Record<string, unknown> = { orgId };
  if (status !== undefined) where.status = status;

  return prisma.accessReview.findMany({
    where: where as Prisma.AccessReviewWhereInput,
    include: {
      initiatedBy: { select: { id: true, name: true, email: true } },
      _count: { select: { entries: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAccessReview(reviewId: string) {
  return prisma.accessReview.findUniqueOrThrow({
    where: { id: reviewId },
    include: {
      initiatedBy: { select: { id: true, name: true, email: true } },
      entries: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          decidedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

// ─── Review Decisions ───────────────────────────────────────────────────

export async function submitReviewDecision(input: {
  entryId: string;
  decision: AccessReviewDecision;
  decidedById: string;
  notes?: string | undefined;
}) {
  const data: Record<string, unknown> = {
    decision: input.decision,
    decidedById: input.decidedById,
    decidedAt: new Date(),
  };
  if (input.notes !== undefined) data.notes = input.notes;

  return prisma.accessReviewEntry.update({
    where: { id: input.entryId },
    data: data as Parameters<typeof prisma.accessReviewEntry.update>[0]["data"],
  });
}

export async function completeAccessReview(reviewId: string) {
  // Check all entries have decisions
  const pendingCount = await prisma.accessReviewEntry.count({
    where: { reviewId, decision: "PENDING" },
  });
  if (pendingCount > 0) {
    throw new Error(`${pendingCount} entries still pending review`);
  }

  return prisma.accessReview.update({
    where: { id: reviewId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

// ─── Apply Decisions ────────────────────────────────────────────────────

export async function applyReviewDecisions(reviewId: string) {
  const entries = await prisma.accessReviewEntry.findMany({
    where: { reviewId, decision: { not: "PENDING" } },
    include: { user: { select: { id: true } } },
  });

  const review = await prisma.accessReview.findUniqueOrThrow({
    where: { id: reviewId },
  });

  const results: { userId: string; action: string; success: boolean }[] = [];

  for (const entry of entries) {
    try {
      if (entry.decision === "REVOKE" && entry.membershipId) {
        await prisma.membership.update({
          where: { id: entry.membershipId },
          data: { status: "SUSPENDED" },
        });
        results.push({ userId: entry.userId, action: "revoked", success: true });
      } else if (entry.decision === "DOWNGRADE" && entry.membershipId) {
        await prisma.membership.update({
          where: { id: entry.membershipId },
          data: { role: "READONLY" },
        });
        results.push({ userId: entry.userId, action: "downgraded", success: true });
      } else {
        results.push({ userId: entry.userId, action: "kept", success: true });
      }
    } catch {
      results.push({ userId: entry.userId, action: entry.decision, success: false });
    }
  }

  return { reviewId, orgId: review.orgId, results };
}

// ─── Reports ────────────────────────────────────────────────────────────

export async function generateAccessReviewReport(reviewId: string) {
  const review = await getAccessReview(reviewId);

  const summary = {
    reviewId: review.id,
    title: review.title,
    orgId: review.orgId,
    status: review.status,
    dueDate: review.dueDate,
    completedAt: review.completedAt,
    totalEntries: review.entries.length,
    decisions: {
      keep: review.entries.filter((e) => e.decision === "KEEP").length,
      revoke: review.entries.filter((e) => e.decision === "REVOKE").length,
      downgrade: review.entries.filter((e) => e.decision === "DOWNGRADE").length,
      pending: review.entries.filter((e) => e.decision === "PENDING").length,
    },
    entries: review.entries.map((e) => ({
      user: e.user.name ?? e.user.email,
      currentRole: e.currentRole,
      decision: e.decision,
      decidedBy: e.decidedBy?.name ?? null,
      decidedAt: e.decidedAt,
      notes: e.notes,
    })),
  };

  return summary;
}

export async function getOverdueReviews() {
  return prisma.accessReview.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS"] },
      dueDate: { lt: new Date() },
    },
    include: {
      org: { select: { id: true, name: true } },
      initiatedBy: { select: { id: true, name: true } },
      _count: { select: { entries: true } },
    },
    orderBy: { dueDate: "asc" },
  });
}
