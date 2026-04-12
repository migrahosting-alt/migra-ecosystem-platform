import {
  FirewallAction,
  FirewallDirection,
  FirewallProfileStatus,
  FirewallProtocol,
  Prisma,
  ServerPowerState,
  VpsActionStatus,
  VpsBackupPolicyStatus,
  VpsSnapshotStatus,
  VpsStatus,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { extractBearerToken } from "@/lib/drive/drive-internal-auth";
import { prisma } from "@/lib/prisma";
import type { CanonicalFirewallState } from "@/lib/vps/firewall/types";
import { buildImageMetadataPatch } from "@/lib/vps/images";
import type {
  ProviderActionResult,
  ProviderBackupPolicy,
  ProviderConsoleSessionResult,
  ProviderMetricsResult,
  ProviderServerSummary,
  ProviderSnapshot,
} from "@/lib/vps/providers/types";

const mhServerSelect = {
  id: true,
  orgId: true,
  providerSlug: true,
  providerServerId: true,
  providerRegionId: true,
  providerPlanId: true,
  name: true,
  hostname: true,
  instanceId: true,
  status: true,
  powerState: true,
  publicIpv4: true,
  privateIpv4: true,
  gatewayIpv4: true,
  privateNetwork: true,
  sshPort: true,
  defaultUsername: true,
  region: true,
  datacenterLabel: true,
  imageSlug: true,
  osName: true,
  imageVersion: true,
  virtualizationType: true,
  planSlug: true,
  planName: true,
  vcpu: true,
  memoryMb: true,
  diskGb: true,
  bandwidthTb: true,
  bandwidthUsedGb: true,
  reverseDns: true,
  reverseDnsStatus: true,
  firewallEnabled: true,
  firewallProfileName: true,
  monitoringEnabled: true,
  monitoringStatus: true,
  backupsEnabled: true,
  backupRegion: true,
  snapshotCountCached: true,
  nextInvoiceAt: true,
  renewalAt: true,
  billingCycle: true,
  monthlyPriceCents: true,
  billingCurrency: true,
  supportTier: true,
  supportTicketUrl: true,
  supportDocsUrl: true,
  rescueEnabled: true,
  lastSyncedAt: true,
  lastKnownProviderStateJson: true,
  providerBindings: {
    where: { providerSlug: "mh" },
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: {
      id: true,
      metadataJson: true,
    },
  },
} satisfies Prisma.VpsServerSelect;

type MhServerRecord = Prisma.VpsServerGetPayload<{ select: typeof mhServerSelect }>;

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mhApiToken() {
  return process.env.MH_API_TOKEN || process.env.MIGRATECK_VPS_PROVIDER_TOKEN || "";
}

function serverWhere(id: string): Prisma.VpsServerWhereInput {
  return {
    providerSlug: "mh",
    OR: [{ id }, { providerServerId: id }, { instanceId: id }],
  };
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : undefined;
}

function mapMhServerSummary(server: MhServerRecord): ProviderServerSummary {
  return {
    providerSlug: server.providerSlug,
    providerServerId: server.providerServerId,
    providerRegionId: server.providerRegionId,
    providerPlanId: server.providerPlanId,
    name: server.name,
    hostname: server.hostname,
    instanceId: server.instanceId,
    status: server.status,
    powerState: server.powerState,
    publicIpv4: server.publicIpv4,
    privateIpv4: server.privateIpv4,
    gatewayIpv4: server.gatewayIpv4,
    privateNetwork: server.privateNetwork,
    sshPort: server.sshPort,
    defaultUsername: server.defaultUsername,
    region: server.region,
    datacenterLabel: server.datacenterLabel,
    imageSlug: server.imageSlug,
    osName: server.osName,
    imageVersion: server.imageVersion,
    virtualizationType: server.virtualizationType,
    planSlug: server.planSlug,
    planName: server.planName,
    vcpu: server.vcpu,
    memoryMb: server.memoryMb,
    diskGb: server.diskGb,
    bandwidthTb: server.bandwidthTb,
    bandwidthUsedGb: server.bandwidthUsedGb,
    reverseDns: server.reverseDns,
    reverseDnsStatus: server.reverseDnsStatus,
    firewallEnabled: server.firewallEnabled,
    firewallProfileName: server.firewallProfileName,
    monitoringEnabled: server.monitoringEnabled,
    monitoringStatus: server.monitoringStatus,
    backupsEnabled: server.backupsEnabled,
    backupRegion: server.backupRegion,
    snapshotCount: server.snapshotCountCached,
    nextInvoiceAt: toIso(server.nextInvoiceAt),
    renewalAt: toIso(server.renewalAt),
    billingCycle: server.billingCycle,
    monthlyPriceCents: server.monthlyPriceCents,
    billingCurrency: server.billingCurrency,
    supportTier: server.supportTier,
    supportTicketUrl: server.supportTicketUrl,
    supportDocsUrl: server.supportDocsUrl,
    rescueEnabled: server.rescueEnabled,
    lastKnownProviderStateJson: isObject(server.lastKnownProviderStateJson)
      ? server.lastKnownProviderStateJson
      : null,
  };
}

async function writeMhAuditEvent(
  server: Pick<MhServerRecord, "id" | "orgId">,
  eventType: string,
  payload?: Record<string, unknown> | undefined,
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL" = "INFO",
) {
  await prisma.vpsAuditEvent.create({
    data: {
      orgId: server.orgId,
      serverId: server.id,
      actorUserId: null,
      eventType,
      severity,
      payloadJson: payload ? jsonValue(payload) : Prisma.JsonNull,
    },
  });
}

async function loadMhServer(id: string) {
  return prisma.vpsServer.findFirst({
    where: serverWhere(id),
    select: mhServerSelect,
  });
}

async function syncMhBindingState(serverId: string) {
  const server = await prisma.vpsServer.findUnique({
    where: { id: serverId },
    select: mhServerSelect,
  });
  if (!server) {
    return null;
  }

  const summary = mapMhServerSummary(server);
  const binding = server.providerBindings[0];

  await prisma.vpsServer.update({
    where: { id: server.id },
    data: {
      lastKnownProviderStateJson: jsonValue(summary),
      lastSyncedAt: new Date(),
    },
  });

  if (binding) {
    const metadata = isObject(binding.metadataJson) ? binding.metadataJson : {};
    await prisma.vpsProviderBinding.update({
      where: { id: binding.id },
      data: {
        metadataJson: jsonValue({
          ...metadata,
          mode: "live_api",
          source: "mh_api",
        }),
        lastKnownStateJson: jsonValue(summary),
        lastSyncedAt: new Date(),
      },
    });
  }

  return summary;
}

async function updateMhServer(
  server: MhServerRecord,
  data: Prisma.VpsServerUpdateInput,
  eventType: string,
  payload?: Record<string, unknown> | undefined,
) {
  await prisma.vpsServer.update({
    where: { id: server.id },
    data: {
      ...data,
      lastSyncedAt: new Date(),
    },
  });

  const summary = await syncMhBindingState(server.id);
  if (!summary) {
    throw new Error("Unable to refresh MH server state.");
  }

  await writeMhAuditEvent(server, eventType, payload);
  return summary;
}

function actionResult(summary: ProviderServerSummary, message: string): ProviderActionResult {
  return {
    accepted: true,
    status: "SUCCEEDED",
    message,
    serverPatch: summary,
    raw: summary,
  };
}

function mapTaskStatus(status: VpsActionStatus): ProviderActionResult["status"] {
  switch (status) {
    case VpsActionStatus.RUNNING:
      return "RUNNING";
    case VpsActionStatus.QUEUED:
      return "QUEUED";
    case VpsActionStatus.SUCCEEDED:
      return "SUCCEEDED";
    case VpsActionStatus.FAILED:
    case VpsActionStatus.CANCELED:
      return "FAILED";
    default:
      return "QUEUED";
  }
}

function extractMessage(input: unknown) {
  if (!isObject(input)) {
    return undefined;
  }

  const value = input.message;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function authorizeMhApiRequest(request: Request) {
  const configuredToken = mhApiToken().trim();
  if (!configuredToken) {
    return mhApiJson({ error: "MH API token is not configured." }, 503);
  }

  if (extractBearerToken(request) !== configuredToken) {
    return mhApiJson({ error: "Unauthorized" }, 401);
  }

  return null;
}

export function mhApiJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function listMhApiServers() {
  const servers = await prisma.vpsServer.findMany({
    where: { providerSlug: "mh" },
    orderBy: [{ createdAt: "asc" }],
    select: mhServerSelect,
  });

  return servers.map((server) => mapMhServerSummary(server));
}

export async function getMhApiHealth() {
  const serverCount = await prisma.vpsServer.count({
    where: { providerSlug: "mh" },
  });

  return {
    status: "ok" as const,
    provider: "mh" as const,
    serverCount,
    generatedAt: new Date().toISOString(),
  };
}

export async function getMhApiServer(id: string) {
  const server = await loadMhServer(id);
  return server ? mapMhServerSummary(server) : null;
}

export async function getMhApiTaskStatus(taskId: string) {
  const job = await prisma.vpsActionJob.findFirst({
    where: {
      OR: [{ id: taskId }, { providerTaskId: taskId }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      providerTaskId: true,
      providerRequestId: true,
      resultJson: true,
      errorJson: true,
    },
  });

  if (!job) {
    return null;
  }

  return {
    accepted: job.status !== VpsActionStatus.FAILED && job.status !== VpsActionStatus.CANCELED,
    status: mapTaskStatus(job.status),
    providerTaskId: job.providerTaskId || job.id,
    providerRequestId: job.providerRequestId || undefined,
    message: extractMessage(job.errorJson) || extractMessage(job.resultJson),
    raw: job.resultJson || job.errorJson || null,
  } satisfies ProviderActionResult;
}

export async function powerOnMhApiServer(id: string) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const summary = await updateMhServer(
    server,
    { status: VpsStatus.RUNNING, powerState: ServerPowerState.ON },
    "MH_API_POWER_ON",
  );
  return actionResult(summary, "power_on_completed");
}

export async function powerOffMhApiServer(id: string) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const summary = await updateMhServer(
    server,
    { status: VpsStatus.STOPPED, powerState: ServerPowerState.OFF },
    "MH_API_POWER_OFF",
  );
  return actionResult(summary, "power_off_completed");
}

export async function rebootMhApiServer(id: string, hard = false) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const summary = await updateMhServer(
    server,
    { status: VpsStatus.RUNNING, powerState: ServerPowerState.ON },
    hard ? "MH_API_HARD_REBOOT" : "MH_API_REBOOT",
    hard ? { hard: true } : undefined,
  );
  return actionResult(summary, hard ? "hard_reboot_completed" : "reboot_completed");
}

