import { DriveTenantStatus, OrgRole, ProductKey } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION } from "@/lib/drive/drive-recent-events";
import {
  createEntitlement,
  getMigraDrivePlanFixture,
  createMembership,
  createOrganization,
  createUser,
  resetDatabase,
} from "../helpers/fixtures";

const starterDrivePlan = getMigraDrivePlanFixture();

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getActiveOrgContext: vi.fn(),
  assertPermission: vi.fn(),
  writeAuditLog: vi.fn(),
  requireSameOrigin: vi.fn(),
  assertEntitlement: vi.fn(),
  registerLaunchNonce: vi.fn(),
  assertMutationSecurity: vi.fn(),
  assertRateLimit: vi.fn(),
  verifyLaunchToken: vi.fn(),
  consumeLaunchNonce: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/auth/session", () => ({
  getActiveOrgContext: mocks.getActiveOrgContext,
}));

vi.mock("@/lib/authorization", () => ({
  assertPermission: mocks.assertPermission,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("@/lib/security/csrf", () => ({
  requireSameOrigin: mocks.requireSameOrigin,
}));

vi.mock("@/lib/security/enforcement", () => ({
  EntitlementEnforcementError: class EntitlementEnforcementError extends Error {
    httpStatus = 403;
  },
  assertEntitlement: mocks.assertEntitlement,
}));

vi.mock("@/lib/security/launch-nonce", () => ({
  registerLaunchNonce: mocks.registerLaunchNonce,
  consumeLaunchNonce: mocks.consumeLaunchNonce,
}));

vi.mock("@/lib/security/mutation-guard", () => ({
  assertMutationSecurity: mocks.assertMutationSecurity,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
}));

vi.mock("@/lib/security/launch-token", async () => {
  const actual = await vi.importActual("@/lib/security/launch-token");
  return {
    ...actual,
    verifyLaunchToken: mocks.verifyLaunchToken,
  };
});

function makeJsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://127.0.0.1:3109${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3109",
    },
    body: JSON.stringify(body),
  });
}

