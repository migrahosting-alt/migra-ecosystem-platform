import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }
  const { session } = authResult;

  const activeOrg = await getActiveOrgContext(session.user.id);

  if (!activeOrg) {
    return NextResponse.json({ events: [] });
  }

  const allowed = await assertPermission({
    actorUserId: session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "audit:read",
    route: "/api/audit",
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await prisma.auditLog.findMany({
    where: {
      orgId: activeOrg.orgId,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ events });
}
