import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeCreativeBrief } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  campaignKey: z.string().trim().min(3).max(120).regex(/^[a-z0-9_]+$/).nullable().optional(),
  brand: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().min(2).max(80).optional(),
  product: z.string().trim().max(160).nullable().optional(),
  audience: z.string().trim().max(240).nullable().optional(),
  objective: z.string().trim().min(2).max(60).optional(),
  offer: z.string().trim().max(240).nullable().optional(),
  headline: z.string().trim().max(160).nullable().optional(),
  subheadline: z.string().trim().max(240).nullable().optional(),
  price: z.string().trim().max(40).nullable().optional(),
  cta: z.string().trim().max(240).nullable().optional(),
  landingPage: z.string().trim().url().max(240).nullable().optional(),
  channels: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  visualFamily: z.string().trim().max(120).nullable().optional(),
  visualStyle: z.string().trim().max(240).nullable().optional(),
  approvedTemplateKeys: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  disallowedAssetTags: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  requireOgMatch: z.boolean().optional(),
  active: z.boolean().optional(),
  diversityNotes: z.string().trim().max(2000).nullable().optional(),
  brandSignature: z.string().trim().max(120).nullable().optional(),
  promptNotes: z.string().trim().max(4000).nullable().optional(),
  status: z.string().trim().min(2).max(60).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/briefs/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketCreativeBrief.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Brief not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const brief = await prisma.migraMarketCreativeBrief.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.campaignKey !== undefined ? { campaignKey: parsed.data.campaignKey || null } : {}),
      ...(parsed.data.brand !== undefined ? { brand: parsed.data.brand } : {}),
      ...(parsed.data.category !== undefined ? { category: parsed.data.category.trim().toLowerCase() } : {}),
      ...(parsed.data.product !== undefined ? { product: parsed.data.product || null } : {}),
      ...(parsed.data.audience !== undefined ? { audience: parsed.data.audience || null } : {}),
      ...(parsed.data.objective !== undefined ? { objective: parsed.data.objective.trim().toLowerCase() } : {}),
      ...(parsed.data.offer !== undefined ? { offer: parsed.data.offer || null } : {}),
      ...(parsed.data.headline !== undefined ? { headline: parsed.data.headline || null } : {}),
      ...(parsed.data.subheadline !== undefined ? { subheadline: parsed.data.subheadline || null } : {}),
      ...(parsed.data.price !== undefined ? { price: parsed.data.price || null } : {}),
      ...(parsed.data.cta !== undefined ? { cta: parsed.data.cta || null } : {}),
      ...(parsed.data.landingPage !== undefined ? { landingPage: parsed.data.landingPage || null } : {}),
      ...(parsed.data.channels !== undefined ? { channels: listToJson(normalizeStringList(parsed.data.channels)) } : {}),
      ...(parsed.data.visualFamily !== undefined ? { visualFamily: parsed.data.visualFamily || null } : {}),
      ...(parsed.data.visualStyle !== undefined ? { visualStyle: parsed.data.visualStyle || null } : {}),
      ...(parsed.data.approvedTemplateKeys !== undefined
        ? { approvedTemplateKeys: listToJson(normalizeStringList(parsed.data.approvedTemplateKeys)) }
        : {}),
      ...(parsed.data.disallowedAssetTags !== undefined
        ? { disallowedAssetTags: listToJson(normalizeStringList(parsed.data.disallowedAssetTags)) }
        : {}),
      ...(parsed.data.requireOgMatch !== undefined ? { requireOgMatch: parsed.data.requireOgMatch } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      ...(parsed.data.diversityNotes !== undefined ? { diversityNotes: parsed.data.diversityNotes || null } : {}),
      ...(parsed.data.brandSignature !== undefined ? { brandSignature: parsed.data.brandSignature || null } : {}),
      ...(parsed.data.promptNotes !== undefined ? { promptNotes: parsed.data.promptNotes || null } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status.trim().toLowerCase() } : {}),
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CREATIVE_BRIEF_UPDATED",
    resourceType: "migramarket_creative_brief",
    resourceId: brief.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ brief: serializeCreativeBrief(brief) });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/briefs/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketCreativeBrief.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Brief not found." }, { status: 404 });
  }

  await prisma.migraMarketCreativeBrief.delete({ where: { id } });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CREATIVE_BRIEF_DELETED",
    resourceType: "migramarket_creative_brief",
    resourceId: id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ ok: true });
}