describe("Product runtime route integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.resetModules();
    vi.clearAllMocks();

    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.assertPermission.mockResolvedValue(true);
    mocks.assertMutationSecurity.mockResolvedValue(undefined);
    mocks.assertEntitlement.mockResolvedValue(undefined);
    mocks.assertRateLimit.mockResolvedValue({ ok: true });
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.registerLaunchNonce.mockResolvedValue(undefined);
    mocks.consumeLaunchNonce.mockResolvedValue(true);
  });

  test("products API exposes RESTRICTED MigraDrive tenant capabilities", async () => {
    const cleanupAt = new Date("2026-04-11T15:00:00.000Z");
    const user = await createUser({
      email: "products-runtime@example.com",
      password: "RuntimePass123!",
    });
    const org = await createOrganization({
      name: "Products Runtime Org",
      slug: "products-runtime-org",
      createdById: user.id,
    });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRADRIVE,
    });

    const { prisma } = await import("../helpers/prisma");
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        status: DriveTenantStatus.RESTRICTED,
        ...starterDrivePlan,
        storageUsedBytes: 12n * 1024n * 1024n * 1024n,
        restrictionReason: "quota_exceeded_after_downgrade",
      },
    });
    await prisma.driveFile.createMany({
      data: [
        {
          tenantId: tenant.id,
          orgId: org.id,
          objectKey: `tenants/${org.id}/docs/${tenant.id}-alpha.pdf`,
          fileName: "alpha.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024n,
          status: "ACTIVE",
          uploadedAt: new Date(),
        },
        {
          tenantId: tenant.id,
          orgId: org.id,
          objectKey: `tenants/${org.id}/docs/${tenant.id}-beta.pdf`,
          fileName: "beta.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048n,
          status: "ACTIVE",
          uploadedAt: new Date(),
        },
        {
          tenantId: tenant.id,
          orgId: org.id,
          objectKey: `tenants/${org.id}/pending/${tenant.id}-gamma.pdf`,
          fileName: "gamma.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048n,
          status: "PENDING_UPLOAD",
        },
        {
          tenantId: tenant.id,
          orgId: org.id,
          objectKey: `tenants/${org.id}/pending/${tenant.id}-stale.pdf`,
          fileName: "stale.pdf",
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
          orgId: org.id,
          action: DRIVE_PENDING_UPLOAD_STALE_CLEANUP_ACTION,
          metadata: {
            details: {
              cleanedCount: 1,
            },
          },
          createdAt: cleanupAt,
        },
        {
          orgId: org.id,
          action: "DRIVE_FILE_UPLOAD_FINALIZED",
          entityId: tenant.id,
          metadata: {
            details: {
              fileName: "alpha.pdf",
            },
          },
          createdAt: new Date("2026-04-11T15:05:00.000Z"),
        },
      ],
    });

    mocks.requireApiSession.mockResolvedValue({
      ok: true,
      session: { user: { id: user.id } },
    });
    mocks.getActiveOrgContext.mockResolvedValue({
      orgId: org.id,
      org,
      role: OrgRole.OWNER,
    });

    const { GET } = await import("../../src/app/api/products/route");
    const response = await GET();
    const body = await response.json();
    const product = body.products.find((item: { key: ProductKey }) => item.key === ProductKey.MIGRADRIVE);

    expect(response.status).toBe(200);
    expect(product).toBeTruthy();
    expect(product.canLaunch).toBe(true);
    expect(product.tenantStatus).toBe("RESTRICTED");
    expect(product.tenantLifecycleReason).toBe("quota_exceeded_after_downgrade");
    expect(product.capabilities).toMatchObject({
      canUpload: false,
      canDelete: false,
      canMove: true,
      canDownload: true,
      readOnlyMode: true,
    });
    expect(product.operationPolicy).toEqual({
      maxSingleUploadBytes: 5 * 1024 * 1024 * 1024,
      pendingUploadStaleAfterHours: 24,
      cleanupMode: "request_time",
      supportsShareLinks: true,
      supportsPendingUploadCancel: true,
    });
    expect(product.tenantSummary).toEqual({
      storageQuotaGb: starterDrivePlan.storageQuotaGb,
      storageUsedBytes: String(12n * 1024n * 1024n * 1024n),
      activeFileCount: 2,
      pendingUploadCount: 1,
      stalePendingUploadCount: 1,
      lastCleanupAt: cleanupAt.toISOString(),
    });
    expect(product.recentEvents).toEqual([
      {
        action: "DRIVE_FILE_UPLOAD_FINALIZED",
        summary: "Upload finalized: alpha.pdf",
        occurredAt: "2026-04-11T15:05:00.000Z",
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

  test("launch route rejects MigraDrive tenants in PENDING state", async () => {
    process.env.MIGRADRIVE_LAUNCH_URL = "http://127.0.0.1:3109/migradrive";

    const user = await createUser({
      email: "products-launch@example.com",
      password: "RuntimePass123!",
    });
    const org = await createOrganization({
      name: "Products Launch Org",
      slug: "products-launch-org",
      isMigraHostingClient: true,
      createdById: user.id,
    });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRADRIVE,
    });

    const { prisma } = await import("../helpers/prisma");
    await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        status: DriveTenantStatus.PENDING,
        ...starterDrivePlan,
      },
    });

    mocks.requireApiSession.mockResolvedValue({
      ok: true,
      session: { user: { id: user.id } },
    });
    mocks.getActiveOrgContext.mockResolvedValue({
      orgId: org.id,
      org,
      role: OrgRole.OWNER,
    });

    const { POST } = await import("../../src/app/api/products/launch/route");
    const response = await POST(
      makeJsonRequest("/api/products/launch", { product: ProductKey.MIGRADRIVE }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/pending/i);
  });

  test("launch route falls back to the in-app MigraDrive workspace when no launch URL is configured", async () => {
    const previousLaunchUrl = process.env.MIGRADRIVE_LAUNCH_URL;
    delete process.env.MIGRADRIVE_LAUNCH_URL;

    try {
      const user = await createUser({
        email: "products-launch-fallback@example.com",
        password: "RuntimePass123!",
      });
      const org = await createOrganization({
        name: "Products Launch Fallback Org",
        slug: "products-launch-fallback-org",
        createdById: user.id,
      });

      await createEntitlement({
        orgId: org.id,
        product: ProductKey.MIGRADRIVE,
      });

      const { prisma } = await import("../helpers/prisma");
      await prisma.driveTenant.create({
        data: {
          orgId: org.id,
          orgSlug: org.slug,
          status: DriveTenantStatus.ACTIVE,
          ...starterDrivePlan,
        },
      });

      mocks.requireApiSession.mockResolvedValue({
        ok: true,
        session: { user: { id: user.id } },
      });
      mocks.getActiveOrgContext.mockResolvedValue({
        orgId: org.id,
        org,
        role: OrgRole.OWNER,
      });

      const { POST } = await import("../../src/app/api/products/launch/route");
      const response = await POST(
        makeJsonRequest("/api/products/launch", { product: ProductKey.MIGRADRIVE }),
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.launchUrl).toBeTruthy();
      expect(new URL(payload.launchUrl).pathname).toBe("/app/drive");
    } finally {
      if (previousLaunchUrl !== undefined) {
        process.env.MIGRADRIVE_LAUNCH_URL = previousLaunchUrl;
      }
    }
  });

  test("consume route rejects disabled MigraDrive tenants", async () => {
    const user = await createUser({
      email: "products-consume@example.com",
      password: "RuntimePass123!",
      emailVerified: true,
    });
    const org = await createOrganization({
      name: "Products Consume Org",
      slug: "products-consume-org",
      isMigraHostingClient: true,
      createdById: user.id,
    });

    await createMembership({
      userId: user.id,
      orgId: org.id,
      role: OrgRole.MEMBER,
    });
    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRADRIVE,
    });

    const { prisma } = await import("../helpers/prisma");
    await prisma.driveTenant.create({
      data: {
        orgId: org.id,
        orgSlug: org.slug,
        status: DriveTenantStatus.DISABLED,
        ...starterDrivePlan,
        disabledAt: new Date(),
        disableReason: "billing_canceled",
      },
    });

    mocks.verifyLaunchToken.mockReturnValue({
      sub: user.id,
      orgId: org.id,
      product: ProductKey.MIGRADRIVE,
      aud: "migradrive.example.com",
      nonce: "nonce-001",
    });

    const { POST } = await import("../../src/app/api/products/consume/route");
    const response = await POST(
      makeJsonRequest("/api/products/consume", {
        token: "token-value-token-value",
        expectedAudience: "migradrive.example.com",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Forbidden",
      reason: "TENANT_DISABLED",
      tenantLifecycleReason: "billing_canceled",
    });
  });
});