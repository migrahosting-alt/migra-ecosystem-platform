import { MembershipStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";

const schema = z.object({
  orgId: z.string().min(10),
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
  const { session } = authResult;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      orgId: parsed.data.orgId,
      status: MembershipStatus.ACTIVE,
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  try {
    await assertMutationSecurity({
      action: "org:switch",
      actorUserId: session.user.id,
      actorRole: membership.role,
      orgId: parsed.data.orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/orgs/switch",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const responsePayload = NextResponse.json({ message: "Organization switched." });
  responsePayload.cookies.set(ACTIVE_ORG_COOKIE, parsed.data.orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  await writeAuditLog({
    userId: session.user.id,
    orgId: parsed.data.orgId,
    action: "ORG_SWITCHED",
    entityType: "organization",
    entityId: parsed.data.orgId,
    ip,
    userAgent,
  });

  return responsePayload;
}
