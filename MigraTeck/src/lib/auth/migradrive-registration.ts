import { DriveTenantStatus, EntitlementStatus, ProductKey } from "@prisma/client";
import { getDefaultMigraDrivePlanConfig } from "@/lib/drive/drive-plan-config";
import { prisma } from "@/lib/prisma";

export async function ensureStarterMigraDriveForOrg(input: {
  orgId: string;
  orgSlug: string;
  subscriptionId?: string | null;
  entitlementId?: string | null;
}) {
  const defaultPlan = getDefaultMigraDrivePlanConfig();

  const entitlement = await prisma.orgEntitlement.upsert({
    where: {
      orgId_product: {
        orgId: input.orgId,
        product: ProductKey.MIGRADRIVE,
      },
    },
    update: {
      status: EntitlementStatus.ACTIVE,
    },
    create: {
      orgId: input.orgId,
      product: ProductKey.MIGRADRIVE,
      status: EntitlementStatus.ACTIVE,
    },
  });

  const tenant = await prisma.driveTenant.upsert({
    where: { orgId: input.orgId },
    update: {
      orgSlug: input.orgSlug,
      planCode: defaultPlan.planCode,
      storageQuotaGb: defaultPlan.storageQuotaGb,
      status: DriveTenantStatus.PENDING,
      restrictedAt: null,
      restrictionReason: null,
      disabledAt: null,
      disableReason: null,
      entitlementId: input.entitlementId || entitlement.id,
      subscriptionId: input.subscriptionId || null,
    },
    create: {
      orgId: input.orgId,
      orgSlug: input.orgSlug,
      planCode: defaultPlan.planCode,
      storageQuotaGb: defaultPlan.storageQuotaGb,
      status: DriveTenantStatus.PENDING,
      entitlementId: input.entitlementId || entitlement.id,
      subscriptionId: input.subscriptionId || null,
      provisioningJobId: null,
    },
  });

  return { entitlement, tenant };
}