import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can } from "@/lib/rbac";
import { getActiveOrgContext } from "@/lib/auth/session";
import { updateAlertRule, deleteAlertRule } from "@/lib/alerts";
import { writeAuditLog } from "@/lib/audit";
import { Prisma } from "@prisma/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ruleId } = await params;
  const body = await request.json();

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.eventType !== undefined) updateData.eventType = body.eventType;
  if (body.condition !== undefined) updateData.condition = body.condition as Prisma.InputJsonValue;
  if (body.severity !== undefined) updateData.severity = body.severity;
  if (body.cooldownMinutes !== undefined) updateData.cooldownMinutes = body.cooldownMinutes;
  if (body.notifyChannels !== undefined) updateData.notifyChannels = body.notifyChannels;
  if (body.notifyRoleMin !== undefined) updateData.notifyRoleMin = body.notifyRoleMin;
  if (body.status !== undefined) updateData.status = body.status;

  const rule = await updateAlertRule(ruleId, updateData as Parameters<typeof updateAlertRule>[1]);

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "ALERT_RULE_UPDATE",
    entityType: "AlertRule",
    entityId: ruleId,
  });

  return NextResponse.json({ rule });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { ruleId } = await params;
  await deleteAlertRule(ruleId);

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "ALERT_RULE_DELETE",
    entityType: "AlertRule",
    entityId: ruleId,
  });

  return NextResponse.json({ ok: true });
}
