import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeContentJob } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  briefId: z.string().cuid().nullable().optional(),
  connectionId: z.string().cuid().nullable().optional(),
  captionId: z.string().cuid().nullable().optional(),
  selectedAssetId: z.string().cuid().nullable().optional(),
  title: z.string().trim().min(2).max(160),
  platform: z.string().trim().min(1).max(40),
  format: z.string().trim().min(2).max(40).default("post"),
  publishMode: z.string().trim().min(2).max(40).default("assisted"),
  status: z.string().trim().min(2).max(40).default("draft"),
  destinationUrl: z.string().trim().url().nullable().optional(),
  useLinkPreview: z.boolean().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  caption: z.string().trim().max(4000).nullable().optional(),
  assetUrls: z.array(z.string().trim().url()).max(12).default([]),
  thumbnailUrl: z.string().trim().url().nullable().optional(),
  externalPostUrl: z.string().trim().url().nullable().optional(),
  publishProofUrl: z.string().trim().url().nullable().optional(),
  aiPrompt: z.string().trim().max(4000).nullable().optional(),
  internalNotes: z.string().trim().max(4000).nullable().optional(),
  complianceNotes: z.string().trim().max(4000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/jobs");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const normalizedStatus = parsed.data.status.trim().toLowerCase();
  const normalizedPublishMode = parsed.data.publishMode.trim().toLowerCase();
  if (normalizedStatus !== "draft" && !parsed.data.briefId) {
    return NextResponse.json({ error: "campaign_id is required for queued, scheduled, and publish-ready jobs." }, { status: 400 });
  }
  if (normalizedPublishMode === "api" && !parsed.data.briefId) {
    return NextResponse.json({ error: "API publish jobs require a campaign before they can enter the queue." }, { status: 400 });
  }

  const job = await prisma.migraMarketContentJob.create({
    data: {
      orgId: access.context.activeOrg.orgId,
      briefId: parsed.data.briefId || null,
      connectionId: parsed.data.connectionId || null,
      captionId: parsed.data.captionId || null,
      selectedAssetId: parsed.data.selectedAssetId || null,
      title: parsed.data.title,
      platform: parsed.data.platform.trim().toLowerCase(),
      format: parsed.data.format.trim().toLowerCase(),
      publishMode: normalizedPublishMode,
      status: normalizedStatus,
      destinationUrl: parsed.data.destinationUrl || null,
      useLinkPreview: parsed.data.useLinkPreview ?? false,
      validationStatus: "unvalidated",
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      caption: parsed.data.caption || null,
      assetUrls: listToJson(normalizeStringList(parsed.data.assetUrls)),
      thumbnailUrl: parsed.data.thumbnailUrl || null,
      externalPostUrl: parsed.data.externalPostUrl || null,
      publishProofUrl: parsed.data.publishProofUrl || null,
      aiPrompt: parsed.data.aiPrompt || null,
      internalNotes: parsed.data.internalNotes || null,
      complianceNotes: parsed.data.complianceNotes || null,
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
    action: "MIGRAMARKET_CONTENT_JOB_CREATED",
    resourceType: "migramarket_content_job",
    resourceId: job.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ job: serializeContentJob(job) }, { status: 201 });
}
