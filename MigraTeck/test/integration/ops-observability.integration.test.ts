import { BillingWebhookEventStatus, OrgRole, ProvisioningJobStatus } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Ops observability integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("owner/admin can query ops explorer APIs and member is denied", async () => {
    const owner = await createUser({
      email: "ops-owner@example.com",
      password: "OpsOwnerPass123!",
      emailVerified: true,
    });

    const admin = await createUser({
      email: "ops-admin@example.com",
      password: "OpsAdminPass123!",
      emailVerified: true,
    });

    const member = await createUser({
      email: "ops-member@example.com",
      password: "OpsMemberPass123!",
      emailVerified: true,
    });

    const orgA = await createOrganization({
      name: "Ops Org A",
      slug: "ops-org-a",
      createdById: owner.id,
    });

    const orgB = await createOrganization({
      name: "Ops Org B",
      slug: "ops-org-b",
      createdById: owner.id,
    });

    await createMembership({ userId: owner.id, orgId: orgA.id, role: OrgRole.OWNER });
    await createMembership({ userId: admin.id, orgId: orgA.id, role: OrgRole.ADMIN });
    await createMembership({ userId: member.id, orgId: orgA.id, role: OrgRole.MEMBER });

    await prisma.user.update({ where: { id: owner.id }, data: { defaultOrgId: orgA.id } });
    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: orgA.id } });
    await prisma.user.update({ where: { id: member.id }, data: { defaultOrgId: orgA.id } });

    await prisma.auditLog.createMany({
      data: [
        {
          userId: owner.id,
          orgId: orgA.id,
          action: "AUTHZ_RISK_TIER_DENIED",
          entityType: "mutation",
          entityId: "org:invite:create",
          metadata: {
            actorId: owner.id,
            riskTier: 2,
            details: {
              route: "/api/orgs/123/invites",
              reason: "tier2_denied",
            },
          },
        },
        {
          userId: admin.id,
          orgId: orgA.id,
          action: "PROVISIONING_TASK_SUCCEEDED",
          entityType: "provisioning_task",
          entityId: "prov_123",
          metadata: {
            actorId: admin.id,
            riskTier: 1,
            details: {
              route: "/workers/provisioning",
            },
          },
        },
      ],
    });

    const webhookReceivedAt = new Date(Date.now() - 5_000);
    const webhookProcessedAt = new Date(Date.now() - 2_000);

    await prisma.billingWebhookEvent.create({
      data: {
        eventId: "evt_ops_1",
        eventType: "customer.subscription.updated",
        eventCreated: Math.floor(Date.now() / 1000),
        status: BillingWebhookEventStatus.PROCESSED,
        receivedAt: webhookReceivedAt,
        processedAt: webhookProcessedAt,
      },
    });

    await prisma.provisioningJob.create({
      data: {
        orgId: orgA.id,
        source: "MANUAL",
        type: "PROVISION",
        status: ProvisioningJobStatus.DEAD,
        attempts: 4,
        maxAttempts: 4,
        idempotencyKey: "ops-observability-job-1",
        envelopeVersion: 1,
        payload: {
          test: true,
        },
        payloadHash: "hash",
        signature: "signature",
        lastError: "provider timeout",
      },
    });

    await prisma.migraMarketSocialConnection.createMany({
      data: [
        {
          orgId: orgA.id,
          platform: "facebook",
          handle: "MigraTeck",
          accessModel: "oauth",
          publishMode: "api",
          status: "reconnect_required",
          credentialCiphertext: "ciphertext",
          tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
          lastVerifiedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
        {
          orgId: orgA.id,
          platform: "youtube",
          handle: "MigraTeck",
          accessModel: "oauth",
          publishMode: "api",
          status: "ready",
          credentialCiphertext: "ciphertext",
          tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
          lastVerifiedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
        {
          orgId: orgA.id,
          platform: "x",
          handle: "@MigraTeckHQ",
          accessModel: "oauth",
          publishMode: "api",
          status: "ready",
          credentialCiphertext: "ciphertext",
          tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
          lastVerifiedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    await prisma.auditLog.create({
      data: {
        userId: owner.id,
        orgId: orgA.id,
        action: "SOCIAL_CONNECTION_SYNC_WORKER_HEARTBEAT",
        entityType: "worker",
        entityId: "social-connection-sync",
        metadata: {
          actorId: owner.id,
          riskTier: 0,
          details: {
            processed: 2,
          },
        },
      },
    });

    const adminClient = new HttpClient(baseUrl);
    await createSessionForUser(adminClient, admin.id);

    const events = await adminClient.get<{
      events: Array<{ riskTier: number | null; action: string }>;
      drilldown: {
        webhooks: Array<{ eventId: string }>;
        provisioningRuns: Array<{ status: string }>;
      };
    }>(`/api/platform/ops/events?orgId=${orgA.id}&riskTier=2&include=all`, { withOrigin: false });

    expect(events.status).toBe(200);
    expect(events.body?.events.length).toBeGreaterThanOrEqual(1);
    expect(events.body?.events.every((event) => event.riskTier === 2)).toBe(true);
    expect(events.body?.drilldown.webhooks.find((event) => event.eventId === "evt_ops_1")).toBeTruthy();
    expect(events.body?.drilldown.provisioningRuns.find((event) => event.status === "DEAD")).toBeTruthy();

    const overview = await adminClient.get<{
      workers: {
        queue: { deadLetterCount: number };
      };
      slos: {
        stripeWebhookProcessingLatencyMs: { sampleSize: number };
      };
    }>(`/api/platform/ops/overview?orgId=${orgA.id}`, { withOrigin: false });

    expect(overview.status).toBe(200);
    expect(overview.body?.workers.queue.deadLetterCount).toBeGreaterThanOrEqual(1);
    expect(overview.body?.slos.stripeWebhookProcessingLatencyMs.sampleSize).toBeGreaterThanOrEqual(1);

    const health = await adminClient.get<{
      slos: {
        provisioningJobCompletionTimeMs: { sampleSize: number };
      };
      workers: {
        queueDepth: number;
        alerts: string[];
        lastSuccess: {
          socialConnectionSync: string | null;
        };
        socialConnections: {
          reconnectRequired: number;
          verificationStale: number;
          tokenExpiringSoon: number;
        };
      };
    }>(`/api/platform/ops/health?orgId=${orgA.id}`, { withOrigin: false });

    expect(health.status).toBe(200);
    expect(typeof health.body?.workers.queueDepth).toBe("number");
    expect(health.body?.workers.lastSuccess.socialConnectionSync).toBeTruthy();
    expect(health.body?.workers.socialConnections.reconnectRequired).toBeGreaterThanOrEqual(1);
    expect(health.body?.workers.socialConnections.verificationStale).toBeGreaterThanOrEqual(1);
    expect(health.body?.workers.socialConnections.tokenExpiringSoon).toBeGreaterThanOrEqual(1);
    expect(health.body?.workers.alerts).toContain("social_reconnect_required");
    expect(health.body?.workers.alerts).toContain("social_verification_stale");

    const memberClient = new HttpClient(baseUrl);
    await createSessionForUser(memberClient, member.id);

    const denied = await memberClient.get<{ error?: string }>(`/api/platform/ops/overview?orgId=${orgA.id}`, {
      withOrigin: false,
    });

    expect(denied.status).toBe(403);

    const ownerClient = new HttpClient(baseUrl);
    await createSessionForUser(ownerClient, owner.id);

    const ownerCrossOrg = await ownerClient.get<{ scope?: { orgId: string } }>(`/api/platform/ops/overview?orgId=${orgB.id}`, {
      withOrigin: false,
    });

    expect(ownerCrossOrg.status).toBe(200);
    expect(ownerCrossOrg.body?.scope?.orgId).toBe(orgB.id);
  });
});
