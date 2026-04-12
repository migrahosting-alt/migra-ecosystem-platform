import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeContentTemplate } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  templateKey: z.string().trim().min(3).max(120).regex(/^[a-z0-9_]+$/).nullable().optional(),
  platform: z.string().trim().min(1).max(40),
  format: z.string().trim().min(2).max(40).default("post"),
  cadence: z.string().trim().min(2).max(40).default("weekly"),
  publishMode: z.string().trim().min(2).max(40).default("assisted"),
  titleTemplate: z.string().trim().min(2).max(240),
  captionTemplate: z.string().trim().max(4000).nullable().optional(),
  aiPromptTemplate: z.string().trim().max(4000).nullable().optional(),
  cta: z.string().trim().max(240).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  styleFamily: z.string().trim().max(120).nullable().optional(),
  logoRequired: z.boolean().default(true),
  ctaRequired: z.boolean().default(true),
  maxHeadlineChars: z.number().int().positive().max(160).default(40),
  maxSubheadlineChars: z.number().int().positive().max(240).default(80),
  maxBullets: z.number().int().positive().max(8).default(4),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  diversityChecklist: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  status: z.string().trim().min(2).max(40).default("active"),
});

export async function POST(request: NextRequest) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/templates");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const template = await prisma.migraMarketContentTemplate.create({
    data: {
      orgId: access.context.activeOrg.orgId,
      name: parsed.data.name,
      templateKey: parsed.data.templateKey || null,
      platform: parsed.data.platform.trim().toLowerCase(),
      format: parsed.data.format.trim().toLowerCase(),
      cadence: parsed.data.cadence.trim().toLowerCase(),
      publishMode: parsed.data.publishMode.trim().toLowerCase(),
      titleTemplate: parsed.data.titleTemplate,
      captionTemplate: parsed.data.captionTemplate || null,
      aiPromptTemplate: parsed.data.aiPromptTemplate || null,
      cta: parsed.data.cta || null,
      width: parsed.data.width || null,
      height: parsed.data.height || null,
      styleFamily: parsed.data.styleFamily || null,
      logoRequired: parsed.data.logoRequired,
      ctaRequired: parsed.data.ctaRequired,
      maxHeadlineChars: parsed.data.maxHeadlineChars,
      maxSubheadlineChars: parsed.data.maxSubheadlineChars,
      maxBullets: parsed.data.maxBullets,
      hashtags: listToJson(normalizeStringList(parsed.data.hashtags)),
      diversityChecklist: listToJson(normalizeStringList(parsed.data.diversityChecklist)),
      status: parsed.data.status.trim().toLowerCase(),
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CONTENT_TEMPLATE_CREATED",
    resourceType: "migramarket_content_template",
    resourceId: template.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ template: serializeContentTemplate(template) }, { status: 201 });
}
