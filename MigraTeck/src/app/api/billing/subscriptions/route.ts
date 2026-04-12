import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const activeOrg = await getActiveOrgContext(actorUserId);

  if (!activeOrg) {
    return NextResponse.json({ subscriptions: [] });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "billing:manage",
    route: "/api/billing/subscriptions",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const subscriptions = await prisma.billingSubscription.findMany({
    where: {
      orgId: activeOrg.orgId,
    },
    orderBy: { createdAt: "desc" },
  });

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "BILLING_SUBSCRIPTIONS_VIEWED",
    resourceType: "billing_subscription",
    riskTier: 0,
    ip,
    userAgent,
    metadata: {
      count: subscriptions.length,
    },
  });

  return NextResponse.json({ subscriptions });
}
