import { EntitlementStatus, ProductKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { PRODUCT_CATALOG } from "@/lib/constants";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getDriveOperationPolicy } from "@/lib/drive/drive-operation-policy";
import { getDriveRecentEvents } from "@/lib/drive/drive-recent-events";
import { getDriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import { prisma } from "@/lib/prisma";
import { isInternalOrg } from "@/lib/security/internal-org";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";

export async function GET() {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }
  const { session } = authResult;

  const activeOrg = await getActiveOrgContext(session.user.id);

  if (!activeOrg) {
    return NextResponse.json({ products: [] });
  }

  const entitlements = await prisma.orgEntitlement.findMany({
    where: {
      orgId: activeOrg.orgId,
    },
  });

  const entitlementMap = new Map(entitlements.map((item) => [item.product, item]));
  const internalOrg = isInternalOrg(activeOrg.org);
  const driveTenant = await prisma.driveTenant.findUnique({
    where: { orgId: activeOrg.orgId },
  });
  const [driveTenantSummary, driveRecentEvents] = await Promise.all([
    getDriveTenantSummary(activeOrg.orgId, driveTenant),
    getDriveRecentEvents(activeOrg.orgId),
  ]);

  const products = PRODUCT_CATALOG.map((product) => {
    const entitlement = entitlementMap.get(product.key as ProductKey);
    const status = entitlement?.status;
    const driveTenantInput = driveTenant
      ? {
          status: driveTenant.status,
          ...(driveTenant.restrictionReason !== null ? { restrictionReason: driveTenant.restrictionReason } : {}),
          ...(driveTenant.disableReason !== null ? { disableReason: driveTenant.disableReason } : {}),
        }
      : null;
    const runtime = resolveProductRuntimeAccess({
      productKey: product.key as ProductKey,
      entitlement,
      isMigraHostingClient: activeOrg.org.isMigraHostingClient,
      isInternalOrg: internalOrg,
      driveTenant: driveTenantInput,
    });

    return {
      ...product,
      status: status || EntitlementStatus.RESTRICTED,
      canLaunch: runtime.canLaunch,
      requestAccess: runtime.requestAccess,
      reason: runtime.reason,
      tenantStatus: runtime.tenantStatus,
      tenantLifecycleReason: runtime.tenantLifecycleReason,
      capabilities: runtime.capabilities,
      operationPolicy: product.key === ProductKey.MIGRADRIVE ? getDriveOperationPolicy() : null,
      tenantSummary: product.key === ProductKey.MIGRADRIVE ? driveTenantSummary : null,
      recentEvents: product.key === ProductKey.MIGRADRIVE ? driveRecentEvents : null,
    };
  });

  return NextResponse.json({
    orgId: activeOrg.orgId,
    products,
  });
}
