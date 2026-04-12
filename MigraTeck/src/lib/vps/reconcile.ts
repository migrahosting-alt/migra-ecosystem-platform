import { Prisma, VpsActionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeVpsAuditEvent } from "@/lib/vps/audit";
import { executeActionJob, normalizeJobStatus } from "@/lib/vps/jobs";
import { getPrimaryProviderBinding } from "@/lib/vps/queries";
import { getProvider, type ProviderActionResult } from "@/lib/vps/providers";
import { syncServer } from "@/lib/vps/sync";

const DEFAULT_POLL_DELAY_MS = 15_000;
const MAX_POLL_ATTEMPTS = 120;

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function nextPollTime() {
  return new Date(Date.now() + DEFAULT_POLL_DELAY_MS);
}

function auditEventTypeForStatus(action: string, status: VpsActionStatus) {
  switch (status) {
    case VpsActionStatus.QUEUED:
      return `${action}_QUEUED`;
    case VpsActionStatus.RUNNING:
      return `${action}_RUNNING`;
    case VpsActionStatus.SUCCEEDED:
      return `${action}_SUCCEEDED`;
    case VpsActionStatus.FAILED:
      return `${action}_FAILED`;
    case VpsActionStatus.CANCELED:
      return `${action}_CANCELED`;
    default:
      return `${action}_UPDATED`;
  }
}

async function markJobFailed(jobId: string, message: string) {
  const updated = await prisma.vpsActionJob.update({
    where: { id: jobId },
    data: {
      status: VpsActionStatus.FAILED,
      errorJson: jsonValue({ message }),
      finishedAt: new Date(),
      nextPollAt: null,
    },
  });

  await writeVpsAuditEvent({
    orgId: updated.orgId,
    serverId: updated.serverId,
    actorUserId: updated.requestedByUserId,
    eventType: auditEventTypeForStatus(updated.action, VpsActionStatus.FAILED),
    severity: "CRITICAL",
    relatedJobId: updated.id,
    metadataJson: { message },
  });

  return updated;
}

async function reconcileJobResult(jobId: string, result: ProviderActionResult) {
  const nextStatus = normalizeJobStatus(result);

  const updated = await prisma.vpsActionJob.update({
    where: { id: jobId },
    data: {
      status: nextStatus,
      providerRequestId: result.providerRequestId || null,
      providerTaskId: result.providerTaskId || result.providerRequestId || null,
      resultJson: jsonValue(result.raw || result),
      errorJson: nextStatus === VpsActionStatus.FAILED ? jsonValue({ message: result.message || "provider_action_failed" }) : Prisma.JsonNull,
      finishedAt: nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? null : new Date(),
      nextPollAt: nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? nextPollTime() : null,
    },
  });

  if (nextStatus === VpsActionStatus.SUCCEEDED && updated.action !== "OPEN_CONSOLE_SESSION" && updated.action !== "MANUAL_SYNC") {
    await syncServer(updated.serverId);
  }

  await writeVpsAuditEvent({
    orgId: updated.orgId,
    serverId: updated.serverId,
    actorUserId: updated.requestedByUserId,
    eventType: auditEventTypeForStatus(updated.action, nextStatus),
    severity: nextStatus === VpsActionStatus.FAILED ? "CRITICAL" : nextStatus === VpsActionStatus.SUCCEEDED ? "INFO" : "WARNING",
    relatedJobId: updated.id,
    metadataJson: result,
  });

  return updated;
}

async function processClaimedVpsActionJob(jobId: string) {
  const job = await prisma.vpsActionJob.findUnique({
    where: { id: jobId },
    include: {
      server: {
        include: {
          providerBindings: true,
        },
      },
    },
  });

  if (!job) {
    return false;
  }

  if (!job.providerTaskId) {
    await markJobFailed(job.id, "Missing provider task id for reconciliation.");
    return true;
  }

  if (job.retryCount >= MAX_POLL_ATTEMPTS) {
    await markJobFailed(job.id, "Provider action polling exhausted max attempts.");
    return true;
  }

  const binding = getPrimaryProviderBinding(job.server);
  if (!binding) {
    await markJobFailed(job.id, "Missing provider binding for reconciliation.");
    return true;
  }

  const provider = getProvider(binding.providerSlug);
  const result = await provider.getActionStatus(
    {
      providerSlug: binding.providerSlug,
      providerServerId: binding.providerServerId,
      instanceId: job.server.instanceId,
      publicIpv4: job.server.publicIpv4,
      name: job.server.name,
    },
    {
      taskId: job.providerTaskId,
      action: job.action,
      requestJson: job.requestJson,
    },
  );

  await reconcileJobResult(job.id, result);
  return true;
}

async function hasEarlierPendingServerJob(candidate: { id: string; serverId: string; createdAt: Date }) {
  const existing = await prisma.vpsActionJob.findFirst({
    where: {
      serverId: candidate.serverId,
      id: { not: candidate.id },
      status: {
        in: [VpsActionStatus.QUEUED, VpsActionStatus.RUNNING],
      },
      OR: [
        { providerTaskId: { not: null } },
        { startedAt: { not: null } },
        { createdAt: { lt: candidate.createdAt } },
      ],
    },
    select: { id: true },
  });

  return Boolean(existing);
}

async function processPendingVpsActionJobs(limit: number) {
  const now = new Date();
  const candidates = await prisma.vpsActionJob.findMany({
    where: {
      status: VpsActionStatus.QUEUED,
      providerTaskId: null,
      finishedAt: null,
      OR: [
        { nextPollAt: null },
        { nextPollAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      serverId: true,
      createdAt: true,
    },
  });

  let processed = 0;

  for (const candidate of candidates) {
    if (await hasEarlierPendingServerJob(candidate)) {
      continue;
    }

    const claimed = await prisma.vpsActionJob.updateMany({
      where: {
        id: candidate.id,
        status: VpsActionStatus.QUEUED,
        providerTaskId: null,
        finishedAt: null,
        OR: [
          { nextPollAt: null },
          { nextPollAt: { lte: now } },
        ],
      },
      data: {
        nextPollAt: nextPollTime(),
      },
    });

    if (claimed.count !== 1) {
      continue;
    }

    try {
      await executeActionJob(candidate.id);
    } catch {
      // executeActionJob already records terminal failure state and audit
    }

    processed += 1;
  }

  return processed;
}

export async function processVpsActionQueue(limit = 25) {
  const pendingProcessed = await processPendingVpsActionJobs(limit);
  const now = new Date();
  const candidates = await prisma.vpsActionJob.findMany({
    where: {
      status: {
        in: [VpsActionStatus.QUEUED, VpsActionStatus.RUNNING],
      },
      providerTaskId: {
        not: null,
      },
      nextPollAt: {
        lte: now,
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
    },
  });

  let processed = 0;

  for (const candidate of candidates) {
    const claimed = await prisma.vpsActionJob.updateMany({
      where: {
        id: candidate.id,
        status: {
          in: [VpsActionStatus.QUEUED, VpsActionStatus.RUNNING],
        },
        providerTaskId: {
          not: null,
        },
        nextPollAt: {
          lte: now,
        },
      },
      data: {
        retryCount: { increment: 1 },
        nextPollAt: nextPollTime(),
      },
    });

    if (claimed.count !== 1) {
      continue;
    }

    const didProcess = await processClaimedVpsActionJob(candidate.id);
    if (didProcess) {
      processed += 1;
    }
  }

  return pendingProcessed + processed;
}