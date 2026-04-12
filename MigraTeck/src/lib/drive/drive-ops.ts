import { DriveFileStatus, DriveTenantStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanupStalePendingDriveFilesForOrg } from "./drive-file-maintenance";
import { getDriveStorageSummary, inspectDriveMultipartUploads, inspectDriveStoredObject, inspectDriveStorage } from "./drive-storage";
import { listTenantEvents } from "./drive-tenant-events";
import { getDriveTenantSummary } from "./drive-tenant-summary";

export interface DriveOpsTenantFilters {
  query?: string | null | undefined;
  tenantId?: string | null | undefined;
  orgId?: string | null | undefined;
  orgSlug?: string | null | undefined;
  subscriptionId?: string | null | undefined;
  entitlementId?: string | null | undefined;
  userEmail?: string | null | undefined;
  status?: string | null | undefined;
  planCode?: string | null | undefined;
  cursor?: string | null | undefined;
  limit?: number | undefined;
}

export interface DriveOpsOperationFilters {
  tenantId?: string | null | undefined;
  orgId?: string | null | undefined;
  operationType?: string | null | undefined;
  status?: string | null | undefined;
  cursor?: string | null | undefined;
  limit?: number | undefined;
}

export interface CreateDriveOperationInput {
  tenantId?: string | null | undefined;
  orgId: string;
  operationType: string;
  status: string;
  request?: Record<string, unknown> | null | undefined;
  response?: Record<string, unknown> | null | undefined;
  errorCode?: string | null | undefined;
  errorMessage?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  traceId?: string | null | undefined;
}

function parsePositiveInt(value: number | undefined, fallback: number): number {
  if (!value || value <= 0) {
    return fallback;
  }

  return Math.min(value, 200);
}

function maybeContains(value?: string | null) {
  if (!value?.trim()) {
    return undefined;
  }

  return { contains: value.trim(), mode: "insensitive" as const };
}

function normalizeExact(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function buildTenantWhere(filters: DriveOpsTenantFilters = {}): Prisma.DriveTenantWhereInput {
  const query = filters.query?.trim();
  const where: Prisma.DriveTenantWhereInput = {};

  const tenantId = normalizeExact(filters.tenantId);
  const orgId = normalizeExact(filters.orgId);
  const orgSlug = normalizeExact(filters.orgSlug);
  const subscriptionId = normalizeExact(filters.subscriptionId);
  const entitlementId = normalizeExact(filters.entitlementId);
  const status = normalizeExact(filters.status) as DriveTenantStatus | undefined;
  const planCode = normalizeExact(filters.planCode);

  if (tenantId) where.id = tenantId;
  if (orgId) where.orgId = orgId;
  if (orgSlug) where.orgSlug = orgSlug;
  if (subscriptionId) where.subscriptionId = subscriptionId;
  if (entitlementId) where.entitlementId = entitlementId;
  if (status) where.status = status;
  if (planCode) where.planCode = planCode;

  if (query) {
    const containsQuery = { contains: query, mode: "insensitive" as const };
    where.OR = [
      { id: query },
      { orgId: query },
      { orgSlug: containsQuery },
      { subscriptionId: query },
      { entitlementId: query },
      { org: { name: containsQuery } },
      { org: { memberships: { some: { user: { email: containsQuery } } } } },
    ];
  }

  if (filters.userEmail?.trim()) {
    const emailContains = { contains: filters.userEmail.trim(), mode: "insensitive" as const };
    where.AND = [
      ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
      {
        org: {
          memberships: {
            some: {
              user: {
                email: emailContains,
              },
            },
          },
        },
      },
    ];
  }

  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }

  return where;
}

