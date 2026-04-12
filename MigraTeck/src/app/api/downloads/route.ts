import { EntitlementStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { isClientOnlyProduct } from "@/lib/constants";
import { isEntitlementRuntimeAllowed } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { isInternalOrg } from "@/lib/security/internal-org";

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }
  const { session } = authResult;

  const activeOrg = await getActiveOrgContext(session.user.id);

  if (!activeOrg) {
    return NextResponse.json({ downloads: [] });
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const allowed = await assertPermission({
    actorUserId: session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "downloads:read",
    route: "/api/downloads",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [artifacts, entitlements] = await Promise.all([
    prisma.downloadArtifact.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ product: "asc" }, { createdAt: "desc" }],
    }),
    prisma.orgEntitlement.findMany({
      where: {
        orgId: activeOrg.orgId,
      },
      select: {
        product: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);

  const entitlementMap = new Map(entitlements.map((row) => [row.product, row]));
  const internalOrg = isInternalOrg(activeOrg.org);

  const downloads = artifacts.map((artifact) => {
    const entitlement = entitlementMap.get(artifact.product);
    const entitlementStatus = entitlement?.status || EntitlementStatus.RESTRICTED;
    const statusAllowed = isEntitlementRuntimeAllowed(
      {
        status: entitlementStatus,
        startsAt: entitlement?.startsAt || null,
        endsAt: entitlement?.endsAt || null,
        allowInternal: true,
        isInternalOrg: internalOrg,
      },
      activeOrg.role,
    );
    const clientAllowed =
      !isClientOnlyProduct(artifact.product) ||
      activeOrg.org.isMigraHostingClient ||
      activeOrg.role === "OWNER";

    return {
      id: artifact.id,
      name: artifact.name,
      product: artifact.product,
      version: artifact.version,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes.toString(),
      entitled: statusAllowed && clientAllowed,
      entitlementStatus,
      reason: !clientAllowed
        ? "CLIENT_ONLY_PRODUCT"
        : statusAllowed
          ? null
          : entitlementStatus === EntitlementStatus.INTERNAL_ONLY
            ? "INTERNAL_ONLY"
            : "ENTITLEMENT_REQUIRED",
    };
  });

  await writeAuditLog({
    userId: session.user.id,
    orgId: activeOrg.orgId,
    action: "DOWNLOADS_VIEWED",
    entityType: "downloads",
    ip,
    userAgent,
    metadata: {
      count: downloads.length,
    },
  });

  return NextResponse.json({
    org: {
      id: activeOrg.orgId,
      name: activeOrg.org.name,
    },
    downloads,
  });
}
