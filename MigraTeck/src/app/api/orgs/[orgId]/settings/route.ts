import { MembershipStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";

const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    isMigraHostingClient: z.boolean().optional(),
  })
  .refine((payload) => payload.name !== undefined || payload.isMigraHostingClient !== undefined, {
    message: "No fields provided.",
  });

export async function GET(_request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { orgId } = await context.params;
  const membership = await prisma.membership.findFirst({
    where: {
      userId: authResult.session.user.id,
      orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: true,
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    org: {
      id: membership.org.id,
      name: membership.org.name,
      slug: membership.org.slug,
      isMigraHostingClient: membership.org.isMigraHostingClient,
    },
    role: membership.role,
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { orgId } = await context.params;
  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const membership = await prisma.membership.findFirst({
    where: {
      userId: actorUserId,
      orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: true,
    },
  });

  if (!membership) {
    await writeAuditLog({
      userId: actorUserId,
      orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "org:manage",
      ip,
      userAgent,
      metadata: {
        route: "/api/orgs/[orgId]/settings",
        reason: "missing_membership",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId,
    role: membership.role,
    action: "org:manage",
    route: "/api/orgs/[orgId]/settings",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertMutationSecurity({
      action: "org:settings:update",
      actorUserId,
      actorRole: membership.role,
      orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/orgs/[orgId]/settings",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updatedOrg = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.isMigraHostingClient !== undefined
        ? { isMigraHostingClient: parsed.data.isMigraHostingClient }
        : {}),
    },
  });

  await writeAuditLog({
    userId: actorUserId,
    orgId,
    action: "ORG_SETTINGS_UPDATED",
    entityType: "organization",
    entityId: orgId,
    ip,
    userAgent,
    metadata: {
      fields: {
        ...(parsed.data.name !== undefined ? { name: true } : {}),
        ...(parsed.data.isMigraHostingClient !== undefined ? { isMigraHostingClient: true } : {}),
      },
    },
  });

  return NextResponse.json({
    org: {
      id: updatedOrg.id,
      name: updatedOrg.name,
      slug: updatedOrg.slug,
      isMigraHostingClient: updatedOrg.isMigraHostingClient,
    },
  });
}