export async function listDriveTenantsForOps(filters: DriveOpsTenantFilters = {}) {
  const limit = parsePositiveInt(filters.limit, 50);
  const items = await prisma.driveTenant.findMany({
    where: buildTenantWhere(filters),
    include: {
      org: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

  return { items: sliced, nextCursor };
}

export async function getDriveTenantOpsDetail(tenantId: string) {
  const tenant = await prisma.driveTenant.findUnique({
    where: { id: tenantId },
    include: {
      org: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!tenant) {
    return null;
  }

  const [summary, events, operations, activeFiles, trashFiles] = await Promise.all([
    getDriveTenantSummary(tenant.orgId, tenant),
    listTenantEvents(tenant.id, { limit: 25 }),
    listDriveOperationsForOps({ tenantId: tenant.id, limit: 25 }),
    listDriveFilesForOps(tenant.id, "live", 25),
    listDriveFilesForOps(tenant.id, "trash", 25),
  ]);

  return {
    tenant,
    summary,
    events,
    operations,
    activeFiles,
    trashFiles,
  };
}

export async function listDriveFilesForOps(
  tenantId: string,
  mode: "live" | "trash",
  limit = 50,
  cursor?: string | null | undefined,
) {
  const take = parsePositiveInt(limit, 50);
  const where: Prisma.DriveFileWhereInput = {
    tenantId,
    status:
      mode === "trash"
        ? DriveFileStatus.DELETED
        : {
            in: [DriveFileStatus.PENDING_UPLOAD, DriveFileStatus.ACTIVE],
          },
  };

  if (cursor) {
    where.id = { lt: cursor };
  }

  const items = await prisma.driveFile.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });

  const hasMore = items.length > take;
  const sliced = hasMore ? items.slice(0, take) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

  return { items: sliced, nextCursor };
}

export async function getDriveFileVersionsForOps(tenantId: string, fileId: string) {
  const file = await prisma.driveFile.findFirst({
    where: {
      tenantId,
      id: fileId,
    },
  });

  if (!file) {
    return null;
  }

  return {
    versioningMode: "single_current_version",
    items: [
      {
        versionId: "v1",
        fileId: file.id,
        objectKey: file.objectKey,
        status: file.status,
        sizeBytes: file.sizeBytes,
        checksumSha256: file.checksumSha256,
        createdAt: file.createdAt,
        uploadedAt: file.uploadedAt,
        deletedAt: file.deletedAt,
      },
    ],
  };
}

export async function listDriveOperationsForOps(filters: DriveOpsOperationFilters = {}) {
  const limit = parsePositiveInt(filters.limit, 50);
  const where: Prisma.DriveTenantOperationWhereInput = {};

  const tenantId = normalizeExact(filters.tenantId);
  const orgId = normalizeExact(filters.orgId);
  const operationType = normalizeExact(filters.operationType);
  const status = normalizeExact(filters.status);

  if (tenantId) where.tenantId = tenantId;
  if (orgId) where.orgId = orgId;
  if (operationType) where.operationType = operationType;
  if (status) where.status = status;
  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }

  const items = await prisma.driveTenantOperation.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

  return { items: sliced, nextCursor };
}

export async function createDriveOperation(input: CreateDriveOperationInput) {
  return prisma.driveTenantOperation.create({
    data: {
      tenantId: input.tenantId ?? null,
      orgId: input.orgId,
      operationType: input.operationType,
      status: input.status,
      requestJson: input.request ? JSON.stringify(input.request) : null,
      responseJson: input.response ? JSON.stringify(input.response) : null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      traceId: input.traceId ?? null,
      completedAt: new Date(),
    },
  });
}

export async function runDriveTenantCleanup(tenantId: string) {
  const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: tenantId } });
  const cleanedCount = await cleanupStalePendingDriveFilesForOrg(tenant.orgId);
  const operation = await createDriveOperation({
    tenantId: tenant.id,
    orgId: tenant.orgId,
    operationType: "CLEANUP_STALE_PENDING_UPLOADS",
    status: "SUCCEEDED",
    response: {
      cleanedCount,
      mode: "request_time_cleanup",
    },
  });

  return {
    operation,
    cleanedCount,
  };
}

