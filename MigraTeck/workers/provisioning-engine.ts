import { hostname } from "node:os";
import { ProvisioningJobStatus } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { provisioningJobBackoffBaseSeconds, provisioningWorkerProductAllowlist } from "@/lib/env";
import { getPlatformConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { verifyJobEnvelope } from "@/lib/provisioning/job-envelope";
import { appendProvisioningJobEvent } from "@/lib/provisioning/jobs";
import { getProvisioningProvider } from "@/lib/provisioning/provider";

const DEFAULT_INTERVAL_MS = 10 * 1000;
const DEFAULT_BATCH_SIZE = 25;

function workerId(): string {
  return process.env.WORKER_INSTANCE_ID || `${hostname()}:${process.pid}`;
}

function nextBackoffDate(attempts: number): Date {
  const seconds = Math.min(60 * 60, provisioningJobBackoffBaseSeconds * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + seconds * 1000);
}

function getJobProductLane(job: { payload: unknown }): string | null {
  if (!job.payload || typeof job.payload !== "object") {
    return null;
  }

  const payload = job.payload as Record<string, unknown>;
  if (typeof payload.productLane === "string" && payload.productLane.trim()) {
    return payload.productLane.trim();
  }
  if (typeof payload.product === "string" && payload.product.trim()) {
    return payload.product.trim();
  }
  return null;
}

function isAllowedForBackgroundProcessing(job: { payload: unknown }): boolean {
  if (provisioningWorkerProductAllowlist.size === 0) {
    return true;
  }

  const lane = getJobProductLane(job);
  return lane ? provisioningWorkerProductAllowlist.has(lane) : false;
}

async function markJobDead(jobId: string, message: string): Promise<void> {
  await prisma.provisioningJob.update({
    where: { id: jobId },
    data: {
      status: ProvisioningJobStatus.DEAD,
      lastError: message,
      lastErrorAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      finishedAt: new Date(),
    },
  });

  await appendProvisioningJobEvent({
    jobId,
    status: ProvisioningJobStatus.DEAD,
    message,
  });
}

async function processClaimedJob(jobId: string, currentWorker: string): Promise<"processed" | "missing" | "skipped"> {
  const provider = getProvisioningProvider();
  const now = new Date();

  const job = await prisma.provisioningJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return "missing";
  }

  if (job.expiresAt && job.expiresAt <= now) {
    await markJobDead(job.id, "job_expired");

    await writeAuditLog({
      actorId: job.createdByActorId || null,
      orgId: job.orgId,
      action: "PROVISIONING_JOB_DEAD_LETTERED",
      resourceType: "provisioning_job",
      resourceId: job.id,
      riskTier: 2,
      metadata: {
        reason: "job_expired",
        attempts: job.attempts,
      },
    });

    return "processed";
  }

  const signatureValid = verifyJobEnvelope({
    jobId: job.id,
    orgId: job.orgId,
    type: job.type,
    payloadHash: job.payloadHash,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt?.toISOString() || null,
    envelopeVersion: job.envelopeVersion,
    signature: job.signature,
  });

  if (!signatureValid) {
    await markJobDead(job.id, "invalid_signature");

    await writeAuditLog({
      actorId: job.createdByActorId || null,
      orgId: job.orgId,
      action: "PROVISIONING_JOB_SIGNATURE_INVALID",
      resourceType: "provisioning_job",
      resourceId: job.id,
      riskTier: 2,
    });

    return "processed";
  }

  const result = await provider.execute({
    job,
    idempotencyKey: job.idempotencyKey,
    workerId: currentWorker,
  });

  if (result.kind === "SUCCESS") {
    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: ProvisioningJobStatus.SUCCEEDED,
        lastError: null,
        lastErrorAt: null,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });

    await appendProvisioningJobEvent({
      jobId: job.id,
      status: ProvisioningJobStatus.SUCCEEDED,
      message: "succeeded",
      metadata: {
        workerId: currentWorker,
        details: result.metadata || null,
      },
    });

    await writeAuditLog({
      actorId: job.createdByActorId || null,
      orgId: job.orgId,
      action: "PROVISIONING_JOB_SUCCEEDED",
      resourceType: "provisioning_job",
      resourceId: job.id,
      riskTier: 1,
      metadata: {
        source: job.source,
        type: job.type,
        attempts: job.attempts,
        workerId: currentWorker,
      },
    });

    return "processed";
  }

  const retryable = result.kind === "RETRYABLE_FAILURE";
  const attempts = job.attempts;
  const exhausted = attempts >= job.maxAttempts;

  if (retryable && !exhausted) {
    const notBefore = nextBackoffDate(attempts);

    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: ProvisioningJobStatus.PENDING,
        notBefore,
        lastError: result.message,
        lastErrorAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });

    await appendProvisioningJobEvent({
      jobId: job.id,
      status: ProvisioningJobStatus.PENDING,
      message: "retry_scheduled",
      metadata: {
        nextRunAt: notBefore.toISOString(),
        reason: result.message,
        details: result.metadata || null,
      },
    });

    await writeAuditLog({
      actorId: job.createdByActorId || null,
      orgId: job.orgId,
      action: "PROVISIONING_JOB_RETRY_SCHEDULED",
      resourceType: "provisioning_job",
      resourceId: job.id,
      riskTier: 1,
      metadata: {
        attempts,
        maxAttempts: job.maxAttempts,
        nextRunAt: notBefore,
        reason: result.message,
      },
    });

    return "processed";
  }

  await markJobDead(job.id, result.message);

  await writeAuditLog({
    actorId: job.createdByActorId || null,
    orgId: job.orgId,
    action: "PROVISIONING_JOB_DEAD_LETTERED",
    resourceType: "provisioning_job",
    resourceId: job.id,
    riskTier: 2,
    metadata: {
      attempts,
      maxAttempts: job.maxAttempts,
      retryable,
      reason: result.message,
    },
  });

  return "processed";
}

