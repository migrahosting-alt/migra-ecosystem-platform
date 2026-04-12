import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeContentTemplate } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  templateKey: z.string().trim().min(3).max(120).regex(/^[a-z0-9_]+$/).nullable().optional(),
  platform: z.string().trim().min(1).max(40).optional(),
  format: z.string().trim().min(2).max(40).optional(),
  cadence: z.string().trim().min(2).max(40).optional(),
  publishMode: z.string().trim().min(2).max(40).optional(),
  titleTemplate: z.string().trim().min(2).max(240).optional(),
  captionTemplate: z.string().trim().max(4000).nullable().optional(),
  aiPromptTemplate: z.string().trim().max(4000).nullable().optional(),
  cta: z.string().trim().max(240).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  styleFamily: z.string().trim().max(120).nullable().optional(),
  logoRequired: z.boolean().optional(),
  ctaRequired: z.boolean().optional(),
  maxHeadlineChars: z.number().int().positive().max(160).optional(),
  maxSubheadlineChars: z.number().int().positive().max(240).optional(),
  maxBullets: z.number().int().positive().max(8).optional(),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  diversityChecklist: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  status: z.string().trim().min(2).max(40).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/templates/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketContentTemplate.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const template = await prisma.migraMarketContentTemplate.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.templateKey !== undefined ? { templateKey: parsed.data.templateKey || null } : {}),
      ...(parsed.data.platform !== undefined ? { platform: parsed.data.platform.trim().toLowerCase() } : {}),
      ...(parsed.data.format !== undefined ? { format: parsed.data.format.trim().toLowerCase() } : {}),
      ...(parsed.data.cadence !== undefined ? { cadence: parsed.data.cadence.trim().toLowerCase() } : {}),
      ...(parsed.data.publishMode !== undefined ? { publishMode: parsed.data.publishMode.trim().toLowerCase() } : {}),
      ...(parsed.data.titleTemplate !== undefined ? { titleTemplate: parsed.data.titleTemplate } : {}),
      ...(parsed.data.captionTemplate !== undefined ? { captionTemplate: parsed.data.captionTemplate || null } : {}),
      ...(parsed.data.aiPromptTemplate !== undefined ? { aiPromptTemplate: parsed.data.aiPromptTemplate || null } : {}),
      ...(parsed.data.cta !== undefined ? { cta: parsed.data.cta || null } : {}),
      ...(parsed.data.width !== undefined ? { width: parsed.data.width || null } : {}),
      ...(parsed.data.height !== undefined ? { height: parsed.data.height || null } : {}),
      ...(parsed.data.styleFamily !== undefined ? { styleFamily: parsed.data.styleFamily || null } : {}),
      ...(parsed.data.logoRequired !== undefined ? { logoRequired: parsed.data.logoRequired } : {}),
      ...(parsed.data.ctaRequired !== undefined ? { ctaRequired: parsed.data.ctaRequired } : {}),
      ...(parsed.data.maxHeadlineChars !== undefined ? { maxHeadlineChars: parsed.data.maxHeadlineChars } : {}),
      ...(parsed.data.maxSubheadlineChars !== undefined ? { maxSubheadlineChars: parsed.data.maxSubheadlineChars } : {}),
      ...(parsed.data.maxBullets !== undefined ? { maxBullets: parsed.data.maxBullets } : {}),
      ...(parsed.data.hashtags !== undefined ? { hashtags: listToJson(normalizeStringList(parsed.data.hashtags)) } : {}),
      ...(parsed.data.diversityChecklist !== undefined
        ? { diversityChecklist: listToJson(normalizeStringList(parsed.data.diversityChecklist)) }
        : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status.trim().toLowerCase() } : {}),
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CONTENT_TEMPLATE_UPDATED",
    resourceType: "migramarket_content_template",
    resourceId: template.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ template: serializeContentTemplate(template) });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/templates/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketContentTemplate.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  await prisma.migraMarketContentTemplate.delete({ where: { id } });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CONTENT_TEMPLATE_DELETED",
    resourceType: "migramarket_content_template",
    resourceId: id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ ok: true });
}
