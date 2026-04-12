import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can } from "@/lib/rbac";
import { getActiveOrgContext } from "@/lib/auth/session";
import { acknowledgeAlert, resolveAlert, silenceAlert } from "@/lib/alerts";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "ops:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { alertId } = await params;
  const body = await request.json();

  let alert;
  switch (body.action) {
    case "acknowledge":
      alert = await acknowledgeAlert(alertId, auth.session.user.id);
      break;
    case "resolve":
      alert = await resolveAlert(alertId, auth.session.user.id);
      break;
    case "silence":
      alert = await silenceAlert(alertId);
      break;
    default:
      return NextResponse.json({ error: "Invalid action. Use: acknowledge, resolve, silence" }, { status: 400 });
  }

  await writeAuditLog({
    actorId: auth.session.user.id,
    orgId: ctx.orgId,
    action: `ALERT_${body.action.toUpperCase()}`,
    entityType: "Alert",
    entityId: alertId,
  });

  return NextResponse.json({ alert });
}
