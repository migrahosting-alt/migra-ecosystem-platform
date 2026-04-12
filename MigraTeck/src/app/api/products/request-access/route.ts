import { EntitlementStatus, MembershipStatus, ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { accessRequestNotificationsEnabled, env } from "@/lib/env";
import { isSmtpConfigured, sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { isInternalOrg } from "@/lib/security/internal-org";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";

const createSchema = z.object({
  orgId: z.string().min(10).optional(),
  product: z.nativeEnum(ProductKey),
  message: z.string().max(4000).optional(),
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

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "product:request-access",
    maxAttempts: 30,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  let membership = null;

  if (parsed.data.orgId) {
    membership = await prisma.membership.findFirst({
      where: {
        userId: actorUserId,
        orgId: parsed.data.orgId,
        status: MembershipStatus.ACTIVE,
      },
      include: {
        org: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
    });
  } else {
    membership = await getActiveOrgContext(actorUserId);
  }

  if (!membership) {
    await writeAuditLog({
      userId: actorUserId,
      orgId: parsed.data.orgId || null,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "product:request-access",
      ip,
      userAgent,
      metadata: {
        route: "/api/products/request-access",
        reason: "missing_membership",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertMutationSecurity({
      action: "product:request-access",
      actorUserId,
      actorRole: membership.role,
      orgId: membership.orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/products/request-access",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId: membership.orgId,
    role: membership.role,
    action: "product:request-access",
    route: "/api/products/request-access",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentEntitlement = await prisma.orgEntitlement.findUnique({
    where: {
      orgId_product: {
        orgId: membership.orgId,
        product: parsed.data.product,
      },
    },
    select: {
      status: true,
    },
  });

  if (currentEntitlement?.status === EntitlementStatus.INTERNAL_ONLY && !isInternalOrg(membership.org)) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: membership.role,
      orgId: membership.orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      resourceType: "permission",
      resourceId: "product:request-access",
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        route: "/api/products/request-access",
        reason: "internal_only_forbidden",
        product: parsed.data.product,
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestRow = await prisma.accessRequest.create({
    data: {
      orgId: membership.orgId,
      product: parsed.data.product,
      message: parsed.data.message || null,
      createdByUserId: actorUserId,
    },
  });

  await writeAuditLog({
    userId: actorUserId,
    orgId: membership.orgId,
    action: "PRODUCT_ACCESS_REQUESTED",
    entityType: "access_request",
    entityId: requestRow.id,
    ip,
    userAgent,
    metadata: {
      product: requestRow.product,
      status: requestRow.status,
    },
  });

  if (accessRequestNotificationsEnabled && isSmtpConfigured()) {
    const notifyTo = env.ACCESS_REQUEST_NOTIFY_TO || "services@migrateck.com";
    await sendMail({
      to: notifyTo,
      subject: `Product access request: ${requestRow.product}`,
      text: `Org: ${membership.org.name}\nProduct: ${requestRow.product}\nMessage: ${requestRow.message || "(none)"}`,
      html: `<p><strong>Org:</strong> ${membership.org.name}</p><p><strong>Product:</strong> ${requestRow.product}</p><p><strong>Message:</strong> ${requestRow.message || "(none)"}</p>`,
    });
  }

  return NextResponse.json(
    {
      request: {
        id: requestRow.id,
        orgId: requestRow.orgId,
        product: requestRow.product,
        status: requestRow.status,
        message: requestRow.message,
        createdAt: requestRow.createdAt,
      },
    },
    { status: 201 },
  );
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const orgId = request.nextUrl.searchParams.get("orgId");
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: actorUserId,
      orgId,
      status: MembershipStatus.ACTIVE,
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
        route: "/api/products/request-access",
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
    route: "/api/products/request-access",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.accessRequest.findMany({
    where: {
      orgId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 200,
  });

  return NextResponse.json({
    requests: rows,
  });
}
