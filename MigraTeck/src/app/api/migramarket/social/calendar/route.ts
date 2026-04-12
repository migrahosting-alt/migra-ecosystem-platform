import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeCalendarSlot } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  templateId: z.string().cuid().nullable().optional(),
  connectionId: z.string().cuid().nullable().optional(),
  title: z.string().trim().min(2).max(160),
  platform: z.string().trim().min(1).max(40),
  format: z.string().trim().min(2).max(40).default("post"),
  publishMode: z.string().trim().min(2).max(40).default("assisted"),
  weekday: z.number().int().min(1).max(7),
  slotTime: z.string().trim().max(20).nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  status: z.string().trim().min(2).max(40).default("planned"),
  theme: z.string().trim().max(240).nullable().optional(),
  cta: z.string().trim().max(240).nullable().optional(),
  aiPrompt: z.string().trim().max(4000).nullable().optional(),
  assetChecklist: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/calendar");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const slot = await prisma.migraMarketContentCalendarSlot.create({
    data: {
      orgId: access.context.activeOrg.orgId,
      templateId: parsed.data.templateId || null,
      connectionId: parsed.data.connectionId || null,
      title: parsed.data.title,
      platform: parsed.data.platform.trim().toLowerCase(),
      format: parsed.data.format.trim().toLowerCase(),
      publishMode: parsed.data.publishMode.trim().toLowerCase(),
      weekday: parsed.data.weekday,
      slotTime: parsed.data.slotTime || null,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      status: parsed.data.status.trim().toLowerCase(),
      theme: parsed.data.theme || null,
      cta: parsed.data.cta || null,
      aiPrompt: parsed.data.aiPrompt || null,
      assetChecklist: listToJson(normalizeStringList(parsed.data.assetChecklist)),
      notes: parsed.data.notes || null,
    },
    include: {
      template: true,
      connection: true,
    },
  });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CALENDAR_SLOT_CREATED",
    resourceType: "migramarket_calendar_slot",
    resourceId: slot.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ slot: serializeCalendarSlot(slot) }, { status: 201 });
}
