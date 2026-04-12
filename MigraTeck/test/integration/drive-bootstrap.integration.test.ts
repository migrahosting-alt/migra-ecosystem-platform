import { DriveTenantStatus } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createOrganization, getMigraDrivePlanFixture, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";
import { DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION } from "@/lib/drive/drive-recent-events";

const starterDrivePlan = getMigraDrivePlanFixture();

const authMocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getActiveOrgContext: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireApiSession: authMocks.requireApiSession,
}));

vi.mock("@/lib/auth/session", () => ({
  getActiveOrgContext: authMocks.getActiveOrgContext,
}));

describe("MigraDrive bootstrap integration", () => {
  let orgId: string;
  let orgSlug: string;

  beforeEach(async () => {
    await resetDatabase();
    vi.resetModules();
    vi.clearAllMocks();

    orgSlug = "drive-bootstrap-org";
    const org = await createOrganization({
      name: "Drive Bootstrap Org",
      slug: orgSlug,
    });
    orgId = org.id;

    authMocks.requireApiSession.mockResolvedValue({
      ok: true,
      session: {
        user: {
          id: "user_bootstrap_001",
        },
      },
    });
    authMocks.getActiveOrgContext.mockResolvedValue({ orgId, org });
  });

  test("bootstrap rejects PENDING tenants", async () => {
    await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.PENDING,
        ...starterDrivePlan,
      },
    });

    const { GET } = await import("../../src/app/api/v1/drive/bootstrap/route");
    const response = await GET();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "tenant_pending" });
  });

  test("bootstrap rejects DISABLED tenants", async () => {
    await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.DISABLED,
        ...starterDrivePlan,
        disabledAt: new Date(),
        disableReason: "billing_past_due",
      },
    });

    const { GET } = await import("../../src/app/api/v1/drive/bootstrap/route");
    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: "tenant_disabled",
      tenantLifecycleReason: "billing_past_due",
    });
  });

  test("bootstrap returns read-only capabilities for RESTRICTED tenants", async () => {
    const cleanupAt = new Date("2026-04-11T12:34:56.000Z");
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.RESTRICTED,
        ...starterDrivePlan,
        storageUsedBytes: BigInt(182381283123),
        restrictedAt: new Date(),
        restrictionReason: "quota_exceeded_after_downgrade",
      },
    });

    await prisma.driveFile.createMany({
      data: [
        {
          tenantId: tenant.id,
          orgId,
          objectKey: `tenants/${orgId}/docs/${tenant.id}-restricted-a.pdf`,
          fileName: "restricted-a.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024n,
          status: "ACTIVE",
          uploadedAt: new Date(),
        },
        {
          tenantId: tenant.id,
          orgId,
          objectKey: `tenants/${orgId}/pending/${tenant.id}-restricted-b.pdf`,
          fileName: "restricted-b.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048n,
          status: "PENDING_UPLOAD",
        },
        {
          tenantId: tenant.id,
          orgId,
          objectKey: `tenants/${orgId}/pending/${tenant.id}-restricted-stale.pdf`,
          fileName: "restricted-stale.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024n,
          status: "PENDING_UPLOAD",
          createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        },
      ],
    });
    await prisma.auditLog.createMany({
      data: [
        {
          orgId,
          action: DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION,
          metadata: {
            details: {
              cleanedCount: 1,
            },
          },
          createdAt: cleanupAt,
        },
        {
          orgId,
          action: "DRIVE_FILE_SHARE_LINK_ISSUED",
          entityId: tenant.id,
          metadata: {
            details: {
              fileName: "restricted-a.pdf",
            },
          },
          createdAt: new Date("2026-04-11T12:35:56.000Z"),
        },
      ],
    });

    const { GET } = await import("../../src/app/api/v1/drive/bootstrap/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.tenant.orgId).toBe(orgId);
    expect(body.data.tenant.status).toBe("RESTRICTED");
    expect(body.data.tenant.planCode).toBe(starterDrivePlan.planCode);
    expect(body.data.tenant.restrictionReason).toBe("quota_exceeded_after_downgrade");
    expect(body.data.tenant.disableReason).toBeNull();
    expect(body.data.tenant.storageUsedBytes).toBe("182381283123");
    expect(body.data.capabilities).toEqual({
      canUpload: false,
      canDelete: false,
      canRename: true,
      canMove: true,
      canDownload: true,
      canPreview: true,
      canShare: false,
      readOnlyMode: true,
    });
    expect(body.data.operationPolicy).toEqual({
      maxSingleUploadBytes: 5 * 1024 * 1024 * 1024,
      pendingUploadStaleAfterHours: 24,
      cleanupMode: "request_time",
      supportsShareLinks: true,
      supportsPendingUploadCancel: true,
    });
    expect(body.data.tenantSummary).toEqual({
      storageQuotaGb: starterDrivePlan.storageQuotaGb,
      storageUsedBytes: "182381283123",
      activeFileCount: 1,
      pendingUploadCount: 1,
      stalePendingUploadCount: 1,
      lastCleanupAt: cleanupAt.toISOString(),
    });
    expect(body.data.recentEvents).toEqual([
      {
        action: "DRIVE_FILE_SHARE_LINK_ISSUED",
        summary: "Share link issued: restricted-a.pdf",
        occurredAt: "2026-04-11T12:35:56.000Z",
        resourceId: tenant.id,
      },
      {
        action: DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION,
        summary: "Cleaned up 1 stale pending upload",
        occurredAt: cleanupAt.toISOString(),
        resourceId: null,
      },
    ]);
  });
});