async function processProvisioningJobs(limit = DEFAULT_BATCH_SIZE): Promise<number> {
  const now = new Date();
  const currentWorker = workerId();

  const candidates = await prisma.provisioningJob.findMany({
    where: {
      status: ProvisioningJobStatus.PENDING,
      OR: [{ notBefore: null }, { notBefore: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;

  for (const candidate of candidates) {
    if (!isAllowedForBackgroundProcessing(candidate)) {
      continue;
    }

    const claimed = await prisma.provisioningJob.updateMany({
      where: {
        id: candidate.id,
        status: ProvisioningJobStatus.PENDING,
        OR: [{ notBefore: null }, { notBefore: { lte: now } }],
      },
      data: {
        status: ProvisioningJobStatus.RUNNING,
        attempts: { increment: 1 },
        lockedAt: now,
        lockedBy: currentWorker,
        startedAt: candidate.startedAt || now,
      },
    });

    if (claimed.count !== 1) {
      continue;
    }

    const job = await prisma.provisioningJob.findUnique({ where: { id: candidate.id } });
    if (!job) {
      continue;
    }

    processed += 1;
    await processClaimedJob(job.id, currentWorker);
  }

  return processed;
}

export async function processProvisioningJobIds(jobIds: string[], requestedWorkerId?: string): Promise<number> {
  const currentWorker = requestedWorkerId || workerId();
  const now = new Date();
  let processed = 0;

  for (const jobId of jobIds) {
    const claimed = await prisma.provisioningJob.updateMany({
      where: {
        id: jobId,
        status: ProvisioningJobStatus.PENDING,
        OR: [{ notBefore: null }, { notBefore: { lte: now } }],
      },
      data: {
        status: ProvisioningJobStatus.RUNNING,
        attempts: { increment: 1 },
        lockedAt: now,
        lockedBy: currentWorker,
        startedAt: now,
      },
    });

    if (claimed.count !== 1) {
      continue;
    }

    const outcome = await processClaimedJob(jobId, currentWorker);
    if (outcome === "processed") {
      processed += 1;
    }
  }

  return processed;
}

export async function processProvisioningQueue(limit = DEFAULT_BATCH_SIZE): Promise<number> {
  const config = await getPlatformConfig();
  if (config.maintenanceMode || config.pauseProvisioningWorker) {
    await writeAuditLog({
      action: "PROVISIONING_WORKER_HEARTBEAT",
      resourceType: "worker",
      resourceId: "provisioning-engine",
      riskTier: 0,
      metadata: {
        skipped: true,
        maintenanceMode: config.maintenanceMode,
        pauseProvisioningWorker: config.pauseProvisioningWorker,
      },
    });

    return 0;
  }

  const processed = await processProvisioningJobs(limit);

  await writeAuditLog({
    action: "PROVISIONING_WORKER_HEARTBEAT",
    resourceType: "worker",
    resourceId: "provisioning-engine",
    riskTier: 0,
    metadata: {
      processed,
      workerId: workerId(),
    },
  });

  return processed;
}

export function startProvisioningEngineWorker(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  const handle = setInterval(() => {
    void processProvisioningQueue().catch((error) => {
      console.error("provisioning worker iteration failed", error);
    });
  }, intervalMs);

  return handle;
}

if (process.env.RUN_PROVISIONING_ENGINE_WORKER === "true") {
  void processProvisioningQueue().catch((error) => {
    console.error("provisioning worker startup failed", error);
    process.exitCode = 1;
  });

  startProvisioningEngineWorker();
}
