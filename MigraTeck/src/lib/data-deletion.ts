import { createHash } from "node:crypto";
import { type DeletionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Request Deletion ───────────────────────────────────────────────────

export async function requestDataDeletion(input: {
  orgId: string;
  requestedById: string;
  subjectEmail: string;
  subjectUserId?: string | undefined;
  scope?: string | undefined;
  categories?: string[] | undefined;
  reason?: string | undefined;
}) {
  const data: Record<string, unknown> = {
    orgId: input.orgId,
    requestedById: input.requestedById,
    subjectEmail: input.subjectEmail,
  };
  if (input.subjectUserId !== undefined) data.subjectUserId = input.subjectUserId;
  if (input.scope !== undefined) data.scope = input.scope;
  if (input.categories !== undefined) data.categories = input.categories;
  if (input.reason !== undefined) data.reason = input.reason;

  return prisma.dataDeletionRequest.create({
    data: data as Parameters<typeof prisma.dataDeletionRequest.create>[0]["data"],
  });
}

// ─── Approve / Execute / Complete ───────────────────────────────────────

export async function approveDeletion(requestId: string, approvedById: string) {
  return prisma.dataDeletionRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", approvedById, approvedAt: new Date() },
  });
}

export async function cancelDeletion(requestId: string) {
  return prisma.dataDeletionRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
}

export async function executeDeletion(requestId: string) {
  const request = await prisma.dataDeletionRequest.findUniqueOrThrow({
    where: { id: requestId },
  });

  if (request.status !== "APPROVED") {
    throw new Error(`Deletion request ${requestId} is not approved (status: ${request.status})`);
  }

  await prisma.dataDeletionRequest.update({
    where: { id: requestId },
    data: { status: "IN_PROGRESS", executedAt: new Date() },
  });

  try {
    const categories = request.categories as string[];
    const orgId = request.orgId;
    const subjectUserId = request.subjectUserId;
    const summary: Record<string, number> = {};

    for (const category of categories) {
      const count = await deleteCategoryData(category, orgId, subjectUserId);
      summary[category] = count;
    }

    // Generate deletion certificate hash
    const certData = JSON.stringify({
      requestId,
      subjectEmail: request.subjectEmail,
      categories,
      summary,
      completedAt: new Date().toISOString(),
    });
    const certHash = createHash("sha256").update(certData).digest("hex");

    await prisma.dataDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        certHash,
        metadata: summary as unknown as Prisma.InputJsonValue,
      },
    });

    return { requestId, certHash, summary };
  } catch (error) {
    await prisma.dataDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: "FAILED",
        metadata: { error: error instanceof Error ? error.message : String(error) } as unknown as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}

// ─── Category Purge Logic ───────────────────────────────────────────────

async function deleteCategoryData(
  category: string,
  orgId: string,
  userId?: string | null | undefined
): Promise<number> {
  switch (category) {
    case "audit": {
      const where: Record<string, unknown> = { orgId };
      if (userId) where.userId = userId;
      const result = await prisma.auditLog.deleteMany({
        where: where as Prisma.AuditLogWhereInput,
      });
      return result.count;
    }
    case "usage": {
      const where: Record<string, unknown> = { orgId };
      const result = await prisma.usageEvent.deleteMany({
        where: where as Prisma.UsageEventWhereInput,
      });
      return result.count;
    }
    case "notifications": {
      const where: Record<string, unknown> = {};
      if (userId) where.userId = userId;
      const result = await prisma.notification.deleteMany({
        where: where as Prisma.NotificationWhereInput,
      });
      return result.count;
    }
    case "personal": {
      if (!userId) return 0;
      // Anonymize user record rather than delete (preserves FK integrity)
      await prisma.user.update({
        where: { id: userId },
        data: {
          name: "[REDACTED]",
          email: null,
          phoneE164: null,
          image: null,
          passwordHash: null,
        },
      });
      return 1;
    }
    case "security": {
      const where: Record<string, unknown> = {};
      if (userId) where.userId = userId;
      else where.orgId = orgId;
      const result = await prisma.securityEvent.deleteMany({
        where: where as Prisma.SecurityEventWhereInput,
      });
      return result.count;
    }
    default:
      return 0;
  }
}

// ─── Query ──────────────────────────────────────────────────────────────

export async function listDeletionRequests(
  orgId: string,
  status?: DeletionStatus | undefined
) {
  const where: Record<string, unknown> = { orgId };
  if (status !== undefined) where.status = status;

  return prisma.dataDeletionRequest.findMany({
    where: where as Prisma.DataDeletionRequestWhereInput,
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDeletionRequest(requestId: string) {
  return prisma.dataDeletionRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getDeletionCertificate(requestId: string) {
  const request = await prisma.dataDeletionRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  if (request.status !== "COMPLETED" || !request.certHash) {
    throw new Error("Deletion not yet completed");
  }
  return {
    requestId: request.id,
    subjectEmail: request.subjectEmail,
    categories: request.categories,
    certHash: request.certHash,
    completedAt: request.completedAt,
    summary: request.metadata,
  };
}
