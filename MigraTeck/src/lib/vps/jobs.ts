import { Prisma, VpsActionStatus, type VpsActionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getControlPlaneRestriction } from "@/lib/vps/access";
import { assertProviderActionSupport } from "@/lib/vps/provider-support";
import { writeVpsAuditEvent } from "@/lib/vps/audit";
import { syncVpsAlertState } from "@/lib/vps/alerts";
import { getPrimaryProviderBinding } from "@/lib/vps/queries";
import { syncServer } from "@/lib/vps/sync";
import { getProvider } from "@/lib/vps/providers";
import type { ProviderActionResult } from "@/lib/vps/providers";
import { classifyProviderHealth, healthyProviderState } from "@/lib/vps/server-state";

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export function normalizeJobStatus(result: ProviderActionResult) {
  if (!result.accepted || result.status === "FAILED") {
    return VpsActionStatus.FAILED;
  }

  if (result.status === "PENDING" || result.status === "QUEUED") {
    return VpsActionStatus.QUEUED;
  }

  if (result.status === "RUNNING") {
    return VpsActionStatus.RUNNING;
  }

  return VpsActionStatus.SUCCEEDED;
}

function auditEventTypeForJobStatus(action: VpsActionType, status: VpsActionStatus) {
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

function auditSeverityForJobStatus(status: VpsActionStatus) {
  switch (status) {
    case VpsActionStatus.FAILED:
      return "CRITICAL" as const;
    case VpsActionStatus.RUNNING:
    case VpsActionStatus.QUEUED:
      return "WARNING" as const;
    default:
      return "INFO" as const;
  }
}

export async function createActionJob(input: {
  serverId: string;
  orgId: string;
  action: VpsActionType;
  requestedByUserId: string;
  requestJson?: unknown | undefined;
}) {
  return prisma.vpsActionJob.create({
    data: {
      serverId: input.serverId,
      orgId: input.orgId,
      action: input.action,
      requestedByUserId: input.requestedByUserId,
      requestJson: input.requestJson === undefined ? Prisma.JsonNull : jsonValue(input.requestJson),
    },
  });
}

export async function executeActionJob(jobId: string) {
  const job = await prisma.vpsActionJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      server: {
        include: {
          providerBindings: true,
        },
      },
    },
  });

  const binding = getPrimaryProviderBinding(job.server);
  if (!binding) {
    throw new Error("Missing provider binding");
  }

  const provider = getProvider(binding.providerSlug);
  const providerRef = {
    providerSlug: binding.providerSlug,
    providerServerId: binding.providerServerId,
    instanceId: job.server.instanceId,
    publicIpv4: job.server.publicIpv4,
    name: job.server.name,
  };

  await prisma.vpsActionJob.update({
    where: { id: jobId },
    data: {
      status: VpsActionStatus.RUNNING,
      startedAt: new Date(),
      attemptCount: { increment: 1 },
    },
  });

  try {
    const restriction = getControlPlaneRestriction({
      providerHealthState: job.server.providerHealthState,
      action: job.action,
    });
    if (restriction.blocked) {
      throw new Error(restriction.reason);
    }

    assertProviderActionSupport({
      providerSlug: binding.providerSlug,
      capabilities: provider.capabilities,
      action: job.action,
    });

    let result: ProviderActionResult;
    const requestJson = job.requestJson && typeof job.requestJson === "object" ? job.requestJson as Record<string, unknown> : {};

    switch (job.action) {
      case "POWER_ON":
        result = await provider.powerOn(providerRef);
        break;
      case "POWER_OFF":
        result = await provider.powerOff(providerRef);
        break;
      case "REBOOT":
        result = await provider.reboot({ ...providerRef, hard: false });
        break;
      case "HARD_REBOOT":
        result = await provider.reboot({ ...providerRef, hard: true });
        break;
      case "ENABLE_RESCUE":
        result = await provider.enableRescue(providerRef);
        break;
      case "DISABLE_RESCUE":
        result = await provider.disableRescue(providerRef);
        break;
      case "REBUILD":
        result = await provider.rebuild(providerRef, {
          imageSlug: typeof requestJson.imageSlug === "string" ? requestJson.imageSlug : undefined,
          hostname: typeof requestJson.hostname === "string" ? requestJson.hostname : undefined,
          sshKeys: Array.isArray(requestJson.sshKeys) ? requestJson.sshKeys.filter((value): value is string => typeof value === "string") : undefined,
          reason: typeof requestJson.reason === "string" ? requestJson.reason : undefined,
        });
        break;
      case "OPEN_CONSOLE_SESSION": {
        const session = await provider.createConsoleSession(providerRef, {
          actorUserId: job.requestedByUserId,
          viewOnly: false,
        });

        await prisma.vpsConsoleSession.create({
          data: {
            serverId: job.serverId,
            providerSessionId: session.sessionId || null,
            launchUrl: session.launchUrl || null,
            tokenPreview: session.token ? session.token.slice(0, 6) : null,
            status: session.supported ? "READY" : "FAILED",
            createdByUserId: job.requestedByUserId,
            viewOnly: session.mode === "VIEW_ONLY",
            expiresAt: session.expiresAt ? new Date(session.expiresAt) : null,
            lastConnectedAt: session.supported ? new Date() : null,
          },
        });

        result = {
          accepted: session.supported,
          status: session.status === "PENDING" ? "PENDING" : session.supported ? "SUCCEEDED" : "FAILED",
          message: session.message,
          providerTaskId: session.sessionId,
          raw: session.raw || session,
        };
        break;
      }
      case "CREATE_SNAPSHOT":
        result = await provider.createSnapshot(providerRef, {
          name: typeof requestJson.name === "string" ? requestJson.name : "snapshot",
        });
        break;
      case "RESTORE_SNAPSHOT":
        result = await provider.restoreSnapshot(providerRef, {
          snapshotId: typeof requestJson.snapshotId === "string" ? requestJson.snapshotId : "",
        });
        break;
      case "DELETE_SNAPSHOT":
        result = await provider.deleteSnapshot(providerRef, {
          snapshotId: typeof requestJson.snapshotId === "string" ? requestJson.snapshotId : "",
        });
        break;
      case "UPDATE_BACKUP_POLICY":
        result = await provider.updateBackupPolicy(providerRef, {
          policy: {
            enabled: Boolean(requestJson.enabled),
            frequency: typeof requestJson.frequency === "string" ? requestJson.frequency : "daily",
            retentionCount: typeof requestJson.retentionCount === "number" ? requestJson.retentionCount : 7,
            encrypted: requestJson.encrypted !== false,
            crossRegion: Boolean(requestJson.crossRegion),
            ...(typeof requestJson.backupWindow === "string" ? { backupWindow: requestJson.backupWindow } : {}),
            ...(typeof requestJson.region === "string" ? { region: requestJson.region } : {}),
          },
        });
        break;
      case "UPDATE_FIREWALL":
      case "ROLLBACK_FIREWALL":
        throw new Error("Firewall changes should use the dedicated firewall apply service");
      case "MANUAL_SYNC":
        await syncServer(job.serverId);
        result = {
          accepted: true,
          status: "SUCCEEDED",
          message: "manual_sync_completed",
        };
        break;
      default:
        throw new Error(`Unsupported action type: ${job.action}`);
    }

    const nextStatus = normalizeJobStatus(result);

    await prisma.vpsServer.update({
      where: { id: job.serverId },
      data: {
        providerHealthState: healthyProviderState().providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: null,
      },
    });

    await prisma.vpsActionJob.update({
      where: { id: jobId },
      data: {
        status: nextStatus,
        providerRequestId: result.providerRequestId || null,
        providerTaskId: result.providerTaskId || result.providerRequestId || null,
        resultJson: jsonValue(result.raw || result),
        errorJson: nextStatus === VpsActionStatus.FAILED ? jsonValue({ message: result.message || "provider_action_failed" }) : Prisma.JsonNull,
        finishedAt: nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? null : new Date(),
        nextPollAt: nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? new Date(Date.now() + 15000) : null,
      },
    });

    if (nextStatus === VpsActionStatus.SUCCEEDED && job.action !== "OPEN_CONSOLE_SESSION" && job.action !== "MANUAL_SYNC") {
      await syncServer(job.serverId);
    }

    await writeVpsAuditEvent({
      orgId: job.orgId,
      serverId: job.serverId,
      actorUserId: job.requestedByUserId,
      eventType: auditEventTypeForJobStatus(job.action, nextStatus),
      severity: auditSeverityForJobStatus(nextStatus),
      relatedJobId: job.id,
      metadataJson: result,
    });

    await syncVpsAlertState(job.serverId, {
      actorUserId: job.requestedByUserId,
    });

    return prisma.vpsActionJob.findUniqueOrThrow({ where: { id: jobId } });
  } catch (error) {
    const health = classifyProviderHealth(error);
    await prisma.vpsServer.update({
      where: { id: job.serverId },
      data: {
        providerHealthState: health.providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: health.providerError,
      },
    });

    await prisma.vpsActionJob.update({
      where: { id: jobId },
      data: {
        status: VpsActionStatus.FAILED,
        errorJson: jsonValue({
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        finishedAt: new Date(),
      },
    });

    await writeVpsAuditEvent({
      orgId: job.orgId,
      serverId: job.serverId,
      actorUserId: job.requestedByUserId,
      eventType: `${job.action}_FAILED`,
      severity: "CRITICAL",
      relatedJobId: job.id,
      metadataJson: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });

    await syncVpsAlertState(job.serverId, {
      actorUserId: job.requestedByUserId,
    });

    throw error;
  }
}
