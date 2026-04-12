import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeContentJob } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  briefId: z.string().cuid().nullable().optional(),
  connectionId: z.string().cuid().nullable().optional(),
  captionId: z.string().cuid().nullable().optional(),
  selectedAssetId: z.string().cuid().nullable().optional(),
  title: z.string().trim().min(2).max(160).optional(),
  platform: z.string().trim().min(1).max(40).optional(),
  format: z.string().trim().min(2).max(40).optional(),
  publishMode: z.string().trim().min(2).max(40).optional(),
  status: z.string().trim().min(2).max(40).optional(),
  destinationUrl: z.string().trim().url().nullable().optional(),
  useLinkPreview: z.boolean().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  caption: z.string().trim().max(4000).nullable().optional(),
  assetUrls: z.array(z.string().trim().url()).max(12).optional(),
  thumbnailUrl: z.string().trim().url().nullable().optional(),
  externalPostUrl: z.string().trim().url().nullable().optional(),
  publishProofUrl: z.string().trim().url().nullable().optional(),
  aiPrompt: z.string().trim().max(4000).nullable().optional(),
  internalNotes: z.string().trim().max(4000).nullable().optional(),
  complianceNotes: z.string().trim().max(4000).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/jobs/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketContentJob.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Content job not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const nextStatus = parsed.data.status?.trim().toLowerCase() || existing.status;
  const nextPublishMode = parsed.data.publishMode?.trim().toLowerCase() || existing.publishMode;
  const nextBriefId = parsed.data.briefId !== undefined ? parsed.data.briefId || null : existing.briefId;
  if (nextStatus !== "draft" && !nextBriefId) {
    return NextResponse.json({ error: "campaign_id is required for queued, scheduled, and publish-ready jobs." }, { status: 400 });
  }
  if (nextPublishMode === "api" && !nextBriefId) {
    return NextResponse.json({ error: "API publish jobs require a campaign before they can enter the queue." }, { status: 400 });
  }

  const publishedAt =
    parsed.data.status?.trim().toLowerCase() === "published" && existing.publishedAt === null ? new Date() : undefined;

  const job = await prisma.migraMarketContentJob.update({
    where: { id },
    data: {
      ...(parsed.data.briefId !== undefined ? { briefId: parsed.data.briefId || null } : {}),
      ...(parsed.data.connectionId !== undefined ? { connectionId: parsed.data.connectionId || null } : {}),
      ...(parsed.data.captionId !== undefined ? { captionId: parsed.data.captionId || null } : {}),
      ...(parsed.data.selectedAssetId !== undefined ? { selectedAssetId: parsed.data.selectedAssetId || null } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.platform !== undefined ? { platform: parsed.data.platform.trim().toLowerCase() } : {}),
      ...(parsed.data.format !== undefined ? { format: parsed.data.format.trim().toLowerCase() } : {}),
      ...(parsed.data.publishMode !== undefined ? { publishMode: nextPublishMode } : {}),
      ...(parsed.data.status !== undefined ? { status: nextStatus } : {}),
      ...(parsed.data.destinationUrl !== undefined ? { destinationUrl: parsed.data.destinationUrl || null } : {}),
      ...(parsed.data.useLinkPreview !== undefined ? { useLinkPreview: parsed.data.useLinkPreview } : {}),
      validationStatus: "unvalidated",
      ...(parsed.data.scheduledAt !== undefined ? { scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null } : {}),
      ...(parsed.data.caption !== undefined ? { caption: parsed.data.caption || null } : {}),
      ...(parsed.data.assetUrls !== undefined ? { assetUrls: listToJson(normalizeStringList(parsed.data.assetUrls)) } : {}),
      ...(parsed.data.thumbnailUrl !== undefined ? { thumbnailUrl: parsed.data.thumbnailUrl || null } : {}),
      ...(parsed.data.externalPostUrl !== undefined ? { externalPostUrl: parsed.data.externalPostUrl || null } : {}),
      ...(parsed.data.publishProofUrl !== undefined ? { publishProofUrl: parsed.data.publishProofUrl || null } : {}),
      ...(parsed.data.aiPrompt !== undefined ? { aiPrompt: parsed.data.aiPrompt || null } : {}),
      ...(parsed.data.internalNotes !== undefined ? { internalNotes: parsed.data.internalNotes || null } : {}),
      ...(parsed.data.complianceNotes !== undefined ? { complianceNotes: parsed.data.complianceNotes || null } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    },
    include: {
      brief: true,
      connection: true,
      captionVariant: true,
      selectedAsset: true,
      validations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CONTENT_JOB_UPDATED",
    resourceType: "migramarket_content_job",
    resourceId: job.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ job: serializeContentJob(job) });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/jobs/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketContentJob.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Content job not found." }, { status: 404 });
  }

  await prisma.migraMarketContentJob.delete({ where: { id } });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CONTENT_JOB_DELETED",
    resourceType: "migramarket_content_job",
    resourceId: id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ ok: true });
}
