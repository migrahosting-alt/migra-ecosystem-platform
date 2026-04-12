import { ConsoleSessionStatus, Prisma, ServerPowerState, VpsActionStatus, VpsActionType, VpsStatus, type Membership, type Organization } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getControlPlaneRestriction, getRequiredRolesForAction } from "@/lib/vps/access";
import { denyServerAccess, requireRole } from "@/lib/vps/authz";
import { buildImageMetadataPatch } from "@/lib/vps/images";
import { assertProviderActionSupport, assertProviderCapability } from "@/lib/vps/provider-support";
import { getVpsProviderAdapter, type ProviderActionResult, type ProviderConsoleSessionResult, type ProviderServerRef, type RebuildInput } from "@/lib/vps/providers";
import { classifyProviderHealth, healthyProviderState } from "@/lib/vps/server-state";
import { syncServer } from "@/lib/vps/sync";

type MembershipWithOrg = Membership & { org: Organization };

export type VpsActionName = VpsActionType;

const requestedEventTypeByAction: Record<VpsActionName, string> = {
  POWER_ON: "POWER_ON_REQUESTED",
  POWER_OFF: "POWER_OFF_REQUESTED",
  REBOOT: "REBOOT_REQUESTED",
  HARD_REBOOT: "HARD_REBOOT_REQUESTED",
  ENABLE_RESCUE: "RESCUE_ENABLED",
  DISABLE_RESCUE: "RESCUE_DISABLED",
  REBUILD: "REBUILD_REQUESTED",
  OPEN_CONSOLE_SESSION: "CONSOLE_SESSION_OPENED",
  CREATE_SNAPSHOT: "SNAPSHOT_CREATED",
  RESTORE_SNAPSHOT: "SNAPSHOT_RESTORED",
  DELETE_SNAPSHOT: "SNAPSHOT_DELETED",
  UPDATE_FIREWALL: "FIREWALL_UPDATED",
  UPDATE_BACKUP_POLICY: "BACKUP_POLICY_UPDATED",
  ROLLBACK_FIREWALL: "FIREWALL_ROLLBACK_REQUESTED",
  MANUAL_SYNC: "MANUAL_SYNC_REQUESTED",
};

const failedEventTypeByAction: Record<VpsActionName, string> = {
  POWER_ON: "POWER_ON_FAILED",
  POWER_OFF: "POWER_OFF_FAILED",
  REBOOT: "REBOOT_FAILED",
  HARD_REBOOT: "HARD_REBOOT_FAILED",
  ENABLE_RESCUE: "RESCUE_ENABLE_FAILED",
  DISABLE_RESCUE: "RESCUE_DISABLE_FAILED",
  REBUILD: "REBUILD_FAILED",
  OPEN_CONSOLE_SESSION: "CONSOLE_SESSION_FAILED",
  CREATE_SNAPSHOT: "SNAPSHOT_CREATE_FAILED",
  RESTORE_SNAPSHOT: "SNAPSHOT_RESTORE_FAILED",
  DELETE_SNAPSHOT: "SNAPSHOT_DELETE_FAILED",
  UPDATE_FIREWALL: "FIREWALL_UPDATE_FAILED",
  UPDATE_BACKUP_POLICY: "BACKUP_POLICY_UPDATE_FAILED",
  ROLLBACK_FIREWALL: "FIREWALL_ROLLBACK_FAILED",
  MANUAL_SYNC: "MANUAL_SYNC_FAILED",
};

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function toProviderServerRef(server: {
  providerSlug: string;
  providerServerId: string | null;
  instanceId: string;
  publicIpv4: string;
  name: string;
}): ProviderServerRef {
  return {
    providerSlug: server.providerSlug,
    providerServerId: server.providerServerId,
    instanceId: server.instanceId,
    publicIpv4: server.publicIpv4,
    name: server.name,
  };
}

