import { OrgRole } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { createTier2Intent } from "../helpers/security";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Platform config integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("OWNER can get and update config", async () => {
    const owner = await createUser({
      email: "platform-owner@example.com",
      password: "OwnerPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Platform Org",
      slug: "platform-org",
      createdById: owner.id,
    });

    await createMembership({ userId: owner.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: owner.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, owner.id);

    const before = await client.get<{
      config?: {
        allowPublicSignup: boolean;
        allowOrgCreate: boolean;
        waitlistMode: boolean;
        maintenanceMode: boolean;
        freezeProvisioning: boolean;
        pauseProvisioningWorker: boolean;
        pauseEntitlementExpiryWorker: boolean;
      };
    }>(
      "/api/platform/config",
      { withOrigin: false },
    );

    expect(before.status).toBe(200);

    const patchPayload = {
      allowPublicSignup: true,
      allowOrgCreate: true,
      waitlistMode: true,
      maintenanceMode: false,
      freezeProvisioning: true,
      pauseProvisioningWorker: true,
      pauseEntitlementExpiryWorker: true,
    };

    const intentId = await createTier2Intent(client, {
      action: "platform:config:update",
      payload: patchPayload,
    });

    const updated = await client.post<{
      config?: {
        allowPublicSignup: boolean;
        allowOrgCreate: boolean;
        waitlistMode: boolean;
        maintenanceMode: boolean;
        freezeProvisioning: boolean;
        pauseProvisioningWorker: boolean;
        pauseEntitlementExpiryWorker: boolean;
      };
    }>(
      "/api/platform/config",
      {
        json: { ...patchPayload, intentId },
      },
    );

    expect(updated.status).toBe(200);
    expect(updated.body?.config?.allowPublicSignup).toBe(true);
    expect(updated.body?.config?.allowOrgCreate).toBe(true);
    expect(updated.body?.config?.waitlistMode).toBe(true);
    expect(updated.body?.config?.maintenanceMode).toBe(false);
    expect(updated.body?.config?.freezeProvisioning).toBe(true);
    expect(updated.body?.config?.pauseProvisioningWorker).toBe(true);
    expect(updated.body?.config?.pauseEntitlementExpiryWorker).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {
        userId: owner.id,
        action: "PLATFORM_CONFIG_UPDATED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
  });

  test("non-OWNER is denied and denial is audited", async () => {
    const member = await createUser({
      email: "platform-member@example.com",
      password: "MemberPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Member Org",
      slug: "member-org",
      createdById: member.id,
    });

    await createMembership({ userId: member.id, orgId: org.id, role: OrgRole.MEMBER });
    await prisma.user.update({ where: { id: member.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, member.id);

    const deniedGet = await client.get<{ error?: string }>("/api/platform/config", { withOrigin: false });
    expect(deniedGet.status).toBe(403);

    const deniedPost = await client.post<{ error?: string }>("/api/platform/config", {
      json: {
        allowPublicSignup: false,
      },
    });
    expect(deniedPost.status).toBe(403);

    const riskDenialAudit = await prisma.auditLog.findFirst({
      where: {
        userId: member.id,
        action: "AUTHZ_RISK_TIER_DENIED",
        entityId: "platform:config:update",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(riskDenialAudit).toBeTruthy();

    const denialAudit = await prisma.auditLog.findFirst({
      where: {
        userId: member.id,
        action: "AUTHZ_PERMISSION_DENIED",
        entityId: "platform:config:manage",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(denialAudit).toBeTruthy();
  });

  test("freeze provisioning blocks invite creation for non-owner", async () => {
    const owner = await createUser({
      email: "freeze-owner@example.com",
      password: "FreezeOwnerPass123!",
      emailVerified: true,
    });

    const admin = await createUser({
      email: "freeze-admin@example.com",
      password: "FreezeAdminPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Freeze Org",
      slug: "freeze-org",
      createdById: owner.id,
    });

    await createMembership({ userId: owner.id, orgId: org.id, role: OrgRole.OWNER });
    await createMembership({ userId: admin.id, orgId: org.id, role: OrgRole.ADMIN });
    await prisma.user.update({ where: { id: owner.id }, data: { defaultOrgId: org.id } });
    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: org.id } });

    const ownerClient = new HttpClient(baseUrl);
    await createSessionForUser(ownerClient, owner.id);

    const freezePayload = {
      freezeProvisioning: true,
    };

    const intentId = await createTier2Intent(ownerClient, {
      action: "platform:config:update",
      payload: freezePayload,
    });

    const updated = await ownerClient.post("/api/platform/config", {
      json: {
        ...freezePayload,
        intentId,
      },
    });
    expect(updated.status).toBe(200);

    const adminClient = new HttpClient(baseUrl);
    await createSessionForUser(adminClient, admin.id);

    const blockedInvite = await adminClient.post<{ error?: string }>(`/api/orgs/${org.id}/invites`, {
      json: {
        email: "new-user@example.com",
        role: OrgRole.MEMBER,
      },
    });

    expect(blockedInvite.status).toBe(423);
    expect(blockedInvite.body?.error).toMatch(/temporarily unavailable/i);

    const lockdownAudit = await prisma.auditLog.findFirst({
      where: {
        userId: admin.id,
        orgId: org.id,
        action: "PLATFORM_LOCKDOWN_BLOCKED",
        entityId: "org:invite:create",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(lockdownAudit).toBeTruthy();
  });
});
