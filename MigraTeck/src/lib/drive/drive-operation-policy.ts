import { DRIVE_PENDING_UPLOAD_STALE_HOURS } from "./drive-file-maintenance";
import { DRIVE_SINGLE_UPLOAD_MAX_BYTES } from "./drive-files";

export interface DriveOperationPolicy {
  maxSingleUploadBytes: number;
  pendingUploadStaleAfterHours: number;
  cleanupMode: "request_time";
  supportsShareLinks: boolean;
  supportsPendingUploadCancel: boolean;
}

export function getDriveOperationPolicy(): DriveOperationPolicy {
  return {
    maxSingleUploadBytes: DRIVE_SINGLE_UPLOAD_MAX_BYTES,
    pendingUploadStaleAfterHours: DRIVE_PENDING_UPLOAD_STALE_HOURS,
    cleanupMode: "request_time",
    supportsShareLinks: true,
    supportsPendingUploadCancel: true,
  };
}