function buildActorIdentity(input: {
  membership: MembershipWithOrg;
  actorUserId: string;
  sourceIp?: string | undefined;
}) {
  return {
    userId: input.actorUserId,
    orgId: input.membership.orgId,
    role: input.membership.role,
    sourceIp: input.sourceIp,
  };
}

async function assertServerOperationAllowed(input: {
  membership: MembershipWithOrg;
  actorUserId: string;
  sourceIp?: string | undefined;
  server: {
    id: string;
    orgId: string;
    providerHealthState: string;
  };
  action: VpsActionType;
}) {
  const actor = buildActorIdentity({
    membership: input.membership,
    actorUserId: input.actorUserId,
    sourceIp: input.sourceIp,
  });
  const resolved = await requireRole({
    actor,
    serverId: input.server.id,
    allowed: getRequiredRolesForAction(input.action),
    action: input.action,
    sourceIp: input.sourceIp,
  });
  const restriction = getControlPlaneRestriction({
    providerHealthState: input.server.providerHealthState as never,
    action: input.action,
  });

  if (restriction.blocked) {
    await denyServerAccess({
      actor,
      serverId: input.server.id,
      sourceIp: input.sourceIp,
      action: input.action,
      requiredRole: "PROVIDER_HEALTHY",
      actualRole: resolved.role,
      reason: restriction.reason,
    });
    throw Object.assign(new Error(restriction.reason), { httpStatus: 403, code: restriction.policy });
  }

  return resolved;
}

async function appendVpsAuditEvent(input: {
  orgId: string;
  serverId: string;
  actorUserId?: string | null | undefined;
  eventType: string;
  severity?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | undefined;
  sourceIp?: string | null | undefined;
  relatedJobId?: string | null | undefined;
  payload?: Record<string, unknown> | null | undefined;
}) {
  await prisma.vpsAuditEvent.create({
    data: {
      orgId: input.orgId,
      serverId: input.serverId,
      actorUserId: input.actorUserId || null,
      eventType: input.eventType,
      severity: input.severity || "INFO",
      sourceIp: input.sourceIp || null,
      relatedJobId: input.relatedJobId || null,
      payloadJson: input.payload ? jsonValue(input.payload) : Prisma.JsonNull,
    },
  });
}

function optimisticPatchForAction(action: VpsActionName): Partial<{
  status: VpsStatus;
  powerState: ServerPowerState;
  rescueEnabled: boolean;
}> | null {
  switch (action) {
    case "POWER_ON":
      return { status: VpsStatus.RUNNING, powerState: ServerPowerState.ON };
    case "POWER_OFF":
      return { status: VpsStatus.STOPPED, powerState: ServerPowerState.OFF };
    case "REBOOT":
    case "HARD_REBOOT":
      return { status: VpsStatus.REBOOTING, powerState: ServerPowerState.ON };
    case "ENABLE_RESCUE":
      return { status: VpsStatus.RESCUED, powerState: ServerPowerState.ON, rescueEnabled: true };
    case "DISABLE_RESCUE":
      return { status: VpsStatus.RUNNING, powerState: ServerPowerState.ON, rescueEnabled: false };
    case "REBUILD":
      return { status: VpsStatus.REBUILDING, powerState: ServerPowerState.ON, rescueEnabled: false };
    default:
      return null;
  }
}

function withRebuildImageMetadata(
  patch: ProviderActionResult["serverPatch"] | null | undefined,
  providerSlug: string,
  rebuildInput?: RebuildInput | undefined,
) {
  if (!rebuildInput?.imageSlug) {
    return patch || null;
  }

  const metadataPatch = buildImageMetadataPatch(rebuildInput.imageSlug, providerSlug);
  if (!metadataPatch) {
    return patch || null;
  }

  return {
    ...metadataPatch,
    ...(patch || {}),
  };
}

