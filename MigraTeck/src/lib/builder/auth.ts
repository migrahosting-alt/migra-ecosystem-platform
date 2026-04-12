/**
 * MigraBuilder — Auth + org permission helper for API routes.
 * Reuses the platform's existing auth/rbac/audit patterns.
 */
import { NextResponse } from "next/server";
import { MembershipStatus } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/api-auth";
import { can, type PermissionAction } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { getActiveOrgContext } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export interface BuilderAuthContext {
  userId: string;
  orgId: string;
  role: string;
  membership: { id: string; userId: string; orgId: string; role: string };
}

/**
 * Authenticate and authorize a builder API request.
 * Returns the auth context or an error response.
 */
export async function requireBuilderAuth(
  permission: PermissionAction = "builder:read",
): Promise<
  | { ok: true; auth: BuilderAuthContext }
  | { ok: false; response: NextResponse }
> {
  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult;

  const { session } = authResult;
  const userId = session.user.id;

  const membership = await getActiveOrgContext(userId);
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "no_org", message: "No active organization." } },
        { status: 403 },
      ),
    };
  }

  if (!can(membership.role, permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "forbidden", message: "Insufficient permissions." } },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    auth: {
      userId,
      orgId: membership.orgId,
      role: membership.role,
      membership: {
        id: membership.id,
        userId: membership.userId,
        orgId: membership.orgId,
        role: membership.role,
      },
    },
  };
}

/**
 * Verify that a site belongs to the caller's active org.
 */
export async function requireSiteAccess(siteId: string, orgId: string) {
  const site = await prisma.builderSite.findFirst({
    where: { id: siteId, orgId },
  });
  if (!site) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: { code: "not_found", message: "Site not found." } },
        { status: 404 },
      ),
    };
  }
  return { ok: true as const, site };
}

import { Prisma } from "@prisma/client";

/**
 * Write a builder audit event.
 */
export async function builderAudit(opts: {
  userId: string;
  orgId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}) {
  await writeAuditLog({
    actorId: opts.userId,
    orgId: opts.orgId,
    action: `BUILDER_${opts.action}`,
    entityType: opts.resourceType,
    entityId: opts.resourceId,
    ip: opts.ip,
    userAgent: opts.userAgent,
    metadata: opts.metadata as Prisma.InputJsonValue | undefined,
  });
}
