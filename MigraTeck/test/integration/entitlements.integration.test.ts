import { EntitlementStatus, OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createEntitlement, createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { createTier2Intent } from "../helpers/security";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Entitlements integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("ADMIN can update entitlement, MEMBER cannot, and launch respects status", async () => {
    const admin = await createUser({
      email: "ent-admin@example.com",
      password: "EntAdminPass123!",
      emailVerified: true,
    });

    const member = await createUser({
      email: "ent-member@example.com",
      password: "EntMemberPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Entitlements Org",
      slug: "entitlements-org",
      isMigraHostingClient: true,
      createdById: admin.id,
    });

    await createMembership({ userId: admin.id, orgId: org.id, role: OrgRole.ADMIN });
    await createMembership({ userId: member.id, orgId: org.id, role: OrgRole.MEMBER });

    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: org.id } });
    await prisma.user.update({ where: { id: member.id }, data: { defaultOrgId: org.id } });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.RESTRICTED,
    });

    const adminClient = new HttpClient(baseUrl);
    await createSessionForUser(adminClient, admin.id);

    const memberClient = new HttpClient(baseUrl);
    await createSessionForUser(memberClient, member.id);

    const updatePayload = {
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.TRIAL,
      notes: "trial-enabled",
    };
    const updateIntentId = await createTier2Intent(adminClient, {
      action: "org:entitlement:update",
      orgId: org.id,
      payload: [updatePayload],
    });

    const adminUpdate = await adminClient.put<{ entitlements?: Array<{ product: ProductKey; status: EntitlementStatus }> }>(
      `/api/orgs/${org.id}/entitlements`,
      {
        json: {
          ...updatePayload,
          intentId: updateIntentId,
        },
      },
    );

    expect(adminUpdate.status).toBe(200);

    const updatedEntitlement = await prisma.orgEntitlement.findUnique({
      where: {
        orgId_product: {
          orgId: org.id,
          product: ProductKey.MIGRAPANEL,
        },
      },
    });

    expect(updatedEntitlement?.status).toBe(EntitlementStatus.TRIAL);

    const updateAudit = await prisma.auditLog.findFirst({
      where: {
        userId: admin.id,
        orgId: org.id,
        action: "ORG_ENTITLEMENT_UPDATED",
        entityId: ProductKey.MIGRAPANEL,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(updateAudit).toBeTruthy();

    const memberDenied = await memberClient.put<{ error?: string }>(`/api/orgs/${org.id}/entitlements`, {
      json: {
        product: ProductKey.MIGRAPANEL,
        status: EntitlementStatus.ACTIVE,
      },
    });

    expect(memberDenied.status).toBe(403);

    const trialLaunch = await memberClient.post<{ launchUrl?: string; error?: string }>("/api/products/launch", {
      json: {
        product: ProductKey.MIGRAPANEL,
      },
    });

    expect(trialLaunch.status).toBe(200);
    expect(trialLaunch.body?.launchUrl).toBeTruthy();

    const expiredPayload = {
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.TRIAL,
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const expiredIntentId = await createTier2Intent(adminClient, {
      action: "org:entitlement:update",
      orgId: org.id,
      payload: [expiredPayload],
    });

    const expiredTrialUpdate = await adminClient.put<{ error?: string }>(`/api/orgs/${org.id}/entitlements`, {
      json: {
        ...expiredPayload,
        intentId: expiredIntentId,
      },
    });
    expect(expiredTrialUpdate.status).toBe(200);

    const expiredTrialLaunch = await memberClient.post<{ error?: string }>("/api/products/launch", {
      json: {
        product: ProductKey.MIGRAPANEL,
      },
    });
    expect(expiredTrialLaunch.status).toBe(403);
    expect(expiredTrialLaunch.body?.error).toMatch(/not active/i);

    const internalOnlyDenied = await adminClient.put<{ error?: string }>(`/api/orgs/${org.id}/entitlements`, {
      json: {
        product: ProductKey.MIGRAPANEL,
        status: EntitlementStatus.INTERNAL_ONLY,
      },
    });
    expect(internalOnlyDenied.status).toBe(403);

    const restrictedPayload = {
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.RESTRICTED,
    };
    const restrictedIntentId = await createTier2Intent(adminClient, {
      action: "org:entitlement:update",
      orgId: org.id,
      payload: [restrictedPayload],
    });

    await adminClient.put(`/api/orgs/${org.id}/entitlements`, {
      json: {
        ...restrictedPayload,
        intentId: restrictedIntentId,
      },
    });

    const restrictedLaunch = await memberClient.post<{ error?: string }>("/api/products/launch", {
      json: {
        product: ProductKey.MIGRAPANEL,
      },
    });

    expect(restrictedLaunch.status).toBe(403);
    expect(restrictedLaunch.body?.error).toMatch(/Product access is not active/i);
  });
});
