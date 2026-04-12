import { OrgRole, ProvisioningJobStatus } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";
import { createTier2Intent } from "../helpers/security";
import { hashCanonicalPayload } from "../../src/lib/security/canonical";
import { signJobEnvelope } from "../../src/lib/provisioning/job-envelope";
import { queueProvisioningJob } from "../../src/lib/provisioning/jobs";
import { setProvisioningProviderForTests, type ProvisioningProvider } from "../../src/lib/provisioning/provider";
import { processProvisioningQueue } from "../../workers/provisioning-engine";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

function buildSignedJob(input: { id: string; orgId: string; payload: Record<string, unknown>; maxAttempts?: number }) {
  const createdAt = new Date();
  const payloadHash = hashCanonicalPayload(input.payload);
  const signature = signJobEnvelope({
    jobId: input.id,
    orgId: input.orgId,
    type: "PROVISION",
    payloadHash,
    createdAt: createdAt.toISOString(),
    expiresAt: null,
    envelopeVersion: 1,
  });

  return {
    createdAt,
    payloadHash,
    signature,
    maxAttempts: input.maxAttempts || 3,
  };
}

describe("Provisioning jobs integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    setProvisioningProviderForTests(null);
  });

  test("invalid signature is dead-lettered", async () => {
    const org = await createOrganization({
      name: "Signed Job Org",
      slug: "signed-job-org",
    });

    const signed = buildSignedJob({
      id: "job-invalid-signature",
      orgId: org.id,
      payload: { action: "provision" },
    });

    await prisma.provisioningJob.create({
      data: {
        id: "job-invalid-signature",
        orgId: org.id,
        source: "SYSTEM",
        type: "PROVISION",
        status: ProvisioningJobStatus.PENDING,
        maxAttempts: signed.maxAttempts,
        idempotencyKey: "job-invalid-signature-key",
        envelopeVersion: 1,
        payload: { action: "provision" },
        payloadHash: signed.payloadHash,
        signature: "bad-signature",
        createdAt: signed.createdAt,
      },
    });

    const processed = await processProvisioningQueue(10);
    expect(processed).toBe(1);

    const updated = await prisma.provisioningJob.findUnique({ where: { id: "job-invalid-signature" } });
    expect(updated?.status).toBe(ProvisioningJobStatus.DEAD);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "PROVISIONING_JOB_SIGNATURE_INVALID",
        orgId: org.id,
      },
    });

    expect(audit).toBeTruthy();
  });

  test("retry scheduling, max-attempt dead-letter, and lock safety", async () => {
    const org = await createOrganization({
      name: "Retry Job Org",
      slug: "retry-job-org",
    });

    let executeCalls = 0;
    const retryProvider: ProvisioningProvider = {
      async execute() {
        executeCalls += 1;
        return {
          kind: "RETRYABLE_FAILURE",
          message: "transient",
        };
      },
    };

    setProvisioningProviderForTests(retryProvider);

    const signed = buildSignedJob({
      id: "job-retry",
      orgId: org.id,
      payload: { action: "provision" },
      maxAttempts: 2,
    });

    await prisma.provisioningJob.create({
      data: {
        id: "job-retry",
        orgId: org.id,
        source: "SYSTEM",
        type: "PROVISION",
        status: ProvisioningJobStatus.PENDING,
        maxAttempts: 2,
        idempotencyKey: "job-retry-key",
        envelopeVersion: 1,
        payload: { action: "provision" },
        payloadHash: signed.payloadHash,
        signature: signed.signature,
        createdAt: signed.createdAt,
      },
    });

    await processProvisioningQueue(10);

    const afterFirst = await prisma.provisioningJob.findUnique({ where: { id: "job-retry" } });
    expect(afterFirst?.status).toBe(ProvisioningJobStatus.PENDING);
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst?.notBefore).toBeTruthy();

    await prisma.provisioningJob.update({
      where: { id: "job-retry" },
      data: {
        notBefore: new Date(Date.now() - 1_000),
      },
    });

    await processProvisioningQueue(10);

    const afterSecond = await prisma.provisioningJob.findUnique({ where: { id: "job-retry" } });
    expect(afterSecond?.status).toBe(ProvisioningJobStatus.DEAD);
    expect(afterSecond?.attempts).toBe(2);

    const successProvider: ProvisioningProvider = {
      async execute() {
        executeCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          kind: "SUCCESS",
        };
      },
    };

    setProvisioningProviderForTests(successProvider);

    const signed2 = buildSignedJob({
      id: "job-lock",
      orgId: org.id,
      payload: { action: "provision" },
    });

    await prisma.provisioningJob.create({
      data: {
        id: "job-lock",
        orgId: org.id,
        source: "SYSTEM",
        type: "PROVISION",
        status: ProvisioningJobStatus.PENDING,
        maxAttempts: 3,
        idempotencyKey: "job-lock-key",
        envelopeVersion: 1,
        payload: { action: "provision" },
        payloadHash: signed2.payloadHash,
        signature: signed2.signature,
        createdAt: signed2.createdAt,
      },
    });

    await Promise.all([processProvisioningQueue(1), processProvisioningQueue(1)]);

    const lockJob = await prisma.provisioningJob.findUnique({ where: { id: "job-lock" } });
    expect(lockJob?.status).toBe(ProvisioningJobStatus.SUCCEEDED);

    const retryEvents = await prisma.provisioningJobEvent.findMany({
      where: {
        jobId: "job-lock",
      },
    });
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);

    expect(executeCalls).toBeGreaterThanOrEqual(3);

    const dedupeKey = "idempotency:duplicate:1";
    await queueProvisioningJob({
      orgId: org.id,
      source: "SYSTEM",
      type: "PROVISION",
      payload: { same: true },
      idempotencyKey: dedupeKey,
    });
    await queueProvisioningJob({
      orgId: org.id,
      source: "SYSTEM",
      type: "PROVISION",
      payload: { same: true },
      idempotencyKey: dedupeKey,
    });

    const deduped = await prisma.provisioningJob.findMany({
      where: {
        idempotencyKey: dedupeKey,
      },
    });
    expect(deduped).toHaveLength(1);
  });

  test("tier-2 retry/cancel operations require valid intent", async () => {
    const admin = await createUser({
      email: "job-admin@example.com",
      password: "JobAdminPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Ops Job Org",
      slug: "ops-job-org",
      createdById: admin.id,
    });

    await createMembership({ userId: admin.id, orgId: org.id, role: OrgRole.ADMIN });
    await prisma.user.update({ where: { id: admin.id }, data: { defaultOrgId: org.id } });

    const signedDead = buildSignedJob({
      id: "job-dead",
      orgId: org.id,
      payload: { action: "deprovision" },
    });

    const signedPending = buildSignedJob({
      id: "job-pending",
      orgId: org.id,
      payload: { action: "provision" },
    });

    await prisma.provisioningJob.createMany({
      data: [
        {
          id: "job-dead",
          orgId: org.id,
          source: "SYSTEM",
          type: "DEPROVISION",
          status: ProvisioningJobStatus.DEAD,
          attempts: 3,
          maxAttempts: 3,
          idempotencyKey: "job-dead-key",
          envelopeVersion: 1,
          payload: { action: "deprovision" },
          payloadHash: signedDead.payloadHash,
          signature: signedDead.signature,
          createdAt: signedDead.createdAt,
        },
        {
          id: "job-pending",
          orgId: org.id,
          source: "SYSTEM",
          type: "PROVISION",
          status: ProvisioningJobStatus.PENDING,
          attempts: 0,
          maxAttempts: 3,
          idempotencyKey: "job-pending-key",
          envelopeVersion: 1,
          payload: { action: "provision" },
          payloadHash: signedPending.payloadHash,
          signature: signedPending.signature,
          createdAt: signedPending.createdAt,
        },
      ],
    });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, admin.id);

    const retryDenied = await client.post(`/api/platform/ops/jobs/job-dead/retry`, {
      json: {},
    });
    expect(retryDenied.status).toBe(400);

    const retryIntentId = await createTier2Intent(client, {
      action: "ops:job:retry",
      orgId: org.id,
      payload: {
        jobId: "job-dead",
        operation: "retry",
        reason: null,
      },
    });

    const retryAllowed = await client.post(`/api/platform/ops/jobs/job-dead/retry`, {
      json: {
        intentId: retryIntentId,
      },
    });
    expect(retryAllowed.status).toBe(200);

    const cancelIntentId = await createTier2Intent(client, {
      action: "ops:job:cancel",
      orgId: org.id,
      payload: {
        jobId: "job-pending",
        operation: "cancel",
        reason: null,
      },
    });

    const cancelAllowed = await client.post(`/api/platform/ops/jobs/job-pending/cancel`, {
      json: {
        intentId: cancelIntentId,
      },
    });
    expect(cancelAllowed.status).toBe(200);

    const canceled = await prisma.provisioningJob.findUnique({ where: { id: "job-pending" } });
    expect(canceled?.status).toBe(ProvisioningJobStatus.CANCELED);
  });
});
