import { ProductKey, type Membership, type Organization } from "@prisma/client";
import { isEntitlementRuntimeAllowed } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { getControlPlaneRestriction, getVpsCapabilities } from "@/lib/vps/access";
import { listVpsAlertEvents } from "@/lib/vps/alerts";
import { resolveActorRole } from "@/lib/vps/authz";
import { buildVpsRecommendedActions, getServerDiagnostics } from "@/lib/vps/diagnostics";
import { syncFirewallStateFromProvider } from "@/lib/vps/firewall/apply";
import { firewallTemplates } from "@/lib/vps/firewall/templates";
import { validateFirewallState } from "@/lib/vps/firewall/validation";
import { getVpsFeatureFlags, isVpsSyncStale, VPS_SYNC_STALE_AFTER_SECONDS } from "@/lib/vps/features";
import { getPrimaryProviderBinding } from "@/lib/vps/queries";
import { buildVpsFleetProviderStatuses, getVpsProviderLabel, getVpsProviderRuntimeSummary, isVpsProviderConfigured } from "@/lib/vps/providers/config";
import { getVpsProviderAdapter } from "@/lib/vps/providers";
import type { VpsDashboardPayload, VpsFleetItem, VpsFleetWorkspace } from "@/lib/vps/types";

type MembershipWithOrg = Membership & { org: Organization };

function toIso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function asNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStubBindingMetadata(value: unknown) {
  return isObject(value) && value.mode === "stub";
}

function buildSshEndpoint(server: {
  defaultUsername: string;
  publicIpv4: string;
  sshPort: number;
}): string {
  return `${server.defaultUsername}@${server.publicIpv4}:${server.sshPort}`;
}

function formatPlanLabel(server: {
  planName: string | null;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  bandwidthTb: number;
}): string {
  const base = server.planName || `${server.vcpu} vCPU`;
  return `${base} · ${server.vcpu} vCPU / ${Math.round(server.memoryMb / 1024)} GB / ${server.diskGb} GB / ${server.bandwidthTb} TB`;
}

function buildActivityMessage(eventType: string, payloadJson: unknown): string {
  if (payloadJson && typeof payloadJson === "object" && payloadJson !== null && "message" in payloadJson) {
    const message = (payloadJson as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return eventType
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

async function listOpenVpsIncidentServerIds(orgId: string) {
  const incidents = await prisma.vpsIncident.findMany({
    where: {
      orgId,
      state: { in: ["OPEN", "ACKNOWLEDGED", "MITIGATING"] },
    },
    select: {
      serverId: true,
    },
  });

  return new Set(incidents.map((incident) => incident.serverId));
}

async function listOpenVpsAlertCounts(orgId: string) {
  const events = await prisma.vpsAlertEvent.findMany({
    where: {
      orgId,
      status: { in: ["ACTIVE", "ACKNOWLEDGED"] },
    },
    select: {
      serverId: true,
    },
  });

  return events.reduce<Map<string, number>>((counts, event) => {
    counts.set(event.serverId, (counts.get(event.serverId) || 0) + 1);
    return counts;
  }, new Map());
}

export async function orgPrefersVpsWorkspace(membership: MembershipWithOrg): Promise<boolean> {
  if (membership.org.isMigraHostingClient) {
    return true;
  }

  const entitlement = await prisma.orgEntitlement.findFirst({
    where: {
      orgId: membership.orgId,
      product: ProductKey.MIGRAHOSTING,
    },
    select: {
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  return isEntitlementRuntimeAllowed(entitlement);
}

async function listVpsServerRowsForOrg(orgId: string) {
  return prisma.vpsServer.findMany({
    where: { orgId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      providerSlug: true,
      providerServerId: true,
      name: true,
      hostname: true,
      status: true,
      powerState: true,
      publicIpv4: true,
      region: true,
      osName: true,
      planName: true,
      vcpu: true,
      memoryMb: true,
      diskGb: true,
      bandwidthTb: true,
      renewalAt: true,
      monthlyPriceCents: true,
      billingCurrency: true,
      backupsEnabled: true,
      firewallEnabled: true,
      providerHealthState: true,
      driftDetectedAt: true,
      driftType: true,
      lastSyncedAt: true,
      monitoringStatus: true,
      providerBindings: {
        orderBy: { updatedAt: "desc" },
        select: {
          providerSlug: true,
          providerServerId: true,
          providerRegionId: true,
          providerPlanId: true,
          metadataJson: true,
          lastSyncedAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

function mapFleetItems(
  rows: Awaited<ReturnType<typeof listVpsServerRowsForOrg>>,
  openIncidentServerIds: Set<string>,
  openAlertCounts: Map<string, number>,
): VpsFleetItem[] {
  return rows.map((row) => {
    const renewalAt = toIso(row.renewalAt);
    const lastSyncedAt = toIso(row.lastSyncedAt);

    return {
      id: row.id,
      providerSlug: row.providerSlug,
      name: row.name,
      hostname: row.hostname,
      status: row.status,
      powerState: row.powerState,
      publicIpv4: row.publicIpv4,
      region: row.region,
      osName: row.osName,
      planLabel: formatPlanLabel(row),
      cpuRamLabel: `${row.vcpu} vCPU / ${Math.round(row.memoryMb / 1024)} GB RAM`,
      monthlyPriceCents: row.monthlyPriceCents,
      billingCurrency: row.billingCurrency,
      backupsEnabled: row.backupsEnabled,
      firewallEnabled: row.firewallEnabled,
      providerHealthState: row.providerHealthState,
      incidentOpen: openIncidentServerIds.has(row.id),
      openAlertCount: openAlertCounts.get(row.id) || 0,
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
      ...(toIso(row.driftDetectedAt) ? { driftDetectedAt: toIso(row.driftDetectedAt) } : {}),
      ...(row.driftType ? { driftType: row.driftType } : {}),
      ...(renewalAt ? { renewalAt } : {}),
      ...(row.monitoringStatus ? { monitoringStatus: row.monitoringStatus } : {}),
    };
  });
}

export async function listVpsServersForOrg(orgId: string): Promise<VpsFleetItem[]> {
  const [rows, openIncidentServerIds, openAlertCounts] = await Promise.all([
    listVpsServerRowsForOrg(orgId),
    listOpenVpsIncidentServerIds(orgId),
    listOpenVpsAlertCounts(orgId),
  ]);

  return mapFleetItems(rows, openIncidentServerIds, openAlertCounts);
}

export async function getVpsFleetWorkspace(membership: MembershipWithOrg): Promise<VpsFleetWorkspace> {
  const [prefersVpsWorkspace, serverRows, openIncidentServerIds, openAlertCounts] = await Promise.all([
    orgPrefersVpsWorkspace(membership),
    listVpsServerRowsForOrg(membership.orgId),
    listOpenVpsIncidentServerIds(membership.orgId),
    listOpenVpsAlertCounts(membership.orgId),
  ]);
  const servers = mapFleetItems(serverRows, openIncidentServerIds, openAlertCounts);

  const summary = {
    total: servers.length,
    running: servers.filter((server) => server.status === "RUNNING").length,
    protected: servers.filter((server) => server.backupsEnabled).length,
    monitored: servers.filter((server) => server.monitoringStatus === "HEALTHY").length,
    monthlyTotalCents: servers.reduce((sum, server) => sum + server.monthlyPriceCents, 0),
    degraded: servers.filter((server) => server.providerHealthState !== "HEALTHY").length,
    unreachable: servers.filter((server) => server.providerHealthState === "UNREACHABLE").length,
    drifted: servers.filter((server) => Boolean(server.driftDetectedAt)).length,
    incidentOpen: servers.filter((server) => server.incidentOpen).length,
  };

  const providerStats = serverRows.reduce<Record<string, { serverCount: number; stubServerCount: number; lastSyncedAt?: string }>>((stats, server) => {
    const current = stats[server.providerSlug] || { serverCount: 0, stubServerCount: 0 };
    const lastSyncedAt = server.lastSyncedAt
      ? !current.lastSyncedAt || new Date(server.lastSyncedAt).getTime() > new Date(current.lastSyncedAt).getTime()
        ? server.lastSyncedAt.toISOString()
        : current.lastSyncedAt
      : current.lastSyncedAt;
    const primaryBinding = getPrimaryProviderBinding({
      providerSlug: server.providerSlug,
      providerServerId: server.providerServerId,
      providerBindings: server.providerBindings,
    });

    stats[server.providerSlug] = {
      serverCount: current.serverCount + 1,
      stubServerCount: current.stubServerCount + (isStubBindingMetadata(primaryBinding?.metadataJson) ? 1 : 0),
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
    };
    return stats;
  }, {});
  const providers = await buildVpsFleetProviderStatuses(providerStats);
  const canImportFromProviders = providers.some((provider) => provider.configured);
  const latestSync = servers
    .map((server) => server.lastSyncedAt)
    .filter((value): value is string => Boolean(value))
    .reduce<string | undefined>((latest, value) => {
      if (!latest) {
        return value;
      }

      return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
    }, undefined);
  const staleServerCount = servers.filter((server) => !server.lastSyncedAt || isVpsSyncStale(new Date(server.lastSyncedAt))).length;

  let workspaceState: VpsFleetWorkspace["workspaceState"] = "ACTIVE";
  let banner: VpsFleetWorkspace["banner"] | undefined;

  if (!prefersVpsWorkspace && !servers.length) {
    workspaceState = "NOT_ENABLED";
    banner = {
      tone: "warning",
      title: "VPS workspace not enabled",
      description: "This organization does not currently have MigraHosting VPS access enabled.",
    };
  } else if (!servers.length && !canImportFromProviders) {
    workspaceState = "NO_PROVIDER_CONFIGURED";
    banner = {
      tone: "warning",
      title: "No provider connection configured",
      description: "The portal is active, but no provider API credentials are connected to discover live inventory yet.",
    };
  } else if (!servers.length) {
    workspaceState = "READY_FOR_IMPORT";
    banner = {
      tone: "neutral",
      title: "Provider inventory is ready to import",
      description: "At least one provider is connected. Run an import to attach live servers to this workspace.",
    };
  } else if (providers.some((provider) => provider.runtimeConfigured && (provider.healthState === "DEGRADED" || provider.healthState === "UNREACHABLE"))) {
    workspaceState = "SYNC_ATTENTION";
    banner = {
      tone: "danger",
      title: "Provider runtime health needs attention",
      description: "At least one configured provider is degraded or unreachable. Inventory may remain visible while live control authority is impaired.",
    };
  } else if (summary.drifted > 0) {
    workspaceState = "SYNC_ATTENTION";
    banner = {
      tone: "warning",
      title: "Configuration drift detected",
      description: `${summary.drifted} ${summary.drifted === 1 ? "server is" : "servers are"} reporting drift between local control-plane state and the provider.`,
    };
  } else if (staleServerCount > 0) {
    workspaceState = "SYNC_ATTENTION";
    banner = {
      tone: "danger",
      title: "Fleet sync needs attention",
      description: `${staleServerCount} ${staleServerCount === 1 ? "server is" : "servers are"} past the sync freshness window. Run a fleet sync to refresh provider state.`,
    };
  }

  return {
    prefersVpsWorkspace,
    servers,
    summary,
    providers,
    sync: {
      status: !servers.length
        ? canImportFromProviders
          ? "PENDING_IMPORT"
          : "UNAVAILABLE"
        : staleServerCount > 0
          ? "STALE"
          : "HEALTHY",
      staleServerCount,
      ...(latestSync ? { lastSyncedAt: latestSync } : {}),
    },
    workspaceState,
    canImportFromProviders,
    ...(banner ? { banner } : {}),
  };
}

export async function getVpsServerChrome(serverId: string, orgId: string) {
  return prisma.vpsServer.findFirst({
    where: {
      id: serverId,
      orgId,
    },
    select: {
      id: true,
      name: true,
      hostname: true,
      status: true,
      powerState: true,
      publicIpv4: true,
      sshPort: true,
      defaultUsername: true,
      region: true,
      datacenterLabel: true,
      osName: true,
      planName: true,
      vcpu: true,
      memoryMb: true,
      diskGb: true,
      bandwidthTb: true,
      monthlyPriceCents: true,
      billingCurrency: true,
      renewalAt: true,
      firewallEnabled: true,
      firewallProfileName: true,
      backupsEnabled: true,
      monitoringStatus: true,
      supportTier: true,
    },
  });
}

export async function getVpsDashboardPayload(
  serverId: string,
  membership: MembershipWithOrg,
): Promise<VpsDashboardPayload | null> {
  const server = await prisma.vpsServer.findFirst({
    where: {
      id: serverId,
      orgId: membership.orgId,
    },
    select: {
      id: true,
      instanceId: true,
      providerSlug: true,
      providerServerId: true,
      providerRegionId: true,
      providerPlanId: true,
      name: true,
      hostname: true,
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
      snapshotCountCached: true,
      nextInvoiceAt: true,
      renewalAt: true,
      billingCycle: true,
      monthlyPriceCents: true,
      billingCurrency: true,
      supportTier: true,
      providerHealthState: true,
      providerLastCheckedAt: true,
      providerError: true,
      driftDetectedAt: true,
      driftType: true,
      supportTicketUrl: true,
      supportDocsUrl: true,
      rescueEnabled: true,
      lastSyncedAt: true,
      createdAt: true,
      providerBindings: {
        orderBy: { updatedAt: "desc" },
        select: {
          providerSlug: true,
          providerServerId: true,
          providerRegionId: true,
          providerPlanId: true,
          metadataJson: true,
          lastSyncedAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!server) {
    return null;
  }

  const [metrics, backupPolicy, snapshotAgg, latestSnapshot, auditEvents, supportLinks, pendingActionCount, providerRuntime, diagnostics] = await Promise.all([
    prisma.vpsMetricRollup.findMany({
      where: { serverId: server.id },
      orderBy: { capturedAt: "desc" },
      take: 12,
      select: {
        cpuPercent: true,
        memoryPercent: true,
        diskPercent: true,
        networkInMbps: true,
        networkOutMbps: true,
        uptimeSeconds: true,
      },
    }),
    prisma.vpsBackupPolicy.findFirst({
      where: { serverId: server.id },
      orderBy: { updatedAt: "desc" },
      select: {
        status: true,
        frequency: true,
        retentionCount: true,
        lastSuccessAt: true,
        nextRunAt: true,
        encrypted: true,
        crossRegion: true,
      },
    }),
    prisma.vpsSnapshot.count({
      where: { serverId: server.id },
    }),
    prisma.vpsSnapshot.findFirst({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.vpsAuditEvent.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        actorUserId: true,
        eventType: true,
        severity: true,
        payloadJson: true,
        createdAt: true,
      },
    }),
    prisma.vpsSupportLink.findMany({
      where: { serverId: server.id },
      orderBy: [{ lastUpdatedAt: "desc" }, { updatedAt: "desc" }],
      take: 10,
      select: {
        id: true,
        status: true,
        lastUpdatedAt: true,
        updatedAt: true,
      },
    }),
    prisma.vpsActionJob.count({
      where: {
        serverId: server.id,
        status: { in: ["QUEUED", "RUNNING"] },
      },
    }),
    getVpsProviderRuntimeSummary(server.providerSlug),
    getServerDiagnostics(server.id, membership.orgId),
  ]);

  const latestMetric = metrics[0];
  const series = [...metrics].reverse();
  const resolvedRole = await resolveActorRole({
    userId: membership.userId,
    orgId: membership.orgId,
    role: membership.role,
  }, server.id);
  const capabilities = getVpsCapabilities(resolvedRole.role);
  const provider = getVpsProviderAdapter(server.providerSlug);
  const runtimeConfigured = isVpsProviderConfigured(server.providerSlug);
  const providerLabel = getVpsProviderLabel(server.providerSlug);
  const primaryBinding = getPrimaryProviderBinding({
    providerSlug: server.providerSlug,
    providerServerId: server.providerServerId,
    providerBindings: server.providerBindings,
  });
  const isStubControlled = isStubBindingMetadata(primaryBinding?.metadataJson);
  const featureFlags = getVpsFeatureFlags();
  const effectiveFeatures = {
    console: featureFlags.console && provider.capabilities.console,
    firewall: featureFlags.firewall && provider.capabilities.firewallRead,
    snapshots: featureFlags.snapshots && provider.capabilities.snapshots,
    backups: featureFlags.backups && provider.capabilities.backups,
    monitoring: featureFlags.monitoring && provider.capabilities.metrics,
    rebuild: featureFlags.rebuild && provider.capabilities.rebuild,
    supportDiagnostics: featureFlags.supportDiagnostics,
  };
  const renewalAt = toIso(server.renewalAt);
  const nextInvoiceAt = toIso(server.nextInvoiceAt);
  const lastSuccessAt = toIso(backupPolicy?.lastSuccessAt);
  const nextRunAt = toIso(backupPolicy?.nextRunAt);
  const latestSnapshotAt = toIso(latestSnapshot?.createdAt);
  const lastSyncedAt = diagnostics?.server.lastSyncedAt || toIso(server.lastSyncedAt);
  const latestTicketUpdatedAt = supportLinks[0] ? toIso(supportLinks[0].lastUpdatedAt || supportLinks[0].updatedAt) : undefined;
  const openTicketCount = supportLinks.filter((item) => item.status !== "CLOSED" && item.status !== "RESOLVED").length;
  const isStale = isVpsSyncStale(lastSyncedAt ? new Date(lastSyncedAt) : null);
  const controlMode = isStubControlled ? "STUB" : runtimeConfigured ? "LIVE_API" : "UNCONFIGURED";
  const controlDetail = isStubControlled
    ? runtimeConfigured
      ? `${providerLabel} runtime credentials are present, but this server remains pinned to stub-backed control data until the binding is migrated to live provider authority.`
      : `${providerLabel} runtime credentials are missing, so this server is operating through persisted stub-backed control data instead of a live provider API.`
    : runtimeConfigured
      ? `${providerLabel} live API control is available for sync and lifecycle actions.`
      : `${providerLabel} runtime credentials are missing, so live provider sync and write actions should not be treated as authoritative.`;
  const healthState = diagnostics?.provider.health || server.providerHealthState;
  const healthDetail = diagnostics?.provider.error || providerRuntime?.healthDetail || "Provider health has not been checked for this server.";
  const canRunAction = (action: Parameters<typeof getControlPlaneRestriction>[0]["action"], allowed: boolean) => {
    if (!allowed) {
      return false;
    }

    return !getControlPlaneRestriction({
      providerHealthState: diagnostics?.provider.health || server.providerHealthState,
      action,
    }).blocked;
  };

  return {
    diagnostics: diagnostics || {
      server: {
        id: server.id,
        status: server.status,
        powerState: server.powerState,
        lastSyncedAt: lastSyncedAt || null,
      },
      provider: {
        health: server.providerHealthState,
        lastCheckedAt: toIso(server.providerLastCheckedAt) || null,
        error: server.providerError || null,
      },
      drift: {
        detected: Boolean(server.driftDetectedAt),
        type: server.driftType || null,
        detectedAt: toIso(server.driftDetectedAt) || null,
      },
      alerts: {
        openCount: 0,
        criticalCount: 0,
        items: [],
      },
      incident: null,
      lastJob: null,
      lastFailedJob: null,
      remediation: {
        lastRun: null,
        lastStatus: null,
      },
      sla: null,
    },
    server: {
      id: server.id,
      instanceId: server.instanceId,
      providerSlug: server.providerSlug,
      name: server.name,
      hostname: server.hostname,
      status: server.status,
      powerState: server.powerState,
      publicIpv4: server.publicIpv4,
      sshEndpoint: buildSshEndpoint(server),
      region: server.region,
      osName: server.osName,
      imageSlug: server.imageSlug,
      plan: {
        slug: server.planSlug,
        vcpu: server.vcpu,
        memoryGb: Math.round(server.memoryMb / 1024),
        diskGb: server.diskGb,
        bandwidthTb: server.bandwidthTb,
        ...(server.planName ? { name: server.planName } : {}),
      },
      billing: {
        monthlyPriceCents: server.monthlyPriceCents,
        cycle: server.billingCycle,
        currency: server.billingCurrency,
        ...(renewalAt ? { renewalAt } : {}),
        ...(nextInvoiceAt ? { nextInvoiceAt } : {}),
      },
      support: {
        tier: server.supportTier || "STANDARD",
        openTicketCount,
        ...(server.supportTicketUrl ? { ticketUrl: server.supportTicketUrl } : {}),
        ...(server.supportDocsUrl ? { docsUrl: server.supportDocsUrl } : {}),
        ...(latestTicketUpdatedAt ? { latestTicketUpdatedAt } : {}),
      },
      providerHealthState: diagnostics?.provider.health || server.providerHealthState,
      ...(diagnostics?.provider.lastCheckedAt ? { providerLastCheckedAt: diagnostics.provider.lastCheckedAt } : {}),
      ...(diagnostics?.provider.error ? { providerError: diagnostics.provider.error } : {}),
      ...(diagnostics?.drift.detectedAt ? { driftDetectedAt: diagnostics.drift.detectedAt } : {}),
      ...(diagnostics?.drift.type ? { driftType: diagnostics.drift.type } : {}),
      createdAt: server.createdAt.toISOString(),
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
      backupsEnabled: server.backupsEnabled,
      monitoringEnabled: server.monitoringEnabled,
      firewallEnabled: server.firewallEnabled,
      rescueEnabled: server.rescueEnabled,
      defaultUsername: server.defaultUsername,
      sshPort: server.sshPort,
      bandwidthUsedGb: server.bandwidthUsedGb,
      ...(server.privateIpv4 ? { privateIpv4: server.privateIpv4 } : {}),
      ...(server.providerServerId ? { providerServerId: server.providerServerId } : {}),
      ...(server.providerRegionId ? { providerRegionId: server.providerRegionId } : {}),
      ...(server.providerPlanId ? { providerPlanId: server.providerPlanId } : {}),
      ...(server.datacenterLabel ? { datacenterLabel: server.datacenterLabel } : {}),
      ...(server.imageVersion ? { imageVersion: server.imageVersion } : {}),
      ...(server.reverseDns ? { reverseDns: server.reverseDns } : {}),
      ...(server.reverseDnsStatus ? { reverseDnsStatus: server.reverseDnsStatus } : {}),
      ...(server.monitoringStatus ? { monitoringStatus: server.monitoringStatus } : {}),
      ...(server.firewallProfileName ? { firewallProfileName: server.firewallProfileName } : {}),
      ...(server.privateNetwork ? { privateNetwork: server.privateNetwork } : {}),
      ...(server.gatewayIpv4 ? { gatewayIpv4: server.gatewayIpv4 } : {}),
      ...(server.virtualizationType ? { virtualizationType: server.virtualizationType } : {}),
    },
    features: effectiveFeatures,
    sync: {
      isStale,
      staleAfterSeconds: VPS_SYNC_STALE_AFTER_SECONDS,
      pendingActionCount,
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
    },
    control: {
      providerLabel,
      mode: controlMode,
      runtimeConfigured,
      detail: controlDetail,
      healthState,
      healthDetail,
      ...(providerRuntime?.healthCheckedAt ? { checkedAt: providerRuntime.healthCheckedAt } : {}),
      safeMode: (diagnostics?.provider.health || server.providerHealthState) === "DEGRADED",
    },
    actions: {
      canOpenConsole: canRunAction("OPEN_CONSOLE_SESSION", capabilities.canOpenConsole && effectiveFeatures.console),
      canSync: canRunAction("MANUAL_SYNC", capabilities.canView),
      canReboot: canRunAction("REBOOT", capabilities.canReboot && provider.capabilities.powerControl),
      canPowerControl: canRunAction("POWER_OFF", capabilities.canPowerControl && provider.capabilities.powerControl),
      canRescue: canRunAction("ENABLE_RESCUE", capabilities.canRescue && provider.capabilities.rescue),
      canRebuild: canRunAction("REBUILD", capabilities.canRebuild && effectiveFeatures.rebuild),
      canManageFirewall: canRunAction("UPDATE_FIREWALL", capabilities.canManageFirewall && featureFlags.firewall && provider.capabilities.firewallWrite),
      canManageSnapshots: canRunAction("DELETE_SNAPSHOT", capabilities.canManageSnapshots && effectiveFeatures.snapshots),
      canManageBackups: canRunAction("UPDATE_BACKUP_POLICY", capabilities.canManageBackups && effectiveFeatures.backups),
      canManageBilling: capabilities.canManageBilling,
      canOpenSupport: capabilities.canOpenSupport,
    },
    drift: {
      detected: diagnostics?.drift.detected || false,
      ...(diagnostics?.drift.type ? { type: diagnostics.drift.type } : {}),
      ...(diagnostics?.drift.detectedAt ? { detectedAt: diagnostics.drift.detectedAt } : {}),
    },
    monitoring: {
      cpuPercent: latestMetric?.cpuPercent || 0,
      memoryPercent: latestMetric?.memoryPercent || 0,
      diskPercent: latestMetric?.diskPercent || 0,
      networkInMbps: latestMetric?.networkInMbps || 0,
      networkOutMbps: latestMetric?.networkOutMbps || 0,
      uptimeSeconds: latestMetric ? asNumber(latestMetric.uptimeSeconds) : 0,
      cpuSeries: series.map((item) => item.cpuPercent),
      memorySeries: series.map((item) => item.memoryPercent),
      diskSeries: series.map((item) => item.diskPercent),
      networkInSeries: series.map((item) => item.networkInMbps),
      networkOutSeries: series.map((item) => item.networkOutMbps),
    },
    backups: {
      enabled: server.backupsEnabled && backupPolicy?.status === "ACTIVE",
      ...(lastSuccessAt ? { lastSuccessAt } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
      ...(backupPolicy?.frequency ? { frequency: backupPolicy.frequency } : {}),
      ...(backupPolicy?.retentionCount !== undefined ? { retentionCount: backupPolicy.retentionCount } : {}),
      ...(backupPolicy?.encrypted !== undefined ? { encrypted: backupPolicy.encrypted } : {}),
      ...(backupPolicy?.crossRegion !== undefined ? { crossRegion: backupPolicy.crossRegion } : {}),
    },
    snapshots: {
      count: Math.max(snapshotAgg, server.snapshotCountCached),
      ...(latestSnapshotAt ? { latestCreatedAt: latestSnapshotAt } : {}),
    },
    activity: auditEvents.map((event) => ({
      id: event.id,
      type: event.eventType,
      message: buildActivityMessage(event.eventType, event.payloadJson),
      actor: event.actorUserId || "SYSTEM",
      createdAt: event.createdAt.toISOString(),
      status:
        event.severity === "ERROR" || event.severity === "CRITICAL"
          ? "FAILED"
          : event.eventType.includes("REQUESTED") || event.eventType.includes("STARTED")
            ? "PENDING"
            : "SUCCESS",
      severity: event.severity,
    })),
  };
}

export async function listVpsSnapshots(serverId: string, orgId: string) {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: { id: true },
  });

  if (!server) {
    return null;
  }

  return prisma.vpsSnapshot.findMany({
    where: { serverId: server.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      note: true,
      status: true,
      sizeGb: true,
      createdBy: true,
      createdAt: true,
    },
  });
}

export async function listVpsActivity(serverId: string, orgId: string, take = 40) {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: { id: true },
  });

  if (!server) {
    return null;
  }

  await getVpsDiagnosticsState(server.id, orgId);

  const [events, jobs, alerts] = await Promise.all([
    prisma.vpsAuditEvent.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        actorUserId: true,
        eventType: true,
        severity: true,
        payloadJson: true,
        createdAt: true,
      },
    }),
    prisma.vpsActionJob.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        action: true,
        status: true,
        requestedByUserId: true,
        createdAt: true,
      },
    }),
    listVpsAlertEvents(server.id, orgId, { includeResolved: true }),
  ]);

  return {
    events,
    jobs,
    alerts: alerts.slice(0, take),
  };
}

export async function getVpsFirewallState(serverId: string, orgId: string) {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: {
      id: true,
      providerSlug: true,
      firewallEnabled: true,
      firewallProfileName: true,
      sshPort: true,
      lastSyncedAt: true,
    },
  });

  if (!server) {
    return null;
  }

  const provider = getVpsProviderAdapter(server.providerSlug);
  const state = await syncFirewallStateFromProvider({
    serverId: server.id,
    orgId,
  });
  const validation = validateFirewallState(state, server.sshPort);

  return {
    enabled: state.isEnabled !== false,
    providerSlug: server.providerSlug,
    capabilities: provider.capabilities,
    profileId: state.profileId,
    profileName: state.profileName || server.firewallProfileName || "Default VPS Firewall",
    status: state.status || (server.firewallEnabled ? "ACTIVE" : "DISABLED"),
    isActive: state.isActive || false,
    lastAppliedAt: state.lastAppliedAt || toIso(server.lastSyncedAt),
    lastApplyJobId: state.lastApplyJobId || null,
    lastError: state.lastError || null,
    rollbackWindowSec: state.rollbackWindowSec,
    rollbackPendingUntil: state.rollbackPendingUntil || null,
    confirmedAt: state.confirmedAt || null,
    driftDetectedAt: state.driftDetectedAt || null,
    defaults: {
      inbound: state.inboundDefaultAction,
      outbound: state.outboundDefaultAction,
    },
    antiLockoutEnabled: state.antiLockoutEnabled,
    antiLockoutSatisfied: validation.antiLockoutSatisfied,
    validation,
    ruleCount: state.rules.length,
    rules: state.rules,
    inboundRules: state.rules.filter((rule) => rule.direction === "INBOUND"),
    outboundRules: state.rules.filter((rule) => rule.direction === "OUTBOUND"),
    templates: firewallTemplates,
  };
}

export async function getVpsBackupState(serverId: string, orgId: string) {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: {
      id: true,
      backupsEnabled: true,
      backupRegion: true,
      lastSyncedAt: true,
    },
  });

  if (!server) {
    return null;
  }

  const policy = await prisma.vpsBackupPolicy.findFirst({
    where: { serverId: server.id },
    orderBy: { updatedAt: "desc" },
  });

  return {
    enabled: server.backupsEnabled,
    region: server.backupRegion,
    lastSyncedAt: toIso(server.lastSyncedAt),
    policy,
  };
}

export async function getVpsMonitoringState(serverId: string, orgId: string, take = 24) {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: {
      id: true,
      monitoringEnabled: true,
      monitoringStatus: true,
      lastSyncedAt: true,
    },
  });

  if (!server) {
    return null;
  }

  const metrics = await prisma.vpsMetricRollup.findMany({
    where: { serverId: server.id },
    orderBy: { capturedAt: "desc" },
    take,
  });

  return {
    enabled: server.monitoringEnabled,
    status: server.monitoringStatus || "UNKNOWN",
    lastSyncedAt: toIso(server.lastSyncedAt),
    metrics: metrics.reverse().map((item) => ({
      capturedAt: item.capturedAt,
      cpuPercent: item.cpuPercent,
      memoryPercent: item.memoryPercent,
      diskPercent: item.diskPercent,
      networkInMbps: item.networkInMbps,
      networkOutMbps: item.networkOutMbps,
      uptimeSeconds: asNumber(item.uptimeSeconds),
    })),
  };
}

export async function getVpsBillingState(serverId: string, orgId: string) {
  return prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: {
      id: true,
      planSlug: true,
      planName: true,
      vcpu: true,
      memoryMb: true,
      diskGb: true,
      bandwidthTb: true,
      monthlyPriceCents: true,
      billingCurrency: true,
      billingCycle: true,
      nextInvoiceAt: true,
      renewalAt: true,
      supportTier: true,
      supportTicketUrl: true,
      supportDocsUrl: true,
      providerHealthState: true,
      providerLastCheckedAt: true,
      providerError: true,
      driftDetectedAt: true,
      driftType: true,
      lastSyncedAt: true,
    },
  });
}

export async function getVpsDiagnosticsState(serverId: string, orgId: string) {
  return getServerDiagnostics(serverId, orgId);
}

export async function getVpsSupportState(serverId: string, orgId: string) {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: {
      id: true,
      name: true,
      hostname: true,
      publicIpv4: true,
      status: true,
      supportTier: true,
      supportTicketUrl: true,
      supportDocsUrl: true,
      backupPolicies: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          status: true,
          lastSuccessAt: true,
          nextRunAt: true,
        },
      },
    },
  });

  if (!server) {
    return null;
  }

  const diagnostics = await getVpsDiagnosticsState(server.id, orgId);

  const [tickets, actions, audits, firewallProfile, latestSnapshot, alerts] = await Promise.all([
    prisma.vpsSupportLink.findMany({
      where: { serverId: server.id },
      orderBy: [{ lastUpdatedAt: "desc" }, { updatedAt: "desc" }],
      take: 20,
    }),
    prisma.vpsActionJob.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.vpsAuditEvent.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        eventType: true,
        severity: true,
        createdAt: true,
      },
    }),
    prisma.vpsFirewallProfile.findFirst({
      where: { serverId: server.id },
      orderBy: { updatedAt: "desc" },
      select: {
        name: true,
        status: true,
        updatedAt: true,
      },
    }),
    prisma.vpsSnapshot.findFirst({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
      },
    }),
    listVpsAlertEvents(server.id, orgId),
  ]);

  return {
    server,
    tickets,
    alerts,
    diagnostics,
    recommendedActions: diagnostics ? buildVpsRecommendedActions(diagnostics) : [],
    diagnosticsSummary: {
      recentActionCount: actions.length,
      recentAuditCount: audits.length,
      recentAlertCount: alerts.length,
      firewallProfile: firewallProfile?.name || "Not synced",
      firewallStatus: firewallProfile?.status || "UNKNOWN",
      latestSnapshot: latestSnapshot
        ? {
          id: latestSnapshot.id,
          name: latestSnapshot.name,
          status: latestSnapshot.status,
          createdAt: latestSnapshot.createdAt.toISOString(),
        }
        : null,
      backupStatus: server.backupPolicies[0]?.status || "UNKNOWN",
      lastBackupAt: toIso(server.backupPolicies[0]?.lastSuccessAt),
      nextBackupAt: toIso(server.backupPolicies[0]?.nextRunAt),
    },
  };
}
