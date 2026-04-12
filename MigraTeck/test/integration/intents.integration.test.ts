import { EntitlementStatus, OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createEntitlement, createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";
import { createTier2Intent } from "../helpers/security";
import { createMutationIntent, MutationIntentError } from "../../src/lib/security/intent";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Tier-2 mutation intents integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.STEP_UP_TIER2 = "NONE";
  });

  test("tier-2 routes enforce single-use payload-bound intents", async () => {
    const admin = await createUser({
      email: "intent-admin@example.com",
      password: "IntentAdminPass123!",
      emailVerified: true,
    });

    const secondAdmin = await createUser({
      email: "intent-admin-2@example.com",
      password: "IntentAdmin2Pass123!",
      emailVerified: true,
    });

    const member = await createUser({
      email: "intent-member@example.com",
      password: "IntentMemberPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Intent Org",
      slug: "intent-org",
      createdById: admin.id,
      isMigraHostingClient: true,
    });

    await createMembership({ userId: admin.id, orgId: org.id, role: OrgRole.ADMIN });
    await createMembership({ userId: secondAdmin.id, orgId: org.id, role: OrgRole.ADMIN });
    await createMembership({ userId: member.id, orgId: org.id, role: OrgRole.MEMBER });

    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: org.id } });
    await prisma.user.update({ where: { id: secondAdmin.id }, data: { defaultOrgId: org.id } });
    await prisma.user.update({ where: { id: member.id }, data: { defaultOrgId: org.id } });

    await createEntitlement({
      orgId: org.id,
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.RESTRICTED,
    });

    const adminClient = new HttpClient(baseUrl);
    const secondAdminClient = new HttpClient(baseUrl);
    const memberClient = new HttpClient(baseUrl);

    await createSessionForUser(adminClient, admin.id);
    await createSessionForUser(secondAdminClient, secondAdmin.id);
    await createSessionForUser(memberClient, member.id);

    const payload = {
      product: ProductKey.MIGRAPANEL,
      status: EntitlementStatus.ACTIVE,
      notes: "intent-update",
    };

    const missingIntent = await adminClient.put(`/api/orgs/${org.id}/entitlements`, {
      json: payload,
    });
    expect(missingIntent.status).toBe(403);

    const intentId = await createTier2Intent(adminClient, {
      action: "org:entitlement:update",
      orgId: org.id,
      payload: [payload],
    });

    const allowed = await adminClient.put(`/api/orgs/${org.id}/entitlements`, {
      json: {
        ...payload,
        intentId,
      },
    });
    expect(allowed.status).toBe(200);

    const replay = await adminClient.put(`/api/orgs/${org.id}/entitlements`, {
      json: {
        ...payload,
        intentId,
      },
    });
    expect(replay.status).toBe(403);

    const mismatchIntentId = await createTier2Intent(adminClient, {
      action: "org:entitlement:update",
      orgId: org.id,
      payload: [payload],
    });

    const mismatch = await adminClient.put(`/api/orgs/${org.id}/entitlements`, {
      json: {
        product: ProductKey.MIGRAPANEL,
        status: EntitlementStatus.TRIAL,
        intentId: mismatchIntentId,
      },
    });
    expect(mismatch.status).toBe(403);

    const crossActorIntentId = await createTier2Intent(adminClient, {
      action: "org:entitlement:update",
      orgId: org.id,
      payload: [payload],
    });

    const crossActorDenied = await secondAdminClient.put(`/api/orgs/${org.id}/entitlements`, {
      json: {
        ...payload,
        intentId: crossActorIntentId,
      },
    });
    expect(crossActorDenied.status).toBe(403);

    const expiredIntentId = await createTier2Intent(adminClient, {
      action: "org:entitlement:update",
      orgId: org.id,
      payload: [payload],
    });

    await prisma.mutationIntent.update({
      where: { id: expiredIntentId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const expired = await adminClient.put(`/api/orgs/${org.id}/entitlements`, {
      json: {
        ...payload,
        intentId: expiredIntentId,
      },
    });
    expect(expired.status).toBe(403);

    const memberIntent = await memberClient.post<{ error?: string }>("/api/security/intents", {
      json: {
        action: "org:entitlement:update",
        orgId: org.id,
        payload: [payload],
      },
    });
    expect(memberIntent.status).toBe(403);

    const intentDeniedAudits = await prisma.auditLog.findMany({
      where: {
        action: "MUTATION_INTENT_DENIED",
        orgId: org.id,
      },
    });

    expect(intentDeniedAudits.length).toBeGreaterThanOrEqual(3);
  });

  test("step-up reauth is enforced for intent creation when configured", async () => {
    process.env.STEP_UP_TIER2 = "REAUTH";

    const owner = await createUser({
      email: "intent-owner@example.com",
      password: "IntentOwnerPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Intent Stepup Org",
      slug: "intent-stepup-org",
      createdById: owner.id,
    });

    await createMembership({ userId: owner.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: owner.id }, data: { defaultOrgId: org.id } });

    let denied = false;
    try {
      await createMutationIntent({
        actorId: owner.id,
        action: "platform:config:update",
        payload: {
          freezeProvisioning: false,
        },
      });
    } catch (error) {
      denied = error instanceof MutationIntentError && error.httpStatus === 401;
    }

    expect(denied).toBe(true);

    const allowed = await createMutationIntent({
      actorId: owner.id,
      action: "platform:config:update",
      payload: {
        freezeProvisioning: false,
      },
      stepUp: {
        password: "IntentOwnerPass123!",
      },
    });

    expect(allowed.id).toBeTruthy();

    process.env.STEP_UP_TIER2 = "NONE";
  });
});