async function applyProviderPatch(serverId: string, patch: ProviderActionResult["serverPatch"]) {
  if (!patch) {
    return;
  }

  const data: Prisma.VpsServerUpdateInput = {
    lastSyncedAt: new Date(),
    providerHealthState: healthyProviderState().providerHealthState,
    providerLastCheckedAt: new Date(),
    providerError: null,
  };

  if (patch.status) data.status = patch.status;
  if (patch.powerState) data.powerState = patch.powerState;
  if (patch.publicIpv4) data.publicIpv4 = patch.publicIpv4;
  if (patch.privateIpv4 !== undefined) data.privateIpv4 = patch.privateIpv4 || null;
  if (patch.gatewayIpv4 !== undefined) data.gatewayIpv4 = patch.gatewayIpv4 || null;
  if (patch.privateNetwork !== undefined) data.privateNetwork = patch.privateNetwork || null;
  if (patch.sshPort !== undefined) data.sshPort = patch.sshPort;
  if (patch.defaultUsername) data.defaultUsername = patch.defaultUsername;
  if (patch.region) data.region = patch.region;
  if (patch.datacenterLabel !== undefined) data.datacenterLabel = patch.datacenterLabel || null;
  if (patch.imageSlug) data.imageSlug = patch.imageSlug;
  if (patch.osName) data.osName = patch.osName;
  if (patch.imageVersion !== undefined) data.imageVersion = patch.imageVersion || null;
  if (patch.virtualizationType !== undefined) data.virtualizationType = patch.virtualizationType || null;
  if (patch.planSlug) data.planSlug = patch.planSlug;
  if (patch.planName !== undefined) data.planName = patch.planName || null;
  if (patch.vcpu !== undefined) data.vcpu = patch.vcpu;
  if (patch.memoryMb !== undefined) data.memoryMb = patch.memoryMb;
  if (patch.diskGb !== undefined) data.diskGb = patch.diskGb;
  if (patch.bandwidthTb !== undefined) data.bandwidthTb = patch.bandwidthTb;
  if (patch.bandwidthUsedGb !== undefined) data.bandwidthUsedGb = patch.bandwidthUsedGb;
  if (patch.reverseDns !== undefined) data.reverseDns = patch.reverseDns || null;
  if (patch.reverseDnsStatus !== undefined) data.reverseDnsStatus = patch.reverseDnsStatus || null;
  if (patch.firewallEnabled !== undefined) data.firewallEnabled = patch.firewallEnabled;
  if (patch.firewallProfileName !== undefined) data.firewallProfileName = patch.firewallProfileName || null;
  if (patch.monitoringEnabled !== undefined) data.monitoringEnabled = patch.monitoringEnabled;
  if (patch.monitoringStatus !== undefined) data.monitoringStatus = patch.monitoringStatus || null;
  if (patch.backupsEnabled !== undefined) data.backupsEnabled = patch.backupsEnabled;
  if (patch.backupRegion !== undefined) data.backupRegion = patch.backupRegion || null;
  if (patch.snapshotCount !== undefined) data.snapshotCountCached = patch.snapshotCount;
  if (patch.nextInvoiceAt !== undefined) data.nextInvoiceAt = patch.nextInvoiceAt ? new Date(patch.nextInvoiceAt) : null;
  if (patch.renewalAt !== undefined) data.renewalAt = patch.renewalAt ? new Date(patch.renewalAt) : null;
  if (patch.billingCycle !== undefined) data.billingCycle = patch.billingCycle;
  if (patch.monthlyPriceCents !== undefined) data.monthlyPriceCents = patch.monthlyPriceCents;
  if (patch.billingCurrency) data.billingCurrency = patch.billingCurrency;
  if (patch.supportTier !== undefined) data.supportTier = patch.supportTier || null;
  if (patch.supportTicketUrl !== undefined) data.supportTicketUrl = patch.supportTicketUrl || null;
  if (patch.supportDocsUrl !== undefined) data.supportDocsUrl = patch.supportDocsUrl || null;
  if (patch.rescueEnabled !== undefined) data.rescueEnabled = patch.rescueEnabled;
  if (patch.providerServerId !== undefined) data.providerServerId = patch.providerServerId || null;
  if (patch.providerRegionId !== undefined) data.providerRegionId = patch.providerRegionId || null;
  if (patch.providerPlanId !== undefined) data.providerPlanId = patch.providerPlanId || null;
  if (patch.lastKnownProviderStateJson !== undefined) data.lastKnownProviderStateJson = jsonValue(patch.lastKnownProviderStateJson);

  await prisma.vpsServer.update({
    where: { id: serverId },
    data,
  });
}

