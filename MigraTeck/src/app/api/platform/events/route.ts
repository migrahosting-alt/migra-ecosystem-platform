import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can } from "@/lib/rbac";
import { getActiveOrgContext } from "@/lib/auth/session";
import { queryPlatformEvents } from "@/lib/platform-events";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "ops:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const eventType = url.searchParams.get("eventType");
  const source = url.searchParams.get("source");
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const limit = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");

  const result = await queryPlatformEvents({
    orgId: ctx.orgId,
    ...(eventType ? { eventType } : {}),
    ...(source ? { source } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(since ? { since: new Date(since) } : {}),
    ...(until ? { until: new Date(until) } : {}),
    ...(limit ? { limit: parseInt(limit, 10) } : {}),
    ...(cursor ? { cursor } : {}),
  });

  return NextResponse.json(result);
}
