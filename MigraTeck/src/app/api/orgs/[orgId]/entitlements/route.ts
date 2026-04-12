import { EntitlementStatus, MembershipStatus, ProductKey, ProvisioningJobSource } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { isInternalOrg } from "@/lib/security/internal-org";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { MutationIntentError } from "@/lib/security/intent";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { queueProvisioningForEntitlementTransition } from "@/lib/provisioning/queue";

const updateRowSchema = z.object({
  product: z.nativeEnum(ProductKey),
  status: z.nativeEnum(EntitlementStatus),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updatePayloadSchema = z.union([updateRowSchema, z.array(updateRowSchema).min(1).max(20)]);

function normalizeUpdates(payload: z.infer<typeof updatePayloadSchema>): z.infer<typeof updateRowSchema>[] {
  return Array.isArray(payload) ? payload : [payload];
}

export async function GET(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
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
      org: {
        select: {
          id: true,
          name: true,
          isMigraHostingClient: true,
        },
      },
    },
  });

  if (!membership) {
    await writeAuditLog({
      userId: actorUserId,
      orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "org:entitlement:view",
      ip,
      userAgent,
      metadata: {
        route: "/api/orgs/[orgId]/entitlements",
        reason: "missing_membership",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId,
    role: membership.role,
    action: "org:entitlement:view",
    route: "/api/orgs/[orgId]/entitlements",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.orgEntitlement.findMany({
    where: { orgId },
    orderBy: { product: "asc" },
  });

  const byProduct = new Map(rows.map((row) => [row.product, row]));
  const entitlements = Object.values(ProductKey).map((product) => {
    const existing = byProduct.get(product);
    return {
      product,
      status: existing?.status || EntitlementStatus.RESTRICTED,
      startsAt: existing?.startsAt,
      endsAt: existing?.endsAt,
      notes: existing?.notes || null,
      updatedAt: existing?.updatedAt || null,
    };
  });

  return NextResponse.json({
    org: {
      id: membership.org.id,
      name: membership.org.name,
      isMigraHostingClient: membership.org.isMigraHostingClient,
    },
    role: membership.role,
    canEdit: can(membership.role, "org:entitlement:edit"),
    entitlements,
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const { orgId } = await context.params;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const membership = await prisma.membership.findFirst({
    where: {
      userId: actorUserId,
      orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: {
        select: {
          id: true,
          slug: true,
        },
      },
    },
  });

  if (!membership) {
    await writeAuditLog({
      userId: actorUserId,
      orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "org:entitlement:edit",
      ip,
      userAgent,
      metadata: {
        route: "/api/orgs/[orgId]/entitlements",
        reason: "missing_membership",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId,
    role: membership.role,
    action: "org:entitlement:edit",
    route: "/api/orgs/[orgId]/entitlements",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${orgId}:${ip}`,
    action: "org:entitlement:update",
    maxAttempts: 60,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const intentId = typeof body?.intentId === "string" ? body.intentId : undefined;
  const updatePayload = body && typeof body === "object" && "updates" in body ? body.updates : body;
  const parsed = updatePayloadSchema.safeParse(updatePayload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updates = normalizeUpdates(parsed.data);

  if (updates.some((item) => item.status === EntitlementStatus.INTERNAL_ONLY) && !isInternalOrg(membership.org)) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: membership.role,
      orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      resourceType: "org_entitlement",
      resourceId: "INTERNAL_ONLY",
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        route: "/api/orgs/[orgId]/entitlements",
        reason: "internal_only_forbidden",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertMutationSecurity({
      action: "org:entitlement:update",
      actorUserId,
      actorRole: membership.role,
      orgId,
      riskTier: 2,
      ip,
      userAgent,
      route: "/api/orgs/[orgId]/entitlements",
      intentId,
      payload: updates,
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError || error instanceof MutationIntentError) {
      return NextResponse.json({ error: "Forbidden" }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const previousRows = await prisma.orgEntitlement.findMany({
    where: {
      orgId,
      product: {
        in: updates.map((item) => item.product),
      },
    },
  });
  const previousByProduct = new Map(previousRows.map((row) => [row.product, row]));

  const persisted = await prisma.$transaction(async (tx) => {
    const results = [];

    for (const update of updates) {
      const updateData = {
        status: update.status,
        ...(update.startsAt !== undefined ? { startsAt: update.startsAt ? new Date(update.startsAt) : null } : {}),
        ...(update.endsAt !== undefined ? { endsAt: update.endsAt ? new Date(update.endsAt) : null } : {}),
        ...(update.notes !== undefined ? { notes: update.notes } : {}),
      };
      const row = await tx.orgEntitlement.upsert({
        where: {
          orgId_product: {
            orgId,
            product: update.product,
          },
        },
        update: updateData,
        create: {
          orgId,
          product: update.product,
          status: update.status,
          startsAt: update.startsAt ? new Date(update.startsAt) : null,
          endsAt: update.endsAt ? new Date(update.endsAt) : null,
          notes: update.notes || null,
        },
      });

      results.push(row);
    }

    return results;
  });

  for (const row of persisted) {
    const previous = previousByProduct.get(row.product);
    await writeAuditLog({
      userId: actorUserId,
      orgId,
      action: "ORG_ENTITLEMENT_UPDATED",
      entityType: "org_entitlement",
      entityId: row.product,
      ip,
      userAgent,
      metadata: {
        product: row.product,
        old: previous
          ? {
              status: previous.status,
              startsAt: previous.startsAt,
              endsAt: previous.endsAt,
              notes: previous.notes,
            }
          : null,
        new: {
          status: row.status,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          notes: row.notes,
        },
      },
    });

    if (previous?.status !== row.status) {
      await queueProvisioningForEntitlementTransition({
        orgId,
        orgSlug: membership.org.slug,
        product: row.product,
        previousStatus: previous?.status || null,
        newStatus: row.status,
        source: ProvisioningJobSource.MANUAL,
        transitionId: `manual:${actorUserId}:${row.product}:${row.updatedAt.toISOString()}`,
        createdByUserId: actorUserId,
        actorRole: membership.role,
        ip,
        userAgent,
      });
    }
  }

  return NextResponse.json({
    entitlements: persisted.map((row) => ({
      product: row.product,
      status: row.status,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      notes: row.notes,
      updatedAt: row.updatedAt,
    })),
  });
}
