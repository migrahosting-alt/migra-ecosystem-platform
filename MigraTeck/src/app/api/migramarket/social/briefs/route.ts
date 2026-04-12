import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeCreativeBrief } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  campaignKey: z.string().trim().min(3).max(120).regex(/^[a-z0-9_]+$/).nullable().optional(),
  brand: z.string().trim().min(2).max(120).default("MigraHosting"),
  category: z.string().trim().min(2).max(80).default("brand"),
  product: z.string().trim().max(160).nullable().optional(),
  audience: z.string().trim().max(240).nullable().optional(),
  objective: z.string().trim().min(2).max(60).default("awareness"),
  offer: z.string().trim().max(240).nullable().optional(),
  headline: z.string().trim().max(160).nullable().optional(),
  subheadline: z.string().trim().max(240).nullable().optional(),
  price: z.string().trim().max(40).nullable().optional(),
  cta: z.string().trim().max(240).nullable().optional(),
  landingPage: z.string().trim().url().max(240).nullable().optional(),
  channels: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  visualFamily: z.string().trim().max(120).nullable().optional(),
  visualStyle: z.string().trim().max(240).nullable().optional(),
  approvedTemplateKeys: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  disallowedAssetTags: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  requireOgMatch: z.boolean().default(true),
  active: z.boolean().default(true),
  diversityNotes: z.string().trim().max(2000).nullable().optional(),
  brandSignature: z.string().trim().max(120).nullable().optional(),
  promptNotes: z.string().trim().max(4000).nullable().optional(),
  status: z.string().trim().min(2).max(60).default("draft"),
});

export async function POST(request: NextRequest) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/briefs");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const brief = await prisma.migraMarketCreativeBrief.create({
    data: {
      orgId: access.context.activeOrg.orgId,
      name: parsed.data.name,
      campaignKey: parsed.data.campaignKey || null,
      brand: parsed.data.brand,
      category: parsed.data.category.trim().toLowerCase(),
      product: parsed.data.product || null,
      audience: parsed.data.audience || null,
      objective: parsed.data.objective.trim().toLowerCase(),
      offer: parsed.data.offer || null,
      headline: parsed.data.headline || null,
      subheadline: parsed.data.subheadline || null,
      price: parsed.data.price || null,
      cta: parsed.data.cta || null,
      landingPage: parsed.data.landingPage || null,
      channels: listToJson(normalizeStringList(parsed.data.channels)),
      visualFamily: parsed.data.visualFamily || null,
      visualStyle: parsed.data.visualStyle || null,
      approvedTemplateKeys: listToJson(normalizeStringList(parsed.data.approvedTemplateKeys)),
      disallowedAssetTags: listToJson(normalizeStringList(parsed.data.disallowedAssetTags)),
      requireOgMatch: parsed.data.requireOgMatch,
      active: parsed.data.active,
      diversityNotes: parsed.data.diversityNotes || null,
      brandSignature: parsed.data.brandSignature || null,
      promptNotes: parsed.data.promptNotes || null,
      status: parsed.data.status.trim().toLowerCase(),
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CREATIVE_BRIEF_CREATED",
    resourceType: "migramarket_creative_brief",
    resourceId: brief.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ brief: serializeCreativeBrief(brief) }, { status: 201 });
}
