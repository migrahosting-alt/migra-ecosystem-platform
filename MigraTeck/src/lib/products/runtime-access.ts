import {
  DriveTenantStatus,
  EntitlementStatus,
  ProductKey,
  type DriveTenant,
} from "@prisma/client";
import { buildCapabilitiesForStatus } from "@/lib/drive/drive-tenant-capabilities";
import type { DriveTenantCapabilities } from "@/lib/drive/drive-tenant-types";
import { isEntitlementRuntimeAllowed } from "@/lib/entitlements";
import { isClientOnlyProduct } from "@/lib/constants";

interface EntitlementWindow {
  status?: EntitlementStatus | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

type DriveTenantRuntimeShape = Pick<DriveTenant, "status">;
type DriveTenantLifecycleShape = Pick<DriveTenant, "status"> & {
  restrictionReason?: string | null | undefined;
  disableReason?: string | null | undefined;
};

export interface ProductRuntimeAccess {
  canLaunch: boolean;
  requestAccess: boolean;
  reason: string | null;
  tenantStatus: DriveTenantStatus | null;
  tenantLifecycleReason: string | null;
  capabilities: DriveTenantCapabilities | null;
}

interface ProductRuntimeAccessInput {
  productKey: ProductKey;
  entitlement?: EntitlementWindow | null | undefined;
  isMigraHostingClient: boolean;
  isInternalOrg: boolean;
  driveTenant?: DriveTenantLifecycleShape | null | undefined;
}

export function resolveProductRuntimeAccess(
  input: ProductRuntimeAccessInput,
): ProductRuntimeAccess {
  const gatedByClient =
    isClientOnlyProduct(input.productKey) && !input.isMigraHostingClient;
  const allowedByEntitlement = isEntitlementRuntimeAllowed({
    status: input.entitlement?.status,
    startsAt: input.entitlement?.startsAt || null,
    endsAt: input.entitlement?.endsAt || null,
    allowInternal: true,
    isInternalOrg: input.isInternalOrg,
  });

  const tenantStatus =
    input.productKey === ProductKey.MIGRADRIVE ? input.driveTenant?.status ?? null : null;

  const tenantBlockedReason =
    tenantStatus === DriveTenantStatus.PENDING
      ? "TENANT_PENDING"
      : tenantStatus === DriveTenantStatus.DISABLED
        ? "TENANT_DISABLED"
        : null;
  const tenantLifecycleReason =
    tenantStatus === DriveTenantStatus.RESTRICTED
      ? input.driveTenant?.restrictionReason ?? null
      : tenantStatus === DriveTenantStatus.DISABLED
        ? input.driveTenant?.disableReason ?? null
        : null;

  return {
    canLaunch: allowedByEntitlement && !gatedByClient && !tenantBlockedReason,
    requestAccess: !allowedByEntitlement || gatedByClient || Boolean(tenantBlockedReason),
    reason: gatedByClient ? "CLIENT_ONLY_PRODUCT" : tenantBlockedReason,
    tenantStatus,
    tenantLifecycleReason,
    capabilities:
      input.productKey === ProductKey.MIGRADRIVE && input.driveTenant
        ? buildCapabilitiesForStatus(input.driveTenant.status)
        : null,
  };
}