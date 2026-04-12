import { type IncidentSeverity, type IncidentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Compliance Runbooks ────────────────────────────────────────────────

export async function createRunbook(input: {
  title: string;
  slug: string;
  category: string;
  content: string;
  ownerId?: string | undefined;
}) {
  const data: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    category: input.category,
    content: input.content,
  };
  if (input.ownerId !== undefined) data.ownerId = input.ownerId;

  return prisma.complianceRunbook.create({
    data: data as Parameters<typeof prisma.complianceRunbook.create>[0]["data"],
  });
}

export async function listRunbooks(category?: string | undefined) {
  const where: Record<string, unknown> = {};
  if (category !== undefined) where.category = category;

  return prisma.complianceRunbook.findMany({
    where: where as Prisma.ComplianceRunbookWhereInput,
    include: { owner: { select: { id: true, name: true } } },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
}

export async function getRunbook(slug: string) {
  return prisma.complianceRunbook.findUniqueOrThrow({
    where: { slug },
    include: { owner: { select: { id: true, name: true } } },
  });
}

export async function updateRunbook(
  runbookId: string,
  input: {
    title?: string | undefined;
    content?: string | undefined;
    category?: string | undefined;
    isPublished?: boolean | undefined;
    ownerId?: string | undefined;
  }
) {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.content !== undefined) {
    data.content = input.content;
    data.version = { increment: 1 };
  }
  if (input.category !== undefined) data.category = input.category;
  if (input.isPublished !== undefined) data.isPublished = input.isPublished;
  if (input.ownerId !== undefined) data.ownerId = input.ownerId;

  return prisma.complianceRunbook.update({
    where: { id: runbookId },
    data: data as Parameters<typeof prisma.complianceRunbook.update>[0]["data"],
  });
}

export async function markRunbookReviewed(runbookId: string, nextReviewDays = 90) {
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + nextReviewDays);

  return prisma.complianceRunbook.update({
    where: { id: runbookId },
    data: { lastReviewAt: new Date(), nextReviewAt: nextReview },
  });
}

export async function getRunbooksDueForReview() {
  return prisma.complianceRunbook.findMany({
    where: {
      isPublished: true,
      OR: [
        { nextReviewAt: { lte: new Date() } },
        { nextReviewAt: null },
      ],
    },
    include: { owner: { select: { id: true, name: true, email: true } } },
    orderBy: { nextReviewAt: "asc" },
  });
}

// ─── Incidents ──────────────────────────────────────────────────────────

export async function createIncident(input: {
  orgId?: string | undefined;
  title: string;
  severity: IncidentSeverity;
  runbookId?: string | undefined;
  description?: string | undefined;
  impact?: string | undefined;
  reportedById?: string | undefined;
  assignedToId?: string | undefined;
}) {
  const data: Record<string, unknown> = {
    title: input.title,
    severity: input.severity,
  };
  if (input.orgId !== undefined) data.orgId = input.orgId;
  if (input.runbookId !== undefined) data.runbookId = input.runbookId;
  if (input.description !== undefined) data.description = input.description;
  if (input.impact !== undefined) data.impact = input.impact;
  if (input.reportedById !== undefined) data.reportedById = input.reportedById;
  if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;

  return prisma.incidentRecord.create({
    data: data as Parameters<typeof prisma.incidentRecord.create>[0]["data"],
  });
}

export async function updateIncidentStatus(
  incidentId: string,
  status: IncidentStatus,
  input?: {
    rootCause?: string | undefined;
    mitigationSteps?: string | undefined;
    postMortemUrl?: string | undefined;
    timeline?: Prisma.InputJsonValue | undefined;
  }
) {
  const data: Record<string, unknown> = { status };
  if (status === "MITIGATED") data.mitigatedAt = new Date();
  if (status === "RESOLVED") data.resolvedAt = new Date();
  if (status === "CLOSED") data.closedAt = new Date();
  if (input?.rootCause !== undefined) data.rootCause = input.rootCause;
  if (input?.mitigationSteps !== undefined) data.mitigationSteps = input.mitigationSteps;
  if (input?.postMortemUrl !== undefined) data.postMortemUrl = input.postMortemUrl;
  if (input?.timeline !== undefined) data.timeline = input.timeline;

  return prisma.incidentRecord.update({
    where: { id: incidentId },
    data: data as Parameters<typeof prisma.incidentRecord.update>[0]["data"],
  });
}

export async function listIncidents(input?: {
  orgId?: string | undefined;
  severity?: IncidentSeverity | undefined;
  status?: IncidentStatus | undefined;
}) {
  const where: Record<string, unknown> = {};
  if (input?.orgId !== undefined) where.orgId = input.orgId;
  if (input?.severity !== undefined) where.severity = input.severity;
  if (input?.status !== undefined) where.status = input.status;

  return prisma.incidentRecord.findMany({
    where: where as Prisma.IncidentRecordWhereInput,
    include: {
      runbook: { select: { id: true, title: true, slug: true } },
      reportedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
  });
}

export async function getIncident(incidentId: string) {
  return prisma.incidentRecord.findUniqueOrThrow({
    where: { id: incidentId },
    include: {
      runbook: { select: { id: true, title: true, slug: true, content: true } },
      reportedBy: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getIncidentSummary() {
  const [open, investigating, mitigated, resolved] = await Promise.all([
    prisma.incidentRecord.count({ where: { status: "OPEN" } }),
    prisma.incidentRecord.count({ where: { status: "INVESTIGATING" } }),
    prisma.incidentRecord.count({ where: { status: "MITIGATED" } }),
    prisma.incidentRecord.count({ where: { status: "RESOLVED" } }),
  ]);

  const bySeverity = await prisma.incidentRecord.groupBy({
    by: ["severity"],
    where: { status: { notIn: ["CLOSED"] } },
    _count: true,
  });

  return {
    activeCount: open + investigating + mitigated,
    open,
    investigating,
    mitigated,
    resolved,
    bySeverity: bySeverity.map((g) => ({ severity: g.severity, count: g._count })),
  };
}
