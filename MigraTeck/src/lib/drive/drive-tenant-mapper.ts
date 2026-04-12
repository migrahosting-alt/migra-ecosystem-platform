import type { DriveTenant } from "@prisma/client";
import { getDriveOperationPolicy } from "./drive-operation-policy";
import type { DriveRecentEvent } from "./drive-recent-events";
import { buildCapabilitiesForStatus } from "./drive-tenant-capabilities";
import type { DriveTenantSummary } from "./drive-tenant-summary";

export function mapTenantForBootstrap(
  tenant: Pick<
    DriveTenant,
    | "id"
    | "orgId"
    | "status"
    | "planCode"
    | "storageQuotaGb"
    | "storageUsedBytes"
    | "restrictionReason"
    | "disableReason"
  >,
  tenantSummary?: DriveTenantSummary | null,
  recentEvents: DriveRecentEvent[] = [],
) {
  return {
    tenant: {
      tenantId: tenant.id,
      orgId: tenant.orgId,
      status: tenant.status,
      planCode: tenant.planCode,
      storageQuotaGb: tenant.storageQuotaGb,
      restrictionReason: tenant.restrictionReason,
      disableReason: tenant.disableReason,
      storageUsedBytes:
        typeof tenant.storageUsedBytes === "bigint"
          ? tenant.storageUsedBytes.toString()
          : String(tenant.storageUsedBytes),
    },
    capabilities: buildCapabilitiesForStatus(tenant.status),
    operationPolicy: getDriveOperationPolicy(),
    tenantSummary: tenantSummary ?? null,
    recentEvents,
  };
}