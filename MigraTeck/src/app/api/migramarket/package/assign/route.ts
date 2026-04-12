import { ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { applyPackageTemplateToOrg, getMigraMarketWorkspace, serializePackageTemplate } from "@/lib/migramarket";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

const assignSchema = z.object({
  packageTemplateId: z.string().cuid(),
});

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ error: "No active organization." }, { status: 404 });
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/package/assign",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/package/assign",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null);
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const template = await applyPackageTemplateToOrg(activeOrg.orgId, parsed.data.packageTemplateId);
  if (!template) {
    return NextResponse.json({ error: "Package template not found." }, { status: 404 });
  }

  const workspace = await getMigraMarketWorkspace(activeOrg.orgId);

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "MIGRAMARKET_PACKAGE_ASSIGNED",
    resourceType: "migramarket_package_template",
    resourceId: template.id,
    ip,
    userAgent,
    metadata: {
      packageCode: template.code,
      packageName: template.name,
    },
  });

  return NextResponse.json({
    assignedPackage: serializePackageTemplate(template),
    workspace: {
      account: workspace.account
        ? {
            ...workspace.account,
            primaryGoals: [],
            targetMarkets: [],
            socialProfiles: [],
            packageTemplateCode: workspace.account.packageTemplate?.code || null,
          }
        : null,
      tasks: workspace.tasks,
    },
  });
}
