import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getDriveTenantAccess } from "@/lib/drive/drive-tenant-access";
import { mapTenantForBootstrap } from "@/lib/drive/drive-tenant-mapper";
import { getDriveRecentEvents } from "@/lib/drive/drive-recent-events";
import { getDriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import { recordDriveBootstrapLatency } from "@/lib/drive/drive-tenant-metrics";

export async function GET() {
  const startedAt = Date.now();
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ ok: false, error: "organization_context_missing" }, { status: 404 });
  }

  const access = await getDriveTenantAccess(activeOrg.orgId);
  recordDriveBootstrapLatency(Date.now() - startedAt, {
    orgId: activeOrg.orgId,
    result: access.ok ? "ok" : "denied",
  });

  if (!access.ok) {
    return access.response;
  }

  const [tenantSummary, recentEvents] = await Promise.all([
    getDriveTenantSummary(activeOrg.orgId, access.tenant),
    getDriveRecentEvents(activeOrg.orgId),
  ]);

  return NextResponse.json({
    ok: true,
    data: mapTenantForBootstrap(access.tenant, tenantSummary, recentEvents),
  });
}