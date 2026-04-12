import { DriveTenantStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordDriveStatusDenied, recordDriveTenantNotFound } from "./drive-tenant-metrics";
import { buildCapabilitiesForStatus } from "./drive-tenant-capabilities";
import type { DriveTenantCapabilities } from "./drive-tenant-types";

export async function getDriveTenantAccess(orgId: string) {
  const tenant = await prisma.driveTenant.findUnique({ where: { orgId } });

  if (!tenant) {
    recordDriveTenantNotFound({ orgId });
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "tenant_not_found" }, { status: 404 }),
    };
  }

  if (tenant.status === DriveTenantStatus.DISABLED) {
    recordDriveStatusDenied({ reason: "tenant_disabled", orgId, status: tenant.status });
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "tenant_disabled", tenantLifecycleReason: tenant.disableReason ?? null },
        { status: 403 },
      ),
    };
  }

  if (tenant.status === DriveTenantStatus.PENDING) {
    recordDriveStatusDenied({ reason: "tenant_pending", orgId, status: tenant.status });
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "tenant_pending" }, { status: 409 }),
    };
  }

  return {
    ok: true as const,
    tenant,
    capabilities: buildCapabilitiesForStatus(tenant.status),
  };
}

export function denyIfCapabilityMissing(
  capabilities: DriveTenantCapabilities,
  capability: keyof DriveTenantCapabilities,
) {
  if (capabilities[capability]) {
    return null;
  }

  recordDriveStatusDenied({ reason: "capability_denied", capability });

  return NextResponse.json(
    {
      ok: false,
      error: "tenant_access_denied",
      capability,
      readOnlyMode: capabilities.readOnlyMode,
    },
    { status: 403 },
  );
}

export function requireUploadPermission(capabilities: DriveTenantCapabilities) {
  return denyIfCapabilityMissing(capabilities, "canUpload");
}

export function requireDeletePermission(capabilities: DriveTenantCapabilities) {
  return denyIfCapabilityMissing(capabilities, "canDelete");
}

export function requireRenamePermission(capabilities: DriveTenantCapabilities) {
  return denyIfCapabilityMissing(capabilities, "canRename");
}

export function requireMovePermission(capabilities: DriveTenantCapabilities) {
  return denyIfCapabilityMissing(capabilities, "canMove");
}

export function requireDownloadPermission(capabilities: DriveTenantCapabilities) {
  return denyIfCapabilityMissing(capabilities, "canDownload");
}

export function requireSharePermission(capabilities: DriveTenantCapabilities) {
  return denyIfCapabilityMissing(capabilities, "canShare");
}
