import { DriveTenantStatus } from "@prisma/client";
import type { DriveTenantCapabilities } from "./drive-tenant-types";

export function buildCapabilitiesForStatus(status: DriveTenantStatus): DriveTenantCapabilities {
  if (status === DriveTenantStatus.ACTIVE) {
    return {
      canUpload: true,
      canDelete: true,
      canRename: true,
      canMove: true,
      canDownload: true,
      canPreview: true,
      canShare: true,
      readOnlyMode: false,
    };
  }

  if (status === DriveTenantStatus.RESTRICTED) {
    return {
      canUpload: false,
      canDelete: false,
      canRename: true,
      canMove: true,
      canDownload: true,
      canPreview: true,
      canShare: false,
      readOnlyMode: true,
    };
  }

  return {
    canUpload: false,
    canDelete: false,
    canRename: false,
    canMove: false,
    canDownload: false,
    canPreview: false,
    canShare: false,
    readOnlyMode: true,
  };
}