export async function runDriveTenantReconciliation(tenantId: string) {
  const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: tenantId } });
  const [aggregate, activeFiles, pendingFiles, storageInspection, multipartInspection] = await Promise.all([
    prisma.driveFile.aggregate({
      where: {
        tenantId,
        status: DriveFileStatus.ACTIVE,
      },
      _sum: {
        sizeBytes: true,
      },
      _count: {
        id: true,
      },
    }),
    prisma.driveFile.findMany({
      where: {
        tenantId,
        status: DriveFileStatus.ACTIVE,
      },
      select: {
        id: true,
        objectKey: true,
        fileName: true,
        sizeBytes: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.driveFile.findMany({
      where: {
        tenantId,
        status: DriveFileStatus.PENDING_UPLOAD,
      },
      select: {
        id: true,
      },
    }),
    inspectDriveStorage(),
    inspectDriveMultipartUploads(`tenants/${tenantId}/files/`),
  ]);

  const activeBytes = aggregate._sum.sizeBytes ?? 0n;
  const primaryBucketCheck = storageInspection.bucketChecks.find((check) => check.kind === "primary") || null;
  const missingObjects: Array<{ fileId: string; fileName: string; objectKey: string }> = [];
  const sizeMismatches: Array<{ fileId: string; fileName: string; objectKey: string; dbSizeBytes: string; objectSizeBytes: string }> = [];
  const inaccessibleObjects: Array<{ fileId: string; fileName: string; objectKey: string; errorCode: string | null }> = [];
  let objectBackedBytes = 0n;

  for (const file of activeFiles) {
    const inspection = await inspectDriveStoredObject(file.objectKey);

    if (inspection.status === "missing") {
      missingObjects.push({
        fileId: file.id,
        fileName: file.fileName,
        objectKey: file.objectKey,
      });
      continue;
    }

    if (inspection.status === "unreachable" || inspection.status === "unconfigured") {
      inaccessibleObjects.push({
        fileId: file.id,
        fileName: file.fileName,
        objectKey: file.objectKey,
        errorCode: inspection.errorCode,
      });
      continue;
    }

    const objectSize = inspection.sizeBytes ? BigInt(inspection.sizeBytes) : file.sizeBytes;
    objectBackedBytes += objectSize;

    if (objectSize !== file.sizeBytes) {
      sizeMismatches.push({
        fileId: file.id,
        fileName: file.fileName,
        objectKey: file.objectKey,
        dbSizeBytes: file.sizeBytes.toString(),
        objectSizeBytes: objectSize.toString(),
      });
    }
  }

  const driftDetected = (
    activeBytes !== tenant.storageUsedBytes
    || missingObjects.length > 0
    || sizeMismatches.length > 0
    || (multipartInspection.count ?? 0) > 0
  );
  const inspectionFailed = Boolean(
    (primaryBucketCheck && primaryBucketCheck.status !== "ok")
    || inaccessibleObjects.length > 0
    || multipartInspection.errorCode,
  );
  const report = {
    mode: "provider_backed_reconcile",
    storageProvider: storageInspection.provider,
    primaryBucketStatus: primaryBucketCheck?.status || "unconfigured",
    primaryBucketAccessible: primaryBucketCheck?.status === "ok",
    activeFileCount: aggregate._count.id,
    pendingUploadCount: pendingFiles.length,
    dbActiveBytes: activeBytes.toString(),
    objectBackedBytes: objectBackedBytes.toString(),
    tenantStorageUsedBytes: tenant.storageUsedBytes.toString(),
    missingObjectCount: missingObjects.length,
    missingObjects: missingObjects.slice(0, 25),
    sizeMismatchCount: sizeMismatches.length,
    sizeMismatches: sizeMismatches.slice(0, 25),
    inaccessibleObjectCount: inaccessibleObjects.length,
    inaccessibleObjects: inaccessibleObjects.slice(0, 25),
    incompleteMultipartUploads: multipartInspection.count,
    incompleteMultipartUploadSampleKeys: multipartInspection.sampleKeys,
    incompleteMultipartUploadsTruncated: multipartInspection.truncated,
    driftDetected,
  };
  const operation = await createDriveOperation({
    tenantId: tenant.id,
    orgId: tenant.orgId,
    operationType: "RECONCILE_TENANT",
    status: inspectionFailed ? "FAILED" : driftDetected ? "DRIFT_DETECTED" : "SUCCEEDED",
    response: report,
    errorCode: inspectionFailed ? primaryBucketCheck?.errorCode || multipartInspection.errorCode || "storage_inspection_failed" : null,
    errorMessage: inspectionFailed ? primaryBucketCheck?.errorMessage || multipartInspection.errorMessage || "Drive storage inspection could not be completed." : null,
  });

  return {
    operation,
    activeBytes,
    objectBackedBytes,
    driftDetected,
    report,
  };
}

export async function runDrivePreviewRegeneration(tenantId: string) {
  const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: tenantId } });
  const operation = await createDriveOperation({
    tenantId: tenant.id,
    orgId: tenant.orgId,
    operationType: "REGENERATE_PREVIEWS",
    status: "NOT_CONFIGURED",
    errorCode: "preview_pipeline_not_configured",
    errorMessage: "Derivative generation worker is not configured in this workspace.",
  });

  return { operation };
}

