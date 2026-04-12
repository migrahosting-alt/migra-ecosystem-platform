import { OrgRole, ProvisioningTaskStatus } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createPlatformConfig, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Platform smoke-status integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("OWNER can view smoke status and MEMBER is denied", async () => {
    const owner = await createUser({
      email: "smoke-owner@example.com",
      password: "SmokeOwnerPass123!",
      emailVerified: true,
    });

    const member = await createUser({
      email: "smoke-member@example.com",
      password: "SmokeMemberPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Smoke Org",
      slug: "smoke-org",
      createdById: owner.id,
    });

    await createMembership({ userId: owner.id, orgId: org.id, role: OrgRole.OWNER });
    await createMembership({ userId: member.id, orgId: org.id, role: OrgRole.MEMBER });

    await prisma.user.update({ where: { id: owner.id }, data: { defaultOrgId: org.id } });
    await prisma.user.update({ where: { id: member.id }, data: { defaultOrgId: org.id } });

    await createPlatformConfig({
      maintenanceMode: false,
      freezeProvisioning: true,
      pauseProvisioningWorker: true,
      pauseEntitlementExpiryWorker: false,
    });

    await prisma.billingWebhookEvent.create({
      data: {
        eventId: "evt_smoke_1",
        eventType: "customer.subscription.updated",
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });

    await prisma.provisioningTask.create({
      data: {
        orgId: org.id,
        action: "POD_CREATE",
        status: ProvisioningTaskStatus.PENDING,
      },
    });

    const ownerClient = new HttpClient(baseUrl);
    await createSessionForUser(ownerClient, owner.id);

    const allowed = await ownerClient.get<{
      stripe?: {
        enabled: boolean;
        webhookSecretConfigured: boolean;
        secretKeyConfigured: boolean;
        lastEvent: { eventId: string } | null;
      };
      workers?: {
        provisioning: { pausedByConfig: boolean };
      };
      vps?: {
        providers: Array<{
          slug: string;
          configured: boolean;
          forcedStubMode: boolean;
        }>;
      };
      queue?: {
        depth: number;
        oldestJobAgeSeconds: number | null;
      };
      platform?: {
        freezeProvisioning: boolean;
        pauseProvisioningWorker: boolean;
      };
    }>("/api/platform/smoke-status", { withOrigin: false });

    expect(allowed.status).toBe(200);
    expect(allowed.body?.stripe?.lastEvent?.eventId).toBe("evt_smoke_1");
    expect(allowed.body?.workers?.provisioning.pausedByConfig).toBe(true);
    expect(Array.isArray(allowed.body?.vps?.providers)).toBe(true);
    expect(allowed.body?.queue?.depth).toBe(1);
    expect(typeof allowed.body?.queue?.oldestJobAgeSeconds).toBe("number");
    expect(allowed.body?.platform?.freezeProvisioning).toBe(true);
    expect(allowed.body?.platform?.pauseProvisioningWorker).toBe(true);

    const memberClient = new HttpClient(baseUrl);
    await createSessionForUser(memberClient, member.id);

    const denied = await memberClient.get<{ error?: string }>("/api/platform/smoke-status", { withOrigin: false });
    expect(denied.status).toBe(403);

    const denialAudit = await prisma.auditLog.findFirst({
      where: {
        userId: member.id,
        action: "AUTHZ_PERMISSION_DENIED",
        entityId: "platform:smoke-status:view",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(denialAudit).toBeTruthy();
  });
});
