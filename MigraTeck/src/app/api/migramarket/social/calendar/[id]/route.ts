import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { serializeCalendarSlot } from "@/lib/migramarket-social";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  templateId: z.string().cuid().nullable().optional(),
  connectionId: z.string().cuid().nullable().optional(),
  title: z.string().trim().min(2).max(160).optional(),
  platform: z.string().trim().min(1).max(40).optional(),
  format: z.string().trim().min(2).max(40).optional(),
  publishMode: z.string().trim().min(2).max(40).optional(),
  weekday: z.number().int().min(1).max(7).optional(),
  slotTime: z.string().trim().max(20).nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  status: z.string().trim().min(2).max(40).optional(),
  theme: z.string().trim().max(240).nullable().optional(),
  cta: z.string().trim().max(240).nullable().optional(),
  aiPrompt: z.string().trim().max(4000).nullable().optional(),
  assetChecklist: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/calendar/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketContentCalendarSlot.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Calendar slot not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const slot = await prisma.migraMarketContentCalendarSlot.update({
    where: { id },
    data: {
      ...(parsed.data.templateId !== undefined ? { templateId: parsed.data.templateId || null } : {}),
      ...(parsed.data.connectionId !== undefined ? { connectionId: parsed.data.connectionId || null } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.platform !== undefined ? { platform: parsed.data.platform.trim().toLowerCase() } : {}),
      ...(parsed.data.format !== undefined ? { format: parsed.data.format.trim().toLowerCase() } : {}),
      ...(parsed.data.publishMode !== undefined ? { publishMode: parsed.data.publishMode.trim().toLowerCase() } : {}),
      ...(parsed.data.weekday !== undefined ? { weekday: parsed.data.weekday } : {}),
      ...(parsed.data.slotTime !== undefined ? { slotTime: parsed.data.slotTime || null } : {}),
      ...(parsed.data.scheduledFor !== undefined ? { scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status.trim().toLowerCase() } : {}),
      ...(parsed.data.theme !== undefined ? { theme: parsed.data.theme || null } : {}),
      ...(parsed.data.cta !== undefined ? { cta: parsed.data.cta || null } : {}),
      ...(parsed.data.aiPrompt !== undefined ? { aiPrompt: parsed.data.aiPrompt || null } : {}),
      ...(parsed.data.assetChecklist !== undefined
        ? { assetChecklist: listToJson(normalizeStringList(parsed.data.assetChecklist)) }
        : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
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
    action: "MIGRAMARKET_CALENDAR_SLOT_UPDATED",
    resourceType: "migramarket_calendar_slot",
    resourceId: slot.id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ slot: serializeCalendarSlot(slot) });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/calendar/[id]");
  if (!access.ok) return access.response;
  const { id } = await params;

  const existing = await prisma.migraMarketContentCalendarSlot.findFirst({
    where: { id, orgId: access.context.activeOrg.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Calendar slot not found." }, { status: 404 });
  }

  await prisma.migraMarketContentCalendarSlot.delete({ where: { id } });

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_CALENDAR_SLOT_DELETED",
    resourceType: "migramarket_calendar_slot",
    resourceId: id,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
  });

  return NextResponse.json({ ok: true });
}