export async function getDriveStorageHealth() {
  const storageSummary = getDriveStorageSummary();
  const [
    totalTenants,
    activeTenants,
    restrictedTenants,
    disabledTenants,
    pendingTenants,
    liveFiles,
    deletedFiles,
    pendingFiles,
    storageUsed,
    lastReconcilerRun,
    lastFailedStorageAction,
    storageInspection,
  ] = await Promise.all([
    prisma.driveTenant.count(),
    prisma.driveTenant.count({ where: { status: DriveTenantStatus.ACTIVE } }),
    prisma.driveTenant.count({ where: { status: DriveTenantStatus.RESTRICTED } }),
    prisma.driveTenant.count({ where: { status: DriveTenantStatus.DISABLED } }),
    prisma.driveTenant.count({ where: { status: DriveTenantStatus.PENDING } }),
    prisma.driveFile.count({ where: { status: DriveFileStatus.ACTIVE } }),
    prisma.driveFile.count({ where: { status: DriveFileStatus.DELETED } }),
    prisma.driveFile.count({ where: { status: DriveFileStatus.PENDING_UPLOAD } }),
    prisma.driveTenant.aggregate({
      _sum: {
        storageUsedBytes: true,
      },
    }),
    prisma.driveTenantOperation.findFirst({
      where: {
        operationType: "RECONCILE_TENANT",
      },
      orderBy: { completedAt: "desc" },
    }),
    prisma.driveTenantOperation.findFirst({
      where: {
        status: {
          in: ["FAILED", "DRIFT_DETECTED", "NOT_CONFIGURED"],
        },
      },
      orderBy: { completedAt: "desc" },
    }),
    inspectDriveStorage(),
  ]);

  const warnings = [...storageSummary.warnings];
  storageInspection.bucketChecks.forEach((check) => {
    if (check.configured && check.status !== "ok") {
      warnings.push(`bucket_${check.kind}_${check.status}`);
    }
  });
  if (storageInspection.multipart.errorCode) {
    warnings.push("multipart_listing_failed");
  }

  return {
    storage: {
      ...storageSummary,
      warnings,
      providerReachable: storageInspection.reachable,
      bucketChecks: storageInspection.bucketChecks,
      multipartSupport: storageInspection.multipart.supported,
      multipartListingTruncated: storageInspection.multipart.truncated,
      multipartSampleKeys: storageInspection.multipart.sampleKeys,
    },
    tenants: {
      total: totalTenants,
      active: activeTenants,
      restricted: restrictedTenants,
      disabled: disabledTenants,
      pending: pendingTenants,
    },
    files: {
      active: liveFiles,
      pending: pendingFiles,
      deleted: deletedFiles,
    },
    storageUsedBytes: (storageUsed._sum.storageUsedBytes ?? 0n).toString(),
    lastReconcilerRun,
    lastFailedStorageAction,
    incompleteMultipartUploads: storageInspection.multipart.count,
    driftStatus: lastFailedStorageAction?.status === "DRIFT_DETECTED" ? "detected" : "clear",
  };
}