export async function enableMhApiRescue(id: string) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const summary = await updateMhServer(
    server,
    { status: VpsStatus.RESCUED, powerState: ServerPowerState.ON, rescueEnabled: true },
    "MH_API_RESCUE_ENABLED",
  );
  return actionResult(summary, "rescue_enabled");
}

export async function disableMhApiRescue(id: string) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const summary = await updateMhServer(
    server,
    { status: VpsStatus.RUNNING, powerState: ServerPowerState.ON, rescueEnabled: false },
    "MH_API_RESCUE_DISABLED",
  );
  return actionResult(summary, "rescue_disabled");
}

export async function rebuildMhApiServer(
  id: string,
  input: { imageSlug?: string; hostname?: string; sshKeys?: string[]; reason?: string },
) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const imagePatch = buildImageMetadataPatch(input.imageSlug, "mh") || {};
  const summary = await updateMhServer(
    server,
    {
      status: VpsStatus.RUNNING,
      powerState: ServerPowerState.ON,
      rescueEnabled: false,
      ...(input.hostname ? { hostname: input.hostname } : {}),
      ...imagePatch,
    },
    "MH_API_REBUILD",
    {
      ...(input.imageSlug ? { imageSlug: input.imageSlug } : {}),
      ...(input.hostname ? { hostname: input.hostname } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.sshKeys?.length ? { sshKeyCount: input.sshKeys.length } : {}),
    },
  );
  return actionResult(summary, "rebuild_completed");
}

