import { MembershipStatus, OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";

export interface OrgContext {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: OrgRole;
  membershipId: string;
  ip: string;
  userAgent: string;
}

interface RequireOrgContextOptions {
  /** Minimum roles allowed (defaults to all roles) */
  minRole?: OrgRole[];
  /** Action name for audit logging on denied access */
  auditAction?: string;
  /** Route identifier for audit metadata */
  route?: string;
}

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  BILLING: 3,
  MEMBER: 2,
  READONLY: 1,
};

/**
 * Require an authenticated session with active org membership.
 * Extracts orgId from route params or Active-Org header/cookie.
 */
export async function requireOrgContext(
  request: NextRequest,
  orgIdOrParams: string | { params: Promise<{ orgId: string }> },
  options: RequireOrgContextOptions = {},
): Promise<{ ok: true; ctx: OrgContext } | { ok: false; response: NextResponse }> {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult;
  }

  const userId = authResult.session.user.id;
  const email = authResult.session.user.email ?? "";
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const orgId =
    typeof orgIdOrParams === "string"
      ? orgIdOrParams
      : (await orgIdOrParams.params).orgId;

  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Organization ID is required." }, { status: 400 }),
    };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!membership) {
    await writeAuditLog({
      userId,
      orgId,
      action: options.auditAction || "AUTHZ_ORG_ACCESS_DENIED",
      entityType: "organization",
      entityId: orgId,
      ip,
      userAgent,
      metadata: {
        route: options.route || request.nextUrl.pathname,
        reason: "no_active_membership",
      },
    });

    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  if (options.minRole && options.minRole.length > 0) {
    const minLevel = Math.min(...options.minRole.map((r) => ROLE_HIERARCHY[r]));
    const userLevel = ROLE_HIERARCHY[membership.role];

    if (userLevel < minLevel) {
      await writeAuditLog({
        userId,
        orgId,
        action: "AUTHZ_PERMISSION_DENIED",
        entityType: "organization",
        entityId: orgId,
        ip,
        userAgent,
        metadata: {
          route: options.route || request.nextUrl.pathname,
          reason: "insufficient_role",
          required: options.minRole.join(","),
          actual: membership.role,
        },
      });

      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
  }

  return {
    ok: true,
    ctx: {
      userId,
      email,
      orgId: membership.org.id,
      orgName: membership.org.name,
      orgSlug: membership.org.slug,
      role: membership.role,
      membershipId: membership.id,
      ip,
      userAgent,
    },
  };
}
