import { DriveFileStatus, DriveTenantStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createOrganization, createUser, getMigraDrivePlanFixture, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

const starterDrivePlan = getMigraDrivePlanFixture();

const authMocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getActiveOrgContext: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireApiSession: authMocks.requireApiSession,
}));

vi.mock("@/lib/auth/session", () => ({
  getActiveOrgContext: authMocks.getActiveOrgContext,
}));

vi.mock("@/lib/security/csrf", () => ({
  requireSameOrigin: authMocks.requireSameOrigin,
}));

function makeJsonRequest(path: string, body?: unknown) {
  return new NextRequest(`http://127.0.0.1:3109${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3109",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function makeMutationRequest(path: string, method: "PATCH" | "DELETE", body?: unknown) {
  return new NextRequest(`http://127.0.0.1:3109${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3109",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("MigraDrive files integration", () => {
  let orgId: string;
  let orgSlug: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    vi.resetModules();
    vi.clearAllMocks();

    const user = await createUser({
      email: "drive-files@example.com",
      password: "Password123!",
      emailVerified: true,
    });
    userId = user.id;

    const org = await createOrganization({
      name: "Drive Files Org",
      slug: "drive-files-org",
      createdById: user.id,
    });
    orgId = org.id;
    orgSlug = org.slug;

    authMocks.requireApiSession.mockResolvedValue({
      ok: true,
      session: {
        user: {
          id: userId,
        },
      },
    });
    authMocks.getActiveOrgContext.mockResolvedValue({
      orgId,
      org,
      role: "OWNER",
    });
    authMocks.requireSameOrigin.mockReturnValue(null);
  });

  test("active tenants can initiate, list, and finalize uploads", async () => {
    const createdTenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
      },
    });

    const filesRoute = await import("../../src/app/api/v1/drive/files/route");
    const initiateResponse = await filesRoute.POST(
      makeJsonRequest("/api/v1/drive/files", {
        fileName: "Q1 Forecast.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        parentPath: "finance/reports",
      }),
    );

    expect(initiateResponse.status).toBe(200);
    const initiatedBody = await initiateResponse.json();
    expect(initiatedBody.ok).toBe(true);
    expect(initiatedBody.data.uploadUrl).toContain("/mock-upload/");
    expect(initiatedBody.data.file.status).toBe(DriveFileStatus.PENDING_UPLOAD);
    expect(initiatedBody.data.file.objectKey).toBe(`tenants/${createdTenant.id}/files/${initiatedBody.data.file.id}/v1`);

    const listResponse = await filesRoute.GET();
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].status).toBe(DriveFileStatus.PENDING_UPLOAD);

    const finalizeRoute = await import("../../src/app/api/v1/drive/files/[fileId]/finalize/route");
    const finalizeResponse = await finalizeRoute.POST(
      makeJsonRequest(`/api/v1/drive/files/${initiatedBody.data.file.id}/finalize`, {}),
      { params: Promise.resolve({ fileId: initiatedBody.data.file.id }) },
    );

    expect(finalizeResponse.status).toBe(200);
    const finalizeBody = await finalizeResponse.json();
    expect(finalizeBody.data.file.status).toBe(DriveFileStatus.ACTIVE);
    expect(finalizeBody.data.storageUsedBytes).toBe("2048");

    const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { orgId } });
    expect(tenant.storageUsedBytes).toBe(2048n);
  });

  test("restricted tenants cannot initiate uploads but can still sign downloads", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.RESTRICTED,
        ...starterDrivePlan,
        restrictionReason: "billing_past_due",
      },
    });

    const file = await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${orgId}/docs/file-001-contract.pdf`,
        fileName: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096n,
        status: DriveFileStatus.ACTIVE,
        uploadedAt: new Date(),
      },
    });

    const filesRoute = await import("../../src/app/api/v1/drive/files/route");
    const initiateResponse = await filesRoute.POST(
      makeJsonRequest("/api/v1/drive/files", {
        fileName: "new-file.txt",
        mimeType: "text/plain",
        sizeBytes: 256,
      }),
    );

    expect(initiateResponse.status).toBe(403);
    expect(await initiateResponse.json()).toMatchObject({
      ok: false,
      error: "tenant_access_denied",
      capability: "canUpload",
      readOnlyMode: true,
    });

    const downloadRoute = await import("../../src/app/api/v1/drive/files/[fileId]/download/route");
    const downloadResponse = await downloadRoute.GET(
      new Request(`http://127.0.0.1:3109/api/v1/drive/files/${file.id}/download`),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(downloadResponse.status).toBe(200);
    const downloadBody = await downloadResponse.json();
    expect(downloadBody.ok).toBe(true);
    expect(downloadBody.data.signedUrl).toContain("/mock-download/");
  });

  test("active tenants can issue share links but restricted tenants cannot", async () => {
    const activeTenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
      },
    });

    const file = await prisma.driveFile.create({
      data: {
        tenantId: activeTenant.id,
        orgId,
        objectKey: `tenants/${orgId}/docs/${activeTenant.id}-brochure.pdf`,
        fileName: "brochure.pdf",
        parentPath: "docs",
        mimeType: "application/pdf",
        sizeBytes: 4096n,
        status: DriveFileStatus.ACTIVE,
        uploadedAt: new Date(),
      },
    });

    const shareRoute = await import("../../src/app/api/v1/drive/files/[fileId]/share/route");
    const activeShareResponse = await shareRoute.POST(
      makeJsonRequest(`/api/v1/drive/files/${file.id}/share`, {}),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(activeShareResponse.status).toBe(200);
    const activeShareBody = await activeShareResponse.json();
    expect(activeShareBody.ok).toBe(true);
    expect(activeShareBody.data.shareUrl).toContain("/mock-download/");
    expect(activeShareBody.data.file.id).toBe(file.id);

    await prisma.driveTenant.update({
      where: { id: activeTenant.id },
      data: {
        status: DriveTenantStatus.RESTRICTED,
        restrictionReason: "billing_past_due",
      },
    });

    const restrictedShareResponse = await shareRoute.POST(
      makeJsonRequest(`/api/v1/drive/files/${file.id}/share`, {}),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(restrictedShareResponse.status).toBe(403);
    expect(await restrictedShareResponse.json()).toMatchObject({
      ok: false,
      error: "tenant_access_denied",
      capability: "canShare",
      readOnlyMode: true,
    });
  });

  test("initiate rejects uploads that exceed the tenant quota", async () => {
    await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        planCode: starterDrivePlan.planCode,
        storageQuotaGb: 1,
        storageUsedBytes: 900_000_000n,
      },
    });

    const filesRoute = await import("../../src/app/api/v1/drive/files/route");
    const response = await filesRoute.POST(
      makeJsonRequest("/api/v1/drive/files", {
        fileName: "oversized.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 200_000_000,
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "tenant_quota_exceeded",
    });
  });

  test("stale pending uploads are cleaned up before listing and quota projection", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        planCode: starterDrivePlan.planCode,
        storageQuotaGb: 1,
      },
    });

    const staleFile = await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${orgId}/stale/${tenant.id}-stale.bin`,
        fileName: "stale.bin",
        parentPath: "stale",
        mimeType: "application/octet-stream",
        sizeBytes: 900_000_000n,
        status: DriveFileStatus.PENDING_UPLOAD,
      },
    });

    const staleCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.driveFile.update({
      where: { id: staleFile.id },
      data: {
        createdAt: staleCreatedAt,
      },
    });

    const filesRoute = await import("../../src/app/api/v1/drive/files/route");
    const listResponse = await filesRoute.GET();
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.data).toHaveLength(0);

    const initiateResponse = await filesRoute.POST(
      makeJsonRequest("/api/v1/drive/files", {
        fileName: "fresh.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 200_000_000,
      }),
    );

    expect(initiateResponse.status).toBe(200);

    const refreshedStaleFile = await prisma.driveFile.findUniqueOrThrow({ where: { id: staleFile.id } });
    expect(refreshedStaleFile.status).toBe(DriveFileStatus.DELETED);
    expect(refreshedStaleFile.deletedAt).not.toBeNull();
  });

  test("finalize auto-restricts when quota shrinks after upload initiation", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
        storageUsedBytes: 70n * 1024n * 1024n * 1024n,
      },
    });

    const filesRoute = await import("../../src/app/api/v1/drive/files/route");
    const initiateResponse = await filesRoute.POST(
      makeJsonRequest("/api/v1/drive/files", {
        fileName: "archive.zip",
        mimeType: "application/zip",
        sizeBytes: 4 * 1024 * 1024 * 1024,
      }),
    );
    expect(initiateResponse.status).toBe(200);
    const initiatedBody = await initiateResponse.json();

    await prisma.driveTenant.update({
      where: { id: tenant.id },
      data: {
        storageQuotaGb: 72,
      },
    });

    const finalizeRoute = await import("../../src/app/api/v1/drive/files/[fileId]/finalize/route");
    const finalizeResponse = await finalizeRoute.POST(
      makeJsonRequest(`/api/v1/drive/files/${initiatedBody.data.file.id}/finalize`, {}),
      { params: Promise.resolve({ fileId: initiatedBody.data.file.id }) },
    );

    expect(finalizeResponse.status).toBe(200);

    const updatedTenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(updatedTenant.status).toBe(DriveTenantStatus.RESTRICTED);
    expect(updatedTenant.restrictionReason).toBe("quota_exceeded");
  });

  test("restricted tenants can rename and move active files but cannot delete them", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.RESTRICTED,
        ...starterDrivePlan,
        restrictionReason: "billing_past_due",
      },
    });

    const file = await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${orgId}/contracts/${tenant.id}-contract.pdf`,
        fileName: "contract.pdf",
        parentPath: "contracts",
        mimeType: "application/pdf",
        sizeBytes: 4096n,
        status: DriveFileStatus.ACTIVE,
        uploadedAt: new Date(),
      },
    });

    const fileRoute = await import("../../src/app/api/v1/drive/files/[fileId]/route");
    const patchResponse = await fileRoute.PATCH(
      makeMutationRequest(`/api/v1/drive/files/${file.id}`, "PATCH", {
        fileName: "Client Contract Final.pdf",
        parentPath: "legal/final",
      }),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(patchResponse.status).toBe(200);
    const patchBody = await patchResponse.json();
    expect(patchBody.data.file.fileName).toBe("Client Contract Final.pdf");
    expect(patchBody.data.file.parentPath).toBe("legal/final");
    expect(patchBody.data.file.objectKey).toBe(file.objectKey);

    const deleteResponse = await fileRoute.DELETE(
      makeMutationRequest(`/api/v1/drive/files/${file.id}`, "DELETE"),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(deleteResponse.status).toBe(403);
    expect(await deleteResponse.json()).toMatchObject({
      ok: false,
      error: "tenant_access_denied",
      capability: "canDelete",
      readOnlyMode: true,
    });
  });

  test("active tenants can soft-delete active files and release storage bytes", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
        storageUsedBytes: 4096n,
      },
    });

    const file = await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${orgId}/docs/${tenant.id}-proposal.pdf`,
        fileName: "proposal.pdf",
        parentPath: "docs",
        mimeType: "application/pdf",
        sizeBytes: 4096n,
        status: DriveFileStatus.ACTIVE,
        uploadedAt: new Date(),
      },
    });

    const fileRoute = await import("../../src/app/api/v1/drive/files/[fileId]/route");
    const deleteResponse = await fileRoute.DELETE(
      makeMutationRequest(`/api/v1/drive/files/${file.id}`, "DELETE"),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(deleteResponse.status).toBe(200);
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.data.file.status).toBe(DriveFileStatus.DELETED);
    expect(deleteBody.data.storageUsedBytes).toBe("0");
    expect(deleteBody.data.releasedBytes).toBe("4096");

    const updatedFile = await prisma.driveFile.findUniqueOrThrow({ where: { id: file.id } });
    const updatedTenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(updatedFile.status).toBe(DriveFileStatus.DELETED);
    expect(updatedFile.deletedAt).not.toBeNull();
    expect(updatedTenant.storageUsedBytes).toBe(0n);
  });

  test("pending uploads can be canceled without delete capability side effects", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
      },
    });

    const file = await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${orgId}/pending/${tenant.id}-cancel-me.txt`,
        fileName: "cancel-me.txt",
        parentPath: "pending",
        mimeType: "text/plain",
        sizeBytes: 1024n,
        status: DriveFileStatus.PENDING_UPLOAD,
      },
    });

    await prisma.driveTenant.update({
      where: { id: tenant.id },
      data: {
        status: DriveTenantStatus.RESTRICTED,
        restrictionReason: "billing_past_due",
      },
    });

    const fileRoute = await import("../../src/app/api/v1/drive/files/[fileId]/route");
    const deleteResponse = await fileRoute.DELETE(
      makeMutationRequest(`/api/v1/drive/files/${file.id}`, "DELETE"),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(deleteResponse.status).toBe(200);
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.data.file.status).toBe(DriveFileStatus.DELETED);
    expect(deleteBody.data.releasedBytes).toBe("0");

    const updatedFile = await prisma.driveFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(updatedFile.status).toBe(DriveFileStatus.DELETED);
    expect(updatedFile.deletedAt).not.toBeNull();
  });

  test("pending uploads cannot be renamed before finalize", async () => {
    const tenant = await prisma.driveTenant.create({
      data: {
        orgId,
        orgSlug,
        status: DriveTenantStatus.ACTIVE,
        ...starterDrivePlan,
      },
    });

    const file = await prisma.driveFile.create({
      data: {
        tenantId: tenant.id,
        orgId,
        objectKey: `tenants/${orgId}/pending/${tenant.id}-draft.docx`,
        fileName: "draft.docx",
        parentPath: "pending",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 2048n,
        status: DriveFileStatus.PENDING_UPLOAD,
      },
    });

    const fileRoute = await import("../../src/app/api/v1/drive/files/[fileId]/route");
    const patchResponse = await fileRoute.PATCH(
      makeMutationRequest(`/api/v1/drive/files/${file.id}`, "PATCH", {
        fileName: "renamed.docx",
      }),
      { params: Promise.resolve({ fileId: file.id }) },
    );

    expect(patchResponse.status).toBe(409);
    expect(await patchResponse.json()).toMatchObject({
      ok: false,
      error: "file_not_mutable",
    });
  });
});