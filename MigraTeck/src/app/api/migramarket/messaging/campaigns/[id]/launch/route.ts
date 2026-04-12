import { ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { normalizeStringList } from "@/lib/migramarket";
import { dispatchMessagingCampaign } from "@/lib/migramarket-messaging";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult.response;
  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) return NextResponse.json({ error: "No active organization." }, { status: 404 });

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/messaging/campaigns/[id]/launch",
    ip,
    userAgent,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/messaging/campaigns/[id]/launch",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const { id } = await context.params;
  const campaign = await prisma.migraMarketMessagingCampaign.findFirst({
    where: { id, orgId: activeOrg.orgId },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  try {
    const result = await dispatchMessagingCampaign(id);
    await writeAuditLog({
      actorId: authResult.session.user.id,
      actorRole: activeOrg.role,
      orgId: activeOrg.orgId,
      action: "MIGRAMARKET_MESSAGING_CAMPAIGN_LAUNCHED",
      resourceType: "migramarket_messaging_campaign",
      resourceId: id,
      ip,
      userAgent,
      metadata: {
        createdCount: result.createdCount,
        processedCount: result.processedCount,
        queuedRemaining: result.queuedRemaining,
      },
    });

    return NextResponse.json({
      campaign: {
        ...result.campaign,
        mediaUrls: normalizeStringList(result.campaign.mediaUrls),
        scheduledAt: result.campaign.scheduledAt ? result.campaign.scheduledAt.toISOString() : null,
        launchedAt: result.campaign.launchedAt ? result.campaign.launchedAt.toISOString() : null,
        completedAt: result.campaign.completedAt ? result.campaign.completedAt.toISOString() : null,
        lastDispatchedAt: result.campaign.lastDispatchedAt ? result.campaign.lastDispatchedAt.toISOString() : null,
        createdAt: result.campaign.createdAt.toISOString(),
        updatedAt: result.campaign.updatedAt.toISOString(),
      },
      stats: {
        createdCount: result.createdCount,
        processedCount: result.processedCount,
        queuedRemaining: result.queuedRemaining,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campaign launch failed." },
      { status: 400 },
    );
  }
}