export async function createMhApiConsoleSession(
  id: string,
  input: { actorUserId?: string; viewOnly?: boolean },
) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const launchUrl = `ssh://${encodeURIComponent(server.defaultUsername)}@${server.publicIpv4}:${server.sshPort}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await writeMhAuditEvent(server, "MH_API_CONSOLE_SESSION_CREATED", {
    actorUserId: input.actorUserId || null,
    viewOnly: input.viewOnly === true,
  });

  return {
    supported: true,
    mode: input.viewOnly ? "VIEW_ONLY" : "FULL",
    status: "READY",
    sessionId: globalThis.crypto.randomUUID(),
    launchUrl,
    expiresAt,
    message: "Use an SSH-capable client if the browser does not handle ssh:// links.",
  } satisfies ProviderConsoleSessionResult;
}

export async function getMhApiFirewall(id: string) {
  const server = await prisma.vpsServer.findFirst({
    where: serverWhere(id),
    select: {
      id: true,
      firewallEnabled: true,
      firewallProfileName: true,
      firewallProfiles: {
        where: { isActive: true },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          isActive: true,
          defaultInboundAction: true,
          defaultOutboundAction: true,
          antiLockoutEnabled: true,
          rollbackWindowSec: true,
          providerVersion: true,
          lastAppliedAt: true,
          lastApplyJobId: true,
          lastError: true,
          rollbackPendingUntil: true,
          confirmedAt: true,
          driftDetectedAt: true,
          rules: {
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              direction: true,
              action: true,
              protocol: true,
              portStart: true,
              portEnd: true,
              sourceCidr: true,
              destinationCidr: true,
              description: true,
              priority: true,
              enabled: true,
              expiresAt: true,
            },
          },
        },
      },
    },
  });

  if (!server) {
    return null;
  }

  const profile = server.firewallProfiles[0];
  return {
    profileId: profile?.id,
    profileName: profile?.name || server.firewallProfileName || "Default VPS Firewall",
    status: profile?.status || (server.firewallEnabled ? "ACTIVE" : "DISABLED"),
    isEnabled: server.firewallEnabled,
    isActive: profile?.isActive || server.firewallEnabled,
    inboundDefaultAction: profile?.defaultInboundAction || "DENY",
    outboundDefaultAction: profile?.defaultOutboundAction || "ALLOW",
    antiLockoutEnabled: profile?.antiLockoutEnabled ?? true,
    rollbackWindowSec: profile?.rollbackWindowSec ?? 120,
    providerVersion: profile?.providerVersion || null,
    lastAppliedAt: toIso(profile?.lastAppliedAt) || null,
    lastApplyJobId: profile?.lastApplyJobId || null,
    lastError: profile?.lastError || null,
    rollbackPendingUntil: toIso(profile?.rollbackPendingUntil) || null,
    confirmedAt: toIso(profile?.confirmedAt) || null,
    driftDetectedAt: toIso(profile?.driftDetectedAt) || null,
    rules: (profile?.rules || []).map((rule) => ({
      id: rule.id,
      direction: rule.direction,
      action: rule.action,
      protocol: rule.protocol,
      portStart: rule.portStart ?? undefined,
      portEnd: rule.portEnd ?? undefined,
      sourceCidr: rule.sourceCidr ?? undefined,
      destinationCidr: rule.destinationCidr ?? undefined,
      description: rule.description ?? undefined,
      priority: rule.priority,
      isEnabled: rule.enabled,
      expiresAt: toIso(rule.expiresAt) || null,
    })),
  } satisfies CanonicalFirewallState;
}

export async function updateMhApiFirewall(id: string, state: CanonicalFirewallState) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.vpsFirewallProfile.findFirst({
      where: { serverId: server.id, isActive: true },
      select: { id: true },
    });

    const profile = existing
      ? await tx.vpsFirewallProfile.update({
        where: { id: existing.id },
        data: {
          name: state.profileName || server.firewallProfileName || "Default VPS Firewall",
          status: (state.status || (state.isEnabled === false ? "DISABLED" : "ACTIVE")) as FirewallProfileStatus,
          isActive: state.isActive !== false,
          defaultInboundAction: state.inboundDefaultAction as FirewallAction,
          defaultOutboundAction: state.outboundDefaultAction as FirewallAction,
          antiLockoutEnabled: state.antiLockoutEnabled,
          rollbackWindowSec: state.rollbackWindowSec,
          providerVersion: state.providerVersion || null,
          lastAppliedAt: new Date(),
          lastError: state.lastError || null,
        },
      })
      : await tx.vpsFirewallProfile.create({
        data: {
          serverId: server.id,
          name: state.profileName || server.firewallProfileName || "Default VPS Firewall",
          status: (state.status || (state.isEnabled === false ? "DISABLED" : "ACTIVE")) as FirewallProfileStatus,
          isActive: state.isActive !== false,
          defaultInboundAction: state.inboundDefaultAction as FirewallAction,
          defaultOutboundAction: state.outboundDefaultAction as FirewallAction,
          antiLockoutEnabled: state.antiLockoutEnabled,
          rollbackWindowSec: state.rollbackWindowSec,
          providerVersion: state.providerVersion || null,
          lastAppliedAt: new Date(),
        },
      });

    await tx.vpsFirewallRule.deleteMany({ where: { profileId: profile.id } });

    if (state.rules.length > 0) {
      await tx.vpsFirewallRule.createMany({
        data: state.rules.map((rule) => ({
          profileId: profile.id,
          direction: rule.direction as FirewallDirection,
          action: rule.action as FirewallAction,
          protocol: rule.protocol as FirewallProtocol,
          portStart: rule.portStart ?? null,
          portEnd: rule.portEnd ?? null,
          sourceCidr: rule.sourceCidr ?? null,
          destinationCidr: rule.destinationCidr ?? null,
          description: rule.description ?? null,
          priority: rule.priority,
          enabled: rule.isEnabled,
          expiresAt: rule.expiresAt ? new Date(rule.expiresAt) : null,
        })),
      });
    }

    await tx.vpsServer.update({
      where: { id: server.id },
      data: {
        firewallEnabled: state.isEnabled !== false,
        firewallProfileName: state.profileName || server.firewallProfileName,
      },
    });
  });

  const summary = await syncMhBindingState(server.id);
  if (!summary) {
    throw new Error("Unable to refresh MH firewall state.");
  }

  await writeMhAuditEvent(server, "MH_API_FIREWALL_UPDATED", {
    ruleCount: state.rules.length,
    profileName: state.profileName || server.firewallProfileName || "Default VPS Firewall",
  });

  return actionResult(summary, "firewall_updated");
}

export async function listMhApiSnapshots(id: string) {
  const server = await prisma.vpsServer.findFirst({
    where: serverWhere(id),
    select: {
      id: true,
      snapshots: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          sizeGb: true,
          createdBy: true,
          createdAt: true,
        },
      },
    },
  });

  if (!server) {
    return null;
  }

  return server.snapshots.map((snapshot) => ({
    id: snapshot.id,
    name: snapshot.name,
    status: snapshot.status,
    sizeGb: snapshot.sizeGb,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt.toISOString(),
  } satisfies ProviderSnapshot));
}

export async function createMhApiSnapshot(id: string, name: string) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.vpsSnapshot.create({
      data: {
        serverId: server.id,
        name,
        status: VpsSnapshotStatus.READY,
        createdBy: "mh_api",
      },
    });

    await tx.vpsServer.update({
      where: { id: server.id },
      data: {
        snapshotCountCached: { increment: 1 },
      },
    });
  });

  const summary = await syncMhBindingState(server.id);
  if (!summary) {
    throw new Error("Unable to refresh MH snapshot state.");
  }

  await writeMhAuditEvent(server, "MH_API_SNAPSHOT_CREATED", { name });
  return actionResult(summary, "snapshot_created");
}

export async function restoreMhApiSnapshot(id: string, snapshotId: string) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const snapshot = await prisma.vpsSnapshot.findFirst({
    where: { id: snapshotId, serverId: server.id },
    select: { id: true },
  });
  if (!snapshot) {
    return undefined;
  }

  const summary = await updateMhServer(server, { status: VpsStatus.RUNNING, powerState: ServerPowerState.ON }, "MH_API_SNAPSHOT_RESTORED", { snapshotId });
  return actionResult(summary, "snapshot_restored");
}

export async function deleteMhApiSnapshot(id: string, snapshotId: string) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  const snapshot = await prisma.vpsSnapshot.findFirst({
    where: { id: snapshotId, serverId: server.id },
    select: { id: true },
  });
  if (!snapshot) {
    return undefined;
  }

  await prisma.$transaction(async (tx) => {
    await tx.vpsSnapshot.delete({ where: { id: snapshot.id } });
    await tx.vpsServer.update({
      where: { id: server.id },
      data: {
        snapshotCountCached: {
          decrement: server.snapshotCountCached > 0 ? 1 : 0,
        },
      },
    });
  });

  const summary = await syncMhBindingState(server.id);
  if (!summary) {
    throw new Error("Unable to refresh MH snapshot state.");
  }

  await writeMhAuditEvent(server, "MH_API_SNAPSHOT_DELETED", { snapshotId });
  return actionResult(summary, "snapshot_deleted");
}

export async function getMhApiBackupPolicy(id: string) {
  const server = await prisma.vpsServer.findFirst({
    where: serverWhere(id),
    select: {
      id: true,
      backupsEnabled: true,
      backupRegion: true,
      backupPolicies: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          status: true,
          frequency: true,
          retentionCount: true,
          lastSuccessAt: true,
          nextRunAt: true,
          encrypted: true,
          crossRegion: true,
        },
      },
    },
  });

  if (!server) {
    return null;
  }

  const policy = server.backupPolicies[0];
  return {
    enabled: server.backupsEnabled,
    status: policy?.status || VpsBackupPolicyStatus.DISABLED,
    frequency: policy?.frequency || "daily",
    retentionCount: policy?.retentionCount || 7,
    encrypted: policy?.encrypted ?? true,
    crossRegion: policy?.crossRegion ?? false,
    region: server.backupRegion,
    lastSuccessAt: toIso(policy?.lastSuccessAt) || null,
    nextRunAt: toIso(policy?.nextRunAt) || null,
  } satisfies ProviderBackupPolicy;
}

export async function updateMhApiBackupPolicy(
  id: string,
  policy: {
    enabled: boolean;
    frequency: string;
    retentionCount: number;
    encrypted: boolean;
    crossRegion?: boolean | undefined;
    region?: string | undefined;
  },
) {
  const server = await loadMhServer(id);
  if (!server) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.vpsBackupPolicy.findFirst({
      where: { serverId: server.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    if (existing) {
      await tx.vpsBackupPolicy.update({
        where: { id: existing.id },
        data: {
          status: policy.enabled ? VpsBackupPolicyStatus.ACTIVE : VpsBackupPolicyStatus.DISABLED,
          frequency: policy.frequency,
          retentionCount: policy.retentionCount,
          encrypted: policy.encrypted,
          crossRegion: policy.crossRegion === true,
          nextRunAt: policy.enabled ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
        },
      });
    } else {
      await tx.vpsBackupPolicy.create({
        data: {
          serverId: server.id,
          status: policy.enabled ? VpsBackupPolicyStatus.ACTIVE : VpsBackupPolicyStatus.DISABLED,
          frequency: policy.frequency,
          retentionCount: policy.retentionCount,
          encrypted: policy.encrypted,
          crossRegion: policy.crossRegion === true,
          nextRunAt: policy.enabled ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
        },
      });
    }

    await tx.vpsServer.update({
      where: { id: server.id },
      data: {
        backupsEnabled: policy.enabled,
        backupRegion: policy.region || null,
      },
    });
  });

  const summary = await syncMhBindingState(server.id);
  if (!summary) {
    throw new Error("Unable to refresh MH backup policy state.");
  }

  await writeMhAuditEvent(server, "MH_API_BACKUP_POLICY_UPDATED", {
    enabled: policy.enabled,
    frequency: policy.frequency,
    retentionCount: policy.retentionCount,
  });

  return actionResult(summary, "backup_policy_updated");
}

export async function getMhApiMetrics(id: string, range: string) {
  const server = await prisma.vpsServer.findFirst({
    where: serverWhere(id),
    select: {
      id: true,
      metrics: {
        orderBy: { capturedAt: "desc" },
        take: range === "1h" ? 12 : range === "24h" ? 24 : range === "7d" ? 84 : 120,
        select: {
          capturedAt: true,
          cpuPercent: true,
          memoryPercent: true,
          diskPercent: true,
          networkInMbps: true,
          networkOutMbps: true,
          uptimeSeconds: true,
        },
      },
    },
  });

  if (!server) {
    return null;
  }

  const ordered = [...server.metrics].reverse();
  return {
    range,
    points: ordered.map((metric) => ({
      capturedAt: metric.capturedAt.toISOString(),
      cpuPercent: metric.cpuPercent,
      memoryPercent: metric.memoryPercent,
      diskPercent: metric.diskPercent,
      networkInMbps: metric.networkInMbps,
      networkOutMbps: metric.networkOutMbps,
      uptimeSeconds: Number(metric.uptimeSeconds),
    })),
    uptimeSeconds: ordered.length > 0 ? Number(ordered[ordered.length - 1].uptimeSeconds) : 0,
  } satisfies ProviderMetricsResult;
}