async function providerAction(
  action: VpsActionName,
  ref: ProviderServerRef,
  rebuildInput?: RebuildInput | undefined,
): Promise<ProviderActionResult> {
  const adapter = getVpsProviderAdapter(ref.providerSlug);
  assertProviderActionSupport({
    providerSlug: ref.providerSlug,
    capabilities: adapter.capabilities,
    action,
  });

  switch (action) {
    case "POWER_ON":
      return adapter.powerOn(ref);
    case "POWER_OFF":
      return adapter.powerOff(ref);
    case "REBOOT":
      return adapter.reboot(ref);
    case "HARD_REBOOT":
      return adapter.reboot({ ...ref, hard: true });
    case "ENABLE_RESCUE":
      return adapter.enableRescue(ref);
    case "DISABLE_RESCUE":
      return adapter.disableRescue(ref);
    case "REBUILD":
      return adapter.rebuild(ref, rebuildInput || {});
    default:
      return {
        accepted: false,
        status: "FAILED",
        message: "unsupported_action",
      };
  }
}

export async function executeVpsAction(input: {
  membership: MembershipWithOrg;
  serverId: string;
  action: VpsActionName;
  actorUserId: string;
  actorRole: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestPayload?: Record<string, unknown> | undefined;
  rebuildInput?: RebuildInput | undefined;
}) {
  const server = await prisma.vpsServer.findFirst({
    where: {
      id: input.serverId,
      orgId: input.membership.orgId,
    },
    select: {
      id: true,
      orgId: true,
      providerSlug: true,
      providerServerId: true,
      instanceId: true,
      publicIpv4: true,
      name: true,
      providerHealthState: true,
    },
  });

  if (!server) {
    throw Object.assign(new Error("VPS server not found."), { httpStatus: 404 });
  }

  const resolvedRole = await assertServerOperationAllowed({
    membership: input.membership,
    actorUserId: input.actorUserId,
    sourceIp: input.ip,
    server,
    action: input.action,
  });

  const requestedEventType = requestedEventTypeByAction[input.action];
  const job = await prisma.vpsActionJob.create({
    data: {
      serverId: server.id,
      orgId: server.orgId,
      action: input.action,
      status: VpsActionStatus.QUEUED,
      requestedByUserId: input.actorUserId,
      requestJson: input.requestPayload ? jsonValue(input.requestPayload) : Prisma.JsonNull,
      startedAt: new Date(),
    },
  });

  await appendVpsAuditEvent({
    orgId: server.orgId,
    serverId: server.id,
    actorUserId: input.actorUserId,
    eventType: requestedEventType,
    sourceIp: input.ip || null,
    relatedJobId: job.id,
    payload: {
      jobId: job.id,
      action: input.action,
      request: input.requestPayload || null,
    },
  });

  await writeAuditLog({
    actorId: input.actorUserId,
    actorRole: resolvedRole.role,
    orgId: server.orgId,
    action: requestedEventType,
    resourceType: "vps_server",
    resourceId: server.id,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: input.action === "REBUILD" ? 2 : 1,
    metadata: jsonValue({
      jobId: job.id,
      action: input.action,
      request: input.requestPayload || null,
    }),
  });

  const providerRef = toProviderServerRef(server);
  let result: ProviderActionResult;

  try {
    result = await providerAction(input.action, providerRef, input.rebuildInput);
    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: healthyProviderState().providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: null,
      },
    });
  } catch (error) {
    const health = classifyProviderHealth(error);
    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: health.providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: health.providerError,
      },
    });
    throw error;
  }

  if (result.accepted) {
    const basePatch = result.serverPatch || optimisticPatchForAction(input.action);
    const patch = withRebuildImageMetadata(
      basePatch && ("imageSlug" in basePatch || "osName" in basePatch || "imageVersion" in basePatch || "defaultUsername" in basePatch)
        ? basePatch
        : null,
      server.providerSlug,
      input.rebuildInput,
    );
    if (patch) {
      await applyProviderPatch(server.id, patch);
      await appendVpsAuditEvent({
        orgId: server.orgId,
        serverId: server.id,
        actorUserId: input.actorUserId,
        eventType: "SERVER_SYNCED",
        sourceIp: input.ip || null,
        relatedJobId: job.id,
        payload: {
          jobId: job.id,
          action: input.action,
          patch,
        },
      });
    }
  }

  const nextStatus =
    !result.accepted || result.status === "FAILED"
      ? VpsActionStatus.FAILED
      : result.status === "RUNNING"
        ? VpsActionStatus.RUNNING
        : result.status === "QUEUED"
          ? VpsActionStatus.QUEUED
          : VpsActionStatus.SUCCEEDED;

  const updatedJob = await prisma.vpsActionJob.update({
    where: { id: job.id },
    data: {
      status: nextStatus,
      providerRequestId: result.providerRequestId || null,
      resultJson: jsonValue({
        accepted: result.accepted,
        status: result.status,
        message: result.message || null,
        providerRequestId: result.providerRequestId || null,
        metadata: result.metadata || null,
        serverPatch: result.serverPatch || null,
      }),
      errorJson:
        !result.accepted || nextStatus === VpsActionStatus.FAILED
          ? jsonValue({
            message: result.message || "provider_action_failed",
            metadata: result.metadata || null,
          })
          : Prisma.JsonNull,
      ...(nextStatus === VpsActionStatus.SUCCEEDED || nextStatus === VpsActionStatus.FAILED ? { finishedAt: new Date() } : {}),
    },
  });

  if (!result.accepted || nextStatus === VpsActionStatus.FAILED) {
    await appendVpsAuditEvent({
      orgId: server.orgId,
      serverId: server.id,
      actorUserId: input.actorUserId,
      eventType: failedEventTypeByAction[input.action],
      severity: "ERROR",
      sourceIp: input.ip || null,
      relatedJobId: job.id,
      payload: {
        jobId: job.id,
        message: result.message || "provider_action_failed",
      },
    });
  }

  return {
    job: updatedJob,
    result,
  };
}

