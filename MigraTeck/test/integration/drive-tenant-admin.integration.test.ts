import fs from "node:fs/promises";
import { DriveTenantActorType, DriveTenantStatus } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDriveMockStorageRoot, writeMockStoredObject } from "../../src/lib/drive/mock-storage";
import { createOrganization, getMigraDrivePlanFixture, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

const baseEnv = { ...process.env };
const starterDrivePlan = getMigraDrivePlanFixture();
const businessDrivePlan = getMigraDrivePlanFixture("business");

function makeRequest(path: string, method: string, body?: unknown, token = "drive-test-token") {
  return new NextRequest(`http://127.0.0.1:3109${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("MigraDrive admin integration", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    await resetDatabase();
    vi.resetModules();
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      MIGRADRIVE_INTERNAL_PROVISION_TOKEN: "drive-test-token",
      UPLOAD_STORAGE_PROVIDER: "mock",
      DOWNLOAD_STORAGE_PROVIDER: "mock",
    };

    await fs.rm(getDriveMockStorageRoot(), { recursive: true, force: true });

    orgSlug = "drive-admin-org";
    const org = await createOrganization({
      name: "Drive Admin Org",
      slug: orgSlug,
    });
    orgId = org.id;
  });

  test("support lookups by subscription and entitlement return the tenant", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...businessDrivePlan,
        subscriptionId: "sub_drive_001",
        entitlementId: "ent_drive_001",
      },
    });

    const { GET: getBySubscription } = await import(
      "../../src/app/api/internal/admin/drive-tenants/by-subscription/[subscriptionId]/route"
    );
    const { GET: getByEntitlement } = await import(
      "../../src/app/api/internal/admin/drive-tenants/by-entitlement/[entitlementId]/route"
    );

    const subscriptionResponse = await getBySubscription(
      makeRequest(
        "/api/internal/admin/drive-tenants/by-subscription/sub_drive_001",
        "GET",
      ),
      { params: Promise.resolve({ subscriptionId: "sub_drive_001" }) },
    );
    expect(subscriptionResponse.status).toBe(200);
    expect((await subscriptionResponse.json()).id).toBe(tenant.id);

    const entitlementResponse = await getByEntitlement(
      makeRequest(
        "/api/internal/admin/drive-tenants/by-entitlement/ent_drive_001",
        "GET",
      ),
      { params: Promise.resolve({ entitlementId: "ent_drive_001" }) },
    );
    expect(entitlementResponse.status).toBe(200);
    expect((await entitlementResponse.json()).id).toBe(tenant.id);
  });

  test("admin restrict writes an immutable event row with ADMIN actor type", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...businessDrivePlan,
      },
    });

    const { POST } = await import(
      "../../src/app/api/internal/admin/drive-tenants/[tenantId]/restrict/route"
    );
    const response = await POST(
      makeRequest(
        `/api/internal/admin/drive-tenants/${tenant.id}/restrict`,
        "POST",
        {
          reason: "billing_past_due",
          actorId: "admin_123",
          traceId: "trace_drive_001",
          idempotencyKey: "idem_drive_001",
          metadata: { source: "support_console" },
        },
      ),
      { params: Promise.resolve({ tenantId: tenant.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.tenant.status).toBe("RESTRICTED");

    const event = await prisma.driveTenantEvent.findFirst({
      where: {
        tenantId: tenant.id,
        action: "TENANT_RESTRICTED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(event).toBeTruthy();
    expect(event!.actorType).toBe(DriveTenantActorType.ADMIN);
    expect(event!.actorId).toBe("admin_123");
    expect(event!.traceId).toBe("trace_drive_001");
    expect(event!.idempotencyKey).toBe("idem_drive_001");
    expect(JSON.parse(event!.metadataJson || "{}")) .toMatchObject({
      reason: "billing_past_due",
      source: "support_console",
    });
  });

  test("plan downgrade over quota auto-restricts and writes both lifecycle events", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...businessDrivePlan,
        storageUsedBytes: BigInt(3 * 1024 * 1024 * 1024),
      },
    });

    const { POST } = await import(
      "../../src/app/api/internal/admin/drive-tenants/[tenantId]/update-plan/route"
    );
    const response = await POST(
      makeRequest(
        `/api/internal/admin/drive-tenants/${tenant.id}/update-plan`,
        "POST",
        {
          planCode: starterDrivePlan.planCode,
          storageQuotaGb: 1,
          actorId: "admin_456",
          traceId: "trace_drive_002",
          idempotencyKey: "idem_drive_002",
          metadata: { source: "billing_webhook" },
        },
      ),
      { params: Promise.resolve({ tenantId: tenant.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.tenant.planCode).toBe(starterDrivePlan.planCode);
    expect(body.tenant.status).toBe("RESTRICTED");

    const refreshedTenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(refreshedTenant.status).toBe(DriveTenantStatus.RESTRICTED);
    expect(refreshedTenant.restrictionReason).toBe("quota_exceeded_after_downgrade");

    const events = await prisma.driveTenantEvent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
    });
    expect(events.map((event) => event.action)).toContain("TENANT_PLAN_UPDATED");
    expect(events.map((event) => event.action)).toContain("TENANT_RESTRICTED");
  });

  test("files, trash, and versions endpoints expose tenant inspectors", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...businessDrivePlan,
      },
    });

    const liveFile = await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${tenant.id}/files/file_live/v1`,
        fileName: "live.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096n,
        status: "ACTIVE",
        uploadedAt: new Date(),
      },
    });

    await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${tenant.id}/files/file_deleted/v1`,
        fileName: "deleted.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048n,
        status: "DELETED",
        deletedAt: new Date(),
      },
    });

    const { GET: getFiles } = await import(
      "../../src/app/api/internal/admin/drive-tenants/[tenantId]/files/route"
    );
    const { GET: getTrash } = await import(
      "../../src/app/api/internal/admin/drive-tenants/[tenantId]/trash/route"
    );
    const { GET: getVersions } = await import(
      "../../src/app/api/internal/admin/drive-tenants/[tenantId]/versions/[fileId]/route"
    );

    const filesResponse = await getFiles(
      makeRequest(`/api/internal/admin/drive-tenants/${tenant.id}/files`, "GET"),
      { params: Promise.resolve({ tenantId: tenant.id }) },
    );
    expect(filesResponse.status).toBe(200);
    const filesBody = await filesResponse.json();
    expect(filesBody.items).toHaveLength(1);
    expect(filesBody.items[0].id).toBe(liveFile.id);

    const trashResponse = await getTrash(
      makeRequest(`/api/internal/admin/drive-tenants/${tenant.id}/trash`, "GET"),
      { params: Promise.resolve({ tenantId: tenant.id }) },
    );
    expect(trashResponse.status).toBe(200);
    const trashBody = await trashResponse.json();
    expect(trashBody.items).toHaveLength(1);
    expect(trashBody.items[0].status).toBe("DELETED");

    const versionsResponse = await getVersions(
      makeRequest(`/api/internal/admin/drive-tenants/${tenant.id}/versions/${liveFile.id}`, "GET"),
      { params: Promise.resolve({ tenantId: tenant.id, fileId: liveFile.id }) },
    );
    expect(versionsResponse.status).toBe(200);
    const versionsBody = await versionsResponse.json();
    expect(versionsBody.versioningMode).toBe("single_current_version");
    expect(versionsBody.items[0].versionId).toBe("v1");
  });

  test("storage health and reconcile endpoints return operational data", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...businessDrivePlan,
        storageUsedBytes: 1024n,
      },
    });

    const liveObjectKey = `tenants/${tenant.id}/files/file_live/v1`;
    await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: liveObjectKey,
        fileName: "live.txt",
        mimeType: "text/plain",
        sizeBytes: 1024n,
        status: "ACTIVE",
        uploadedAt: new Date(),
      },
    });
    await writeMockStoredObject(liveObjectKey, Buffer.alloc(1024, 1), "text/plain");

    const { GET: getStorageHealth } = await import(
      "../../src/app/api/internal/admin/drive-storage-health/route"
    );
    const { POST: postReconcile } = await import(
      "../../src/app/api/internal/admin/drive-tenants/[tenantId]/reconcile/route"
    );

    const storageHealthResponse = await getStorageHealth(
      makeRequest("/api/internal/admin/drive-storage-health", "GET"),
    );
    expect(storageHealthResponse.status).toBe(200);
    const storageHealthBody = await storageHealthResponse.json();
    expect(storageHealthBody.storage.privateAccessOnly).toBe(true);
    expect(storageHealthBody.tenants.total).toBe(1);
    expect(storageHealthBody.storage.providerReachable).toBe(true);
    expect(storageHealthBody.storage.bucketChecks[0].status).toBe("ok");
    expect(storageHealthBody.incompleteMultipartUploads).toBe(0);

    const reconcileResponse = await postReconcile(
      makeRequest(`/api/internal/admin/drive-tenants/${tenant.id}/reconcile`, "POST", {}),
      { params: Promise.resolve({ tenantId: tenant.id }) },
    );
    expect(reconcileResponse.status).toBe(200);
    const reconcileBody = await reconcileResponse.json();
    expect(reconcileBody.ok).toBe(true);
    expect(reconcileBody.driftDetected).toBe(false);
    expect(reconcileBody.objectBackedBytes).toBe("1024");
    expect(reconcileBody.report.mode).toBe("provider_backed_reconcile");
    expect(reconcileBody.report.primaryBucketAccessible).toBe(true);
    expect(reconcileBody.operation.operationType).toBe("RECONCILE_TENANT");
  });

  test("reconcile reports missing storage objects as drift", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...businessDrivePlan,
        storageUsedBytes: 2048n,
      },
    });

    const objectKey = `tenants/${tenant.id}/files/file_missing/v1`;
    await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey,
        fileName: "missing.txt",
        mimeType: "text/plain",
        sizeBytes: 2048n,
        status: "ACTIVE",
        uploadedAt: new Date(),
      },
    });

    const { POST: postReconcile } = await import(
      "../../src/app/api/internal/admin/drive-tenants/[tenantId]/reconcile/route"
    );

    const reconcileResponse = await postReconcile(
      makeRequest(`/api/internal/admin/drive-tenants/${tenant.id}/reconcile`, "POST", {}),
      { params: Promise.resolve({ tenantId: tenant.id }) },
    );

    expect(reconcileResponse.status).toBe(200);
    const reconcileBody = await reconcileResponse.json();
    expect(reconcileBody.ok).toBe(true);
    expect(reconcileBody.driftDetected).toBe(true);
    expect(reconcileBody.report.missingObjectCount).toBe(1);
    expect(reconcileBody.report.missingObjects[0].objectKey).toBe(objectKey);
    expect(reconcileBody.operation.status).toBe("DRIFT_DETECTED");
  });
});