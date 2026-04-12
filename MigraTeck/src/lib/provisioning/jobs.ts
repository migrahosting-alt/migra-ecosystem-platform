import { Prisma, ProvisioningAction, ProvisioningJobSource, ProvisioningJobStatus, ProvisioningJobType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { provisioningJobDefaultMaxAttempts } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";
import { hashCanonicalPayload } from "@/lib/security/canonical";
import { prisma } from "@/lib/prisma";
import { signJobEnvelope } from "@/lib/provisioning/job-envelope";

export interface QueueProvisioningJobInput {
  orgId: string;
  createdByActorId?: string | null;
  source: ProvisioningJobSource;
  type: ProvisioningJobType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts?: number;
  notBefore?: Date | null;
  expiresAt?: Date | null;
  ip?: string;
  userAgent?: string;
}

export function mapProvisioningActionToJobType(action: ProvisioningAction): ProvisioningJobType {
  if (
    action === ProvisioningAction.ACCESS_GRANT ||
    action === ProvisioningAction.POD_CREATE ||
    action === ProvisioningAction.DNS_PROVISION ||
    action === ProvisioningAction.STORAGE_PROVISION ||
    action === ProvisioningAction.VOICE_PROVISION ||
    action === ProvisioningAction.MAIL_PROVISION ||
    action === ProvisioningAction.INTAKE_PROVISION ||
    action === ProvisioningAction.MARKET_PROVISION ||
    action === ProvisioningAction.PILOT_PROVISION
  ) {
    return ProvisioningJobType.PROVISION;
  }

  if (action === ProvisioningAction.POD_SCALE_DOWN) {
    return ProvisioningJobType.SCALE;
  }

  if (
    action === ProvisioningAction.ACCESS_RESTRICT ||
    action === ProvisioningAction.VOICE_DISABLE ||
    action === ProvisioningAction.MAIL_DISABLE ||
    action === ProvisioningAction.STORAGE_READ_ONLY
  ) {
    return ProvisioningJobType.RESTRICT;
  }

  return ProvisioningJobType.PROVISION;
}

export async function queueProvisioningJob(input: QueueProvisioningJobInput) {
  const id = randomUUID();
  const createdAt = new Date();
  const payloadHash = hashCanonicalPayload(input.payload);
  const envelopeVersion = 1;
  const signature = signJobEnvelope({
    jobId: id,
    orgId: input.orgId,
    type: input.type,
    payloadHash,
    createdAt: createdAt.toISOString(),
    expiresAt: input.expiresAt?.toISOString() || null,
    envelopeVersion,
  });

  const payload = JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue;

  try {
    const job = await prisma.provisioningJob.create({
      data: {
        id,
        orgId: input.orgId,
        createdByActorId: input.createdByActorId || null,
        source: input.source,
        type: input.type,
        status: ProvisioningJobStatus.PENDING,
        attempts: 0,
        maxAttempts: input.maxAttempts || provisioningJobDefaultMaxAttempts,
        notBefore: input.notBefore || null,
        idempotencyKey: input.idempotencyKey,
        envelopeVersion,
        payload,
        payloadHash,
        signature,
        expiresAt: input.expiresAt || null,
        createdAt,
      },
    });

    await prisma.provisioningJobEvent.create({
      data: {
        jobId: job.id,
        status: ProvisioningJobStatus.PENDING,
        message: "queued",
        metadata: {
          source: input.source,
          type: input.type,
        },
      },
    });

    await writeAuditLog({
      actorId: input.createdByActorId || null,
      orgId: input.orgId,
      action: "PROVISIONING_JOB_QUEUED",
      resourceType: "provisioning_job",
      resourceId: job.id,
      ip: input.ip,
      userAgent: input.userAgent,
      riskTier: 1,
      metadata: {
        source: job.source,
        type: job.type,
        status: job.status,
        idempotencyKey: job.idempotencyKey,
      },
    });

    return job;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.provisioningJob.findUnique({
        where: {
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (existing) {
        return existing;
      }
    }

    throw error;
  }
}

export async function appendProvisioningJobEvent(input: {
  jobId: string;
  status: ProvisioningJobStatus;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.provisioningJobEvent.create({
    data: {
      jobId: input.jobId,
      status: input.status,
      message: input.message,
      metadata: input.metadata ? (JSON.parse(JSON.stringify(input.metadata)) as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}
