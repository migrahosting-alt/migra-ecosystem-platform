import { NextRequest, NextResponse } from "next/server";
import { mapAuthPayload } from "@/lib/auth/auth-payload";
import { requireAccessToken, requireApiSession } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const accessAuth = await requireAccessToken(request);
  if (accessAuth.ok) {
    const driveTenant = await prisma.driveTenant.findUnique({
      where: { orgId: accessAuth.auth.orgId },
      select: { id: true, status: true, planCode: true, storageQuotaGb: true },
    });

    return NextResponse.json({
      ok: true,
      data: mapAuthPayload({
        user: accessAuth.membership.user,
        organization: accessAuth.membership.org,
        membership: { role: accessAuth.membership.role },
        tenant: driveTenant,
      }),
    });
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: authResult.session.user.id },
    include: { org: true, user: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membership not found" }, { status: 401 });
  }

  const driveTenant = await prisma.driveTenant.findUnique({
    where: { orgId: membership.orgId },
    select: { id: true, status: true, planCode: true, storageQuotaGb: true },
  });

  return NextResponse.json({
    ok: true,
    data: mapAuthPayload({
      user: membership.user,
      organization: membership.org,
      membership: { role: membership.role },
      tenant: driveTenant,
    }),
  });
}