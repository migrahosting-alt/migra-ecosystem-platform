import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export const DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION = "DRIVE_PENDING_UPLOAD_STALE_CLEANUP";

const DRIVE_RECENT_EVENT_ACTIONS = [
  DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION,
  "DRIVE_TENANT_PROVISIONED",
  "DRIVE_TENANT_UPGRADED",
  "DRIVE_TENANT_REACTIVATED",
  "DRIVE_TENANT_DISABLED",
  "DRIVE_FILE_UPLOAD_INITIATED",
  "DRIVE_FILE_UPLOAD_FINALIZED",
  "DRIVE_FILE_METADATA_UPDATED",
  "DRIVE_FILE_DELETED",
  "DRIVE_FILE_PENDING_UPLOAD_CANCELED",
  "DRIVE_FILE_SHARE_LINK_ISSUED",
] as const;

export interface DriveRecentEvent {
  action: string;
  summary: string;
  occurredAt: string;
  resourceId: string | null;
}

function readMetadataDetails(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const details = (metadata as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  return details as Record<string, unknown>;
}

function readString(details: Record<string, unknown> | null, key: string): string | null {
  const value = details?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberLike(details: Record<string, unknown> | null, key: string): number | null {
  const value = details?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getFileLabel(details: Record<string, unknown> | null): string | null {
  const directName =
    readString(details, "fileName")
    || readString(details, "nextFileName")
    || readString(details, "previousFileName");

  if (directName) {
    return directName;
  }

  const objectKey = readString(details, "objectKey");
  if (!objectKey) {
    return null;
  }

  const lastSegment = objectKey.split("/").filter(Boolean).pop();
  if (!lastSegment) {
    return null;
  }

  const separatorIndex = lastSegment.indexOf("-");
  return separatorIndex >= 0 ? lastSegment.slice(separatorIndex + 1) : lastSegment;
}

function getEventSummary(input: {
  action: string;
  metadata: unknown;
}): string {
  const details = readMetadataDetails(input.metadata);
  const fileLabel = getFileLabel(details);
  const fileSuffix = fileLabel ? `: ${fileLabel}` : "";

  switch (input.action) {
    case DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION: {
      const cleanedCount = readNumberLike(details, "cleanedCount") || 0;
      const unit = cleanedCount === 1 ? "upload" : "uploads";
      return `Cleaned up ${cleanedCount} stale pending ${unit}`;
    }
    case "DRIVE_TENANT_PROVISIONED":
      return "Tenant provisioned";
    case "DRIVE_TENANT_UPGRADED":
      return "Plan upgraded";
    case "DRIVE_TENANT_REACTIVATED":
      return "Tenant reactivated";
    case "DRIVE_TENANT_DISABLED":
      return "Tenant disabled";
    case "DRIVE_FILE_UPLOAD_INITIATED":
      return `Upload initiated${fileSuffix}`;
    case "DRIVE_FILE_UPLOAD_FINALIZED":
      return `Upload finalized${fileSuffix}`;
    case "DRIVE_FILE_METADATA_UPDATED":
      return `File metadata updated${fileSuffix}`;
    case "DRIVE_FILE_DELETED":
      return `File deleted${fileSuffix}`;
    case "DRIVE_FILE_PENDING_UPLOAD_CANCELED":
      return `Pending upload canceled${fileSuffix}`;
    case "DRIVE_FILE_SHARE_LINK_ISSUED":
      return `Share link issued${fileSuffix}`;
    default:
      return input.action;
  }
}

export async function recordDrivePendingUploadCleanup(input: {
  actorId: string;
  actorRole: string | null;
  orgId: string;
  cleanedCount: number;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  if (input.cleanedCount < 1) {
    return;
  }

  await writeAuditLog({
    actorId: input.actorId,
    actorRole: input.actorRole,
    orgId: input.orgId,
    action: DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION,
    resourceType: "drive_file",
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 2,
    metadata: {
      cleanedCount: input.cleanedCount,
    },
  });
}

export async function getDriveLastCleanupAt(orgId: string): Promise<string | null> {
  const latestCleanup = await prisma.auditLog.findFirst({
    where: {
      orgId,
      action: DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION,
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  return latestCleanup?.createdAt.toISOString() ?? null;
}

export async function getDriveRecentEvents(orgId: string, limit = 5): Promise<DriveRecentEvent[]> {
  const records = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: {
        in: [...DRIVE_RECENT_EVENT_ACTIONS],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      action: true,
      entityId: true,
      metadata: true,
      createdAt: true,
    },
  });

  return records.map((record) => ({
    action: record.action,
    summary: getEventSummary(record),
    occurredAt: record.createdAt.toISOString(),
    resourceId: record.entityId,
  }));
}