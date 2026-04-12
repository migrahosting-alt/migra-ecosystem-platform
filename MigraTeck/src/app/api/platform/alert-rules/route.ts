import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can } from "@/lib/rbac";
import { getActiveOrgContext } from "@/lib/auth/session";
import { listAlertRules, createAlertRule } from "@/lib/alerts";
import { writeAuditLog } from "@/lib/audit";
import { Prisma } from "@prisma/client";

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rules = await listAlertRules();
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.name || !body.eventType || !body.notifyChannels) {
    return NextResponse.json({ error: "name, eventType, and notifyChannels are required" }, { status: 400 });
  }

  const rule = await createAlertRule({
    name: body.name,
    description: body.description,
    eventType: body.eventType,
    condition: (body.condition ?? {}) as Prisma.InputJsonValue,
    severity: body.severity,
    cooldownMinutes: body.cooldownMinutes,
    notifyChannels: body.notifyChannels,
    notifyRoleMin: body.notifyRoleMin,
  });

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: "ALERT_RULE_CREATE",
    entityType: "AlertRule",
    entityId: rule.id,
  });

  return NextResponse.json({ rule }, { status: 201 });
}
