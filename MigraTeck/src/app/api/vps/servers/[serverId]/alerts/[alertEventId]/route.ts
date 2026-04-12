import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { getVpsCapabilities } from "@/lib/vps/access";
import { applyVpsAlertEventAction, listVpsAlertEvents } from "@/lib/vps/alerts";
import { resolveActorRole } from "@/lib/vps/authz";

const alertActionSchema = z.object({
  action: z.enum(["acknowledge", "resolve", "suppress"]),
  suppressMinutes: z.number().int().min(5).max(24 * 60).optional(),
});

export const PATCH = safeApiHandler(async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ serverId: string; alertEventId: string }> },
) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) {
    return NextResponse.json({ error: "No active organization context." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { serverId, alertEventId } = await context.params;
  const resolvedRole = await resolveActorRole({
    userId: authResult.session.user.id,
    orgId: membership.orgId,
    role: membership.role,
  }, serverId);

  if (!getVpsCapabilities(resolvedRole.role).canOpenSupport) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null);
  const parsed = alertActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid alert action.", details: parsed.error.flatten() }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const updated = await applyVpsAlertEventAction({
    orgId: membership.orgId,
    serverId,
    alertEventId,
    actorUserId: authResult.session.user.id,
    action: parsed.data.action,
    suppressMinutes: parsed.data.suppressMinutes,
  });

  if (!updated) {
    return NextResponse.json({ error: "VPS alert not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const alerts = await listVpsAlertEvents(serverId, membership.orgId, { includeResolved: true });
  return NextResponse.json({ items: alerts }, { headers: { "Cache-Control": "no-store" } });
});