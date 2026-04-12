import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeVpsAuditEvent } from "@/lib/vps/audit";
import { getActiveFirewallProfile } from "@/lib/vps/queries";

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "bigint" ? Number(value) : value;
}

export async function buildVpsDiagnosticsBundle(input: {
  serverId: string;
  orgId: string;
}) {
  const server = await prisma.vpsServer.findFirst({
    where: {
      id: input.serverId,
      orgId: input.orgId,
    },
    include: {
      providerBindings: {
        orderBy: { updatedAt: "desc" },
      },
      firewallProfiles: {
        include: {
          rules: {
            orderBy: { priority: "asc" },
          },
        },
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      },
      backupPolicies: {
        orderBy: { updatedAt: "desc" },
        take: 5,
      },
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      supportLinks: {
        orderBy: [{ lastUpdatedAt: "desc" }, { updatedAt: "desc" }],
        take: 10,
      },
      actions: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
      audits: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      metrics: {
        orderBy: { capturedAt: "desc" },
        take: 24,
      },
    },
  });

  if (!server) {
    return null;
  }

  const activeFirewallProfile = getActiveFirewallProfile(server.firewallProfiles);

  return {
    generatedAt: new Date().toISOString(),
    server: {
      id: server.id,
      orgId: server.orgId,
      name: server.name,
      hostname: server.hostname,
      instanceId: server.instanceId,
      providerSlug: server.providerSlug,
      providerServerId: server.providerServerId,
      status: server.status,
      powerState: server.powerState,
      publicIpv4: server.publicIpv4,
      privateIpv4: server.privateIpv4,
      sshPort: server.sshPort,
      defaultUsername: server.defaultUsername,
      sshEndpoint: `${server.defaultUsername}@${server.publicIpv4}:${server.sshPort}`,
      region: server.region,
      datacenterLabel: server.datacenterLabel,
      osName: server.osName,
      imageSlug: server.imageSlug,
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
      snapshotCountCached: server.snapshotCountCached,
      rescueEnabled: server.rescueEnabled,
      supportTier: server.supportTier,
      supportTicketUrl: server.supportTicketUrl,
      supportDocsUrl: server.supportDocsUrl,
      billingCycle: server.billingCycle,
      monthlyPriceCents: server.monthlyPriceCents,
      billingCurrency: server.billingCurrency,
      nextInvoiceAt: toIso(server.nextInvoiceAt),
      renewalAt: toIso(server.renewalAt),
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
      lastSyncedAt: toIso(server.lastSyncedAt),
    },
    providerBindings: server.providerBindings.map((binding) => ({
      id: binding.id,
      providerSlug: binding.providerSlug,
      providerServerId: binding.providerServerId,
      providerRegionId: binding.providerRegionId,
      providerPlanId: binding.providerPlanId,
      lastSyncedAt: toIso(binding.lastSyncedAt),
      updatedAt: binding.updatedAt.toISOString(),
      metadataJson: binding.metadataJson,
    })),
    firewall: activeFirewallProfile
      ? {
          id: activeFirewallProfile.id,
          name: activeFirewallProfile.name,
          status: activeFirewallProfile.status,
          isActive: activeFirewallProfile.isActive,
          enabled: server.firewallEnabled,
          inboundDefaultAction: activeFirewallProfile.defaultInboundAction,
          outboundDefaultAction: activeFirewallProfile.defaultOutboundAction,
          antiLockoutEnabled: activeFirewallProfile.antiLockoutEnabled,
          rollbackWindowSec: activeFirewallProfile.rollbackWindowSec,
          lastAppliedAt: toIso(activeFirewallProfile.lastAppliedAt),
          lastApplyJobId: activeFirewallProfile.lastApplyJobId,
          lastError: activeFirewallProfile.lastError,
          rollbackPendingUntil: toIso(activeFirewallProfile.rollbackPendingUntil),
          confirmedAt: toIso(activeFirewallProfile.confirmedAt),
          driftDetectedAt: toIso(activeFirewallProfile.driftDetectedAt),
          rules: activeFirewallProfile.rules.map((rule) => ({
            id: rule.id,
            direction: rule.direction,
            action: rule.action,
            protocol: rule.protocol,
            portStart: rule.portStart,
            portEnd: rule.portEnd,
            portRange: rule.portRange,
            sourceCidr: rule.sourceCidr,
            destinationCidr: rule.destinationCidr,
            description: rule.description,
            priority: rule.priority,
            enabled: rule.enabled,
            expiresAt: toIso(rule.expiresAt),
            updatedAt: rule.updatedAt.toISOString(),
          })),
        }
      : null,
    backups: server.backupPolicies.map((policy) => ({
      id: policy.id,
      status: policy.status,
      frequency: policy.frequency,
      retentionCount: policy.retentionCount,
      encrypted: policy.encrypted,
      crossRegion: policy.crossRegion,
      lastSuccessAt: toIso(policy.lastSuccessAt),
      nextRunAt: toIso(policy.nextRunAt),
      updatedAt: policy.updatedAt.toISOString(),
    })),
    snapshots: server.snapshots.map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      note: snapshot.note,
      status: snapshot.status,
      sizeGb: snapshot.sizeGb,
      createdBy: snapshot.createdBy,
      createdAt: snapshot.createdAt.toISOString(),
    })),
    recentActionJobs: server.actions.map((job) => ({
      id: job.id,
      action: job.action,
      status: job.status,
      requestedByUserId: job.requestedByUserId,
      providerTaskId: job.providerTaskId,
      retryCount: job.retryCount,
      startedAt: toIso(job.startedAt),
      finishedAt: toIso(job.finishedAt),
      createdAt: job.createdAt.toISOString(),
      requestJson: job.requestJson,
      resultJson: job.resultJson,
      errorJson: job.errorJson,
    })),
    recentAuditEvents: server.audits.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      severity: event.severity,
      actorUserId: event.actorUserId,
      sourceIp: event.sourceIp,
      relatedJobId: event.relatedJobId,
      payloadJson: event.payloadJson,
      createdAt: event.createdAt.toISOString(),
    })),
    recentMetrics: server.metrics.map((rollup) => ({
      id: rollup.id,
      cpuPercent: rollup.cpuPercent,
      memoryPercent: rollup.memoryPercent,
      diskPercent: rollup.diskPercent,
      networkInMbps: rollup.networkInMbps,
      networkOutMbps: rollup.networkOutMbps,
      uptimeSeconds: toNumber(rollup.uptimeSeconds),
      capturedAt: rollup.capturedAt.toISOString(),
    })),
    supportLinks: server.supportLinks.map((ticket) => ({
      id: ticket.id,
      externalTicketId: ticket.externalTicketId,
      title: ticket.title,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      url: ticket.url,
      lastUpdatedAt: toIso(ticket.lastUpdatedAt),
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      metadataJson: ticket.metadataJson,
    })),
  };
}

