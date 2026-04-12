import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can } from "@/lib/rbac";
import { getActiveOrgContext } from "@/lib/auth/session";
import { listAlerts, getActiveAlertCount } from "@/lib/alerts";
import { AlertSeverity, AlertStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "ops:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as AlertStatus | null;
  const severity = url.searchParams.get("severity") as AlertSeverity | null;
  const limit = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");

  const [result, activeCount] = await Promise.all([
    listAlerts({
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
      ...(limit ? { limit: parseInt(limit, 10) } : {}),
      ...(cursor ? { cursor } : {}),
    }),
    getActiveAlertCount(ctx.orgId),
  ]);

  return NextResponse.json({
    items: result.items,
    nextCursor: result.nextCursor,
    activeCount,
  });
}