export async function syncVpsServer(input: {
  membership: MembershipWithOrg;
  serverId: string;
  actorUserId: string;
  actorRole: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}) {
  const server = await prisma.vpsServer.findFirst({
    where: {
      id: input.serverId,
      orgId: input.membership.orgId,
    },
    select: {
      id: true,
      orgId: true,
      providerSlug: true,
      providerServerId: true,
      instanceId: true,
      publicIpv4: true,
      name: true,
      providerHealthState: true,
    },
  });

  if (!server) {
    throw Object.assign(new Error("VPS server not found."), { httpStatus: 404 });
  }

  await assertServerOperationAllowed({
    membership: input.membership,
    actorUserId: input.actorUserId,
    sourceIp: input.ip,
    server,
    action: VpsActionType.MANUAL_SYNC,
  });

  return syncServer(server.id, {
    actorUserId: input.actorUserId,
    ...(input.ip !== undefined ? { sourceIp: input.ip } : {}),
  });
}

export async function openVpsConsoleSession(input: {
  membership: MembershipWithOrg;
  serverId: string;
  actorUserId: string;
  actorRole: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}) {
  const server = await prisma.vpsServer.findFirst({
    where: {
      id: input.serverId,
      orgId: input.membership.orgId,
    },
    select: {
      id: true,
      orgId: true,
      providerSlug: true,
      providerServerId: true,
      instanceId: true,
      publicIpv4: true,
      name: true,
      providerHealthState: true,
    },
  });

  if (!server) {
    throw Object.assign(new Error("VPS server not found."), { httpStatus: 404 });
  }

  const resolvedRole = await assertServerOperationAllowed({
    membership: input.membership,
    actorUserId: input.actorUserId,
    sourceIp: input.ip,
    server,
    action: VpsActionType.OPEN_CONSOLE_SESSION,
  });

  const adapter = getVpsProviderAdapter(server.providerSlug);
  assertProviderCapability({
    providerSlug: server.providerSlug,
    capabilities: adapter.capabilities,
    capability: "console",
  });
  const job = await prisma.vpsActionJob.create({
    data: {
      serverId: server.id,
      orgId: server.orgId,
      action: VpsActionType.OPEN_CONSOLE_SESSION,
      status: VpsActionStatus.QUEUED,
      requestedByUserId: input.actorUserId,
      startedAt: new Date(),
    },
  });

  const session: ProviderConsoleSessionResult = await adapter.createConsoleSession(toProviderServerRef(server), {
    actorUserId: input.actorUserId,
    viewOnly: false,
  });

  await prisma.vpsServer.update({
    where: { id: server.id },
    data: {
      providerHealthState: healthyProviderState().providerHealthState,
      providerLastCheckedAt: new Date(),
      providerError: null,
    },
  });

  const nextStatus = session.supported ? VpsActionStatus.SUCCEEDED : VpsActionStatus.FAILED;

  await prisma.vpsConsoleSession.create({
    data: {
      serverId: server.id,
      providerSessionId: session.sessionId || null,
      launchUrl: session.launchUrl || null,
      tokenPreview: session.token ? session.token.slice(0, 6) : null,
      status: session.supported ? ConsoleSessionStatus.READY : ConsoleSessionStatus.FAILED,
      createdByUserId: input.actorUserId,
      viewOnly: session.mode === "VIEW_ONLY",
      expiresAt: session.expiresAt ? new Date(session.expiresAt) : null,
      lastConnectedAt: session.supported ? new Date() : null,
    },
  });

  await appendVpsAuditEvent({
    orgId: server.orgId,
    serverId: server.id,
    actorUserId: input.actorUserId,
    eventType: "CONSOLE_SESSION_OPENED",
    sourceIp: input.ip || null,
    relatedJobId: job.id,
    payload: {
      supported: session.supported,
      mode: session.mode,
      sessionId: session.sessionId || null,
    },
  });

  if (!session.supported) {
    await appendVpsAuditEvent({
      orgId: server.orgId,
      serverId: server.id,
      actorUserId: input.actorUserId,
      eventType: "CONSOLE_SESSION_FAILED",
      severity: "ERROR",
      sourceIp: input.ip || null,
      relatedJobId: job.id,
      payload: {
        message: session.message || "console_session_failed",
      },
    });
  }

  await prisma.vpsActionJob.update({
    where: { id: job.id },
    data: {
      status: nextStatus,
      finishedAt: new Date(),
      resultJson: jsonValue({
        supported: session.supported,
        mode: session.mode,
        sessionId: session.sessionId || null,
        launchUrl: session.launchUrl || null,
        expiresAt: session.expiresAt || null,
        message: session.message || null,
      }),
      errorJson: session.supported
        ? Prisma.JsonNull
        : jsonValue({
          message: session.message || "console_session_failed",
        }),
    },
  });

  await writeAuditLog({
    actorId: input.actorUserId,
    actorRole: resolvedRole.role,
    orgId: server.orgId,
    action: "CONSOLE_SESSION_OPENED",
    resourceType: "vps_server",
    resourceId: server.id,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 1,
    metadata: {
      jobId: job.id,
      supported: session.supported,
      mode: session.mode,
      sessionId: session.sessionId || null,
    },
  });

  return session;
}