export async function createVpsSupportRequest(input: {
  serverId: string;
  orgId: string;
  actorUserId: string;
  title: string;
  category: string;
  priority: string;
  details: string;
  includeDiagnostics: boolean;
  sourceIp?: string | null;
  userAgent?: string | null;
}) {
  const server = await prisma.vpsServer.findFirst({
    where: {
      id: input.serverId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      name: true,
      hostname: true,
      publicIpv4: true,
      status: true,
      powerState: true,
      supportTicketUrl: true,
      supportDocsUrl: true,
      lastSyncedAt: true,
      firewallProfileName: true,
      monitoringStatus: true,
      backupsEnabled: true,
      snapshotCountCached: true,
    },
  });

  if (!server) {
    throw Object.assign(new Error("VPS server not found."), { httpStatus: 404 });
  }

  const diagnosticsBundle = input.includeDiagnostics
    ? await buildVpsDiagnosticsBundle({
        serverId: input.serverId,
        orgId: input.orgId,
      })
    : null;

  const supportLink = await prisma.vpsSupportLink.create({
    data: {
      serverId: server.id,
      externalTicketId: `vps-${Date.now().toString(36)}`,
      title: input.title,
      category: input.category,
      priority: input.priority,
      status: "OPEN",
      url: server.supportTicketUrl || null,
      lastUpdatedAt: new Date(),
      metadataJson: jsonValue({
        details: input.details,
        requestedByUserId: input.actorUserId,
        sourceIp: input.sourceIp || null,
        userAgent: input.userAgent || null,
        includeDiagnostics: input.includeDiagnostics,
        diagnosticsSummary: diagnosticsBundle
          ? {
              generatedAt: diagnosticsBundle.generatedAt,
              status: diagnosticsBundle.server.status,
              powerState: diagnosticsBundle.server.powerState,
              firewallProfileName: diagnosticsBundle.server.firewallProfileName,
              monitoringStatus: diagnosticsBundle.server.monitoringStatus,
              backupsEnabled: diagnosticsBundle.server.backupsEnabled,
              snapshotCountCached: diagnosticsBundle.server.snapshotCountCached,
              recentActionCount: diagnosticsBundle.recentActionJobs.length,
              recentAuditCount: diagnosticsBundle.recentAuditEvents.length,
              lastSyncedAt: diagnosticsBundle.server.lastSyncedAt,
            }
          : null,
      }),
    },
  });

  await writeVpsAuditEvent({
    orgId: input.orgId,
    serverId: server.id,
    actorUserId: input.actorUserId,
    sourceIp: input.sourceIp || null,
    eventType: "SUPPORT_TICKET_CREATED",
    severity: "INFO",
    metadataJson: {
      supportLinkId: supportLink.id,
      externalTicketId: supportLink.externalTicketId,
      title: supportLink.title,
      category: supportLink.category,
      priority: supportLink.priority,
      includeDiagnostics: input.includeDiagnostics,
    },
  });

  return {
    ticket: {
      id: supportLink.id,
      externalTicketId: supportLink.externalTicketId,
      title: supportLink.title,
      category: supportLink.category,
      priority: supportLink.priority,
      status: supportLink.status,
      url: supportLink.url,
      createdAt: supportLink.createdAt.toISOString(),
      updatedAt: supportLink.updatedAt.toISOString(),
    },
    supportPortalUrl: server.supportTicketUrl || null,
    supportDocsUrl: server.supportDocsUrl || null,
  };
}