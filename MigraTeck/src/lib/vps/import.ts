import { FirewallProfileStatus, Prisma, ServerPowerState, SupportTier, VpsBillingCycle, VpsProviderHealthState, VpsStatus } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getConfiguredVpsProviderSlugs } from "@/lib/vps/providers/config";
import { getVpsProviderAdapter } from "@/lib/vps/providers/registry";
import type { ProviderServerSummary } from "@/lib/vps/providers";

const fleetSyncProviderSlugSchema = z.enum(["mh", "proxmox", "virtualizor"]);

export const vpsFleetSyncSchema = z.object({
  providerSlug: fleetSyncProviderSlugSchema.optional(),
});

export const vpsImportSchema = z.object({
  providerSlug: z.string().min(1).default("manual"),
  providerServerId: z.string().min(1).optional(),
  providerInstanceId: z.string().min(1).optional(),
  providerRegionId: z.string().min(1).optional(),
  providerPlanId: z.string().min(1).optional(),
  name: z.string().min(1),
  hostname: z.string().min(1),
  instanceId: z.string().min(1).optional(),
  status: z.nativeEnum(VpsStatus).default(VpsStatus.RUNNING),
  powerState: z.nativeEnum(ServerPowerState).default(ServerPowerState.ON),
  publicIpv4: z.string().min(1),
  privateIpv4: z.string().min(1).optional(),
  gatewayIpv4: z.string().min(1).optional(),
  privateNetwork: z.string().min(1).optional(),
  sshPort: z.number().int().positive().default(22),
  defaultUsername: z.string().min(1).default("root"),
  region: z.string().min(1),
  datacenterLabel: z.string().min(1).optional(),
  imageSlug: z.string().min(1),
  osName: z.string().min(1),
  imageVersion: z.string().min(1).optional(),
  virtualizationType: z.string().min(1).optional(),
  planSlug: z.string().min(1),
  planName: z.string().min(1).optional(),
  vcpu: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  diskGb: z.number().int().positive(),
  bandwidthTb: z.number().int().positive(),
  bandwidthUsedGb: z.number().int().min(0).default(0),
  reverseDns: z.string().min(1).optional(),
  reverseDnsStatus: z.string().min(1).optional(),
  firewallEnabled: z.boolean().default(true),
  firewallProfileName: z.string().min(1).optional(),
  monitoringEnabled: z.boolean().default(false),
  monitoringStatus: z.string().min(1).optional(),
  backupsEnabled: z.boolean().default(false),
  backupRegion: z.string().min(1).optional(),
  snapshotCount: z.number().int().min(0).default(0),
  nextInvoiceAt: z.string().datetime().optional(),
  renewalAt: z.string().datetime().optional(),
  billingCycle: z.nativeEnum(VpsBillingCycle).default(VpsBillingCycle.MONTHLY),
  monthlyPriceCents: z.number().int().min(0).default(0),
  billingCurrency: z.string().min(1).default("USD"),
  supportTier: z.nativeEnum(SupportTier).optional(),
  supportTicketUrl: z.string().url().optional(),
  supportDocsUrl: z.string().url().optional(),
  rescueEnabled: z.boolean().default(false),
  metrics: z.object({
    cpuPercent: z.number().min(0).max(100).default(0),
    memoryPercent: z.number().min(0).max(100).default(0),
    diskPercent: z.number().min(0).max(100).default(0),
    networkInMbps: z.number().min(0).default(0),
    networkOutMbps: z.number().min(0).default(0),
    uptimeSeconds: z.number().int().min(0).default(0),
  }).optional(),
  backupPolicy: z.object({
    enabled: z.boolean().default(true),
    frequency: z.string().min(1).default("daily"),
    retentionCount: z.number().int().min(1).default(7),
    lastSuccessAt: z.string().datetime().optional(),
    nextRunAt: z.string().datetime().optional(),
    encrypted: z.boolean().default(true),
    crossRegion: z.boolean().default(false),
  }).optional(),
});

export type VpsImportInput = z.infer<typeof vpsImportSchema>;

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function toImportData(input: ProviderServerSummary): VpsImportInput {
  return vpsImportSchema.parse({
    ...input,
    providerServerId: input.providerServerId,
    instanceId: input.instanceId || input.hostname,
    snapshotCount: input.snapshotCount || 0,
  });
}

export async function upsertImportedVpsServer(input: {
  orgId: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  source: "manual_import" | "provider_sync";
  data: VpsImportInput | ProviderServerSummary;
  ip?: string;
  userAgent?: string;
}) {
  const parsed = "providerSlug" in input.data && "instanceId" in input.data && "publicIpv4" in input.data
    ? vpsImportSchema.parse(input.data)
    : toImportData(input.data as ProviderServerSummary);

  const providerServerId = parsed.providerServerId || parsed.providerInstanceId;

  const existing = providerServerId
    ? await prisma.vpsServer.findFirst({
      where: {
        orgId: input.orgId,
        OR: [
          { providerServerId },
          { instanceId: parsed.instanceId || parsed.hostname },
          { publicIpv4: parsed.publicIpv4 },
        ],
      },
      select: { id: true },
    })
    : await prisma.vpsServer.findFirst({
      where: {
        orgId: input.orgId,
        OR: [
          { instanceId: parsed.instanceId || parsed.hostname },
          { publicIpv4: parsed.publicIpv4 },
        ],
      },
      select: { id: true },
    });

  const serverData = {
    providerSlug: parsed.providerSlug,
    providerServerId: providerServerId || null,
    providerRegionId: parsed.providerRegionId || null,
    providerPlanId: parsed.providerPlanId || null,
    name: parsed.name,
    hostname: parsed.hostname,
    instanceId: parsed.instanceId || parsed.hostname,
    status: parsed.status,
    powerState: parsed.powerState,
    publicIpv4: parsed.publicIpv4,
    privateIpv4: parsed.privateIpv4 || null,
    gatewayIpv4: parsed.gatewayIpv4 || null,
    privateNetwork: parsed.privateNetwork || null,
    sshPort: parsed.sshPort,
    defaultUsername: parsed.defaultUsername,
    region: parsed.region,
    datacenterLabel: parsed.datacenterLabel || null,
    imageSlug: parsed.imageSlug,
    osName: parsed.osName,
    imageVersion: parsed.imageVersion || null,
    virtualizationType: parsed.virtualizationType || null,
    planSlug: parsed.planSlug,
    planName: parsed.planName || null,
    vcpu: parsed.vcpu,
    memoryMb: parsed.memoryMb,
    diskGb: parsed.diskGb,
    bandwidthTb: parsed.bandwidthTb,
    bandwidthUsedGb: parsed.bandwidthUsedGb,
    reverseDns: parsed.reverseDns || null,
    reverseDnsStatus: parsed.reverseDnsStatus || null,
    firewallEnabled: parsed.firewallEnabled,
    firewallProfileName: parsed.firewallProfileName || null,
    monitoringEnabled: parsed.monitoringEnabled,
    monitoringStatus: parsed.monitoringStatus || null,
    backupsEnabled: parsed.backupsEnabled,
    backupRegion: parsed.backupRegion || null,
    snapshotCountCached: parsed.snapshotCount,
    nextInvoiceAt: parsed.nextInvoiceAt ? new Date(parsed.nextInvoiceAt) : null,
    renewalAt: parsed.renewalAt ? new Date(parsed.renewalAt) : null,
    billingCycle: parsed.billingCycle,
    monthlyPriceCents: parsed.monthlyPriceCents,
    billingCurrency: parsed.billingCurrency,
    supportTier: parsed.supportTier || null,
    supportTicketUrl: parsed.supportTicketUrl || null,
    supportDocsUrl: parsed.supportDocsUrl || null,
    rescueEnabled: parsed.rescueEnabled,
    providerHealthState: input.source === "provider_sync" ? VpsProviderHealthState.HEALTHY : VpsProviderHealthState.UNKNOWN,
    providerLastCheckedAt: input.source === "provider_sync" ? new Date() : null,
    providerError: null,
    driftDetectedAt: null,
    driftType: null,
    lastSyncedAt: new Date(),
    lastKnownProviderStateJson: jsonValue(input.data),
  };

  const server = existing
    ? await prisma.vpsServer.update({
      where: { id: existing.id },
      data: serverData,
    })
    : await prisma.vpsServer.create({
      data: {
        orgId: input.orgId,
        ...serverData,
      },
    });

  if (parsed.backupPolicy) {
    const latestPolicy = await prisma.vpsBackupPolicy.findFirst({
      where: { serverId: server.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    const policyData = {
      status: parsed.backupPolicy.enabled ? "ACTIVE" : "DISABLED",
      frequency: parsed.backupPolicy.frequency,
      retentionCount: parsed.backupPolicy.retentionCount,
      lastSuccessAt: parsed.backupPolicy.lastSuccessAt ? new Date(parsed.backupPolicy.lastSuccessAt) : null,
      nextRunAt: parsed.backupPolicy.nextRunAt ? new Date(parsed.backupPolicy.nextRunAt) : null,
      encrypted: parsed.backupPolicy.encrypted,
      crossRegion: parsed.backupPolicy.crossRegion,
    } as const;

    if (latestPolicy) {
      await prisma.vpsBackupPolicy.update({
        where: { id: latestPolicy.id },
        data: policyData,
      });
    } else {
      await prisma.vpsBackupPolicy.create({
        data: {
          serverId: server.id,
          ...policyData,
        },
      });
    }
  }

  if (providerServerId) {
    await prisma.vpsProviderBinding.upsert({
      where: {
        providerSlug_providerServerId: {
          providerSlug: parsed.providerSlug,
          providerServerId,
        },
      },
      update: {
        serverId: server.id,
        providerRegionId: parsed.providerRegionId || null,
        providerPlanId: parsed.providerPlanId || null,
        lastKnownStateJson: jsonValue(input.data),
        lastSyncedAt: new Date(),
      },
      create: {
        serverId: server.id,
        providerSlug: parsed.providerSlug,
        providerServerId,
        providerRegionId: parsed.providerRegionId || null,
        providerPlanId: parsed.providerPlanId || null,
        lastKnownStateJson: jsonValue(input.data),
        lastSyncedAt: new Date(),
      },
    });
  }

  const latestFirewallProfile = await prisma.vpsFirewallProfile.findFirst({
    where: { serverId: server.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  const firewallProfileData = {
    providerProfileId: providerServerId || null,
    name: parsed.firewallProfileName || (parsed.firewallEnabled ? "Default VPS Firewall" : "Firewall Disabled"),
    status: parsed.firewallEnabled ? FirewallProfileStatus.ACTIVE : FirewallProfileStatus.DISABLED,
    protectionMode: parsed.firewallEnabled ? "provider-managed" : "disabled",
    lastAppliedAt: new Date(),
  };

  if (latestFirewallProfile) {
    await prisma.vpsFirewallProfile.update({
      where: { id: latestFirewallProfile.id },
      data: firewallProfileData,
    });
  } else {
    await prisma.vpsFirewallProfile.create({
      data: {
        serverId: server.id,
        ...firewallProfileData,
      },
    });
  }

  if (parsed.supportTicketUrl) {
    const latestSupportLink = await prisma.vpsSupportLink.findFirst({
      where: { serverId: server.id, url: parsed.supportTicketUrl },
      select: { id: true },
    });

    if (!latestSupportLink) {
      await prisma.vpsSupportLink.create({
        data: {
          serverId: server.id,
          status: "OPEN",
          title: "Primary VPS support entry point",
          url: parsed.supportTicketUrl,
          lastUpdatedAt: new Date(),
          metadataJson: jsonValue({
            source: input.source,
            docsUrl: parsed.supportDocsUrl || null,
          }),
        },
      });
    }
  }

  if (parsed.metrics) {
    await prisma.vpsMetricRollup.create({
      data: {
        serverId: server.id,
        cpuPercent: parsed.metrics.cpuPercent,
        memoryPercent: parsed.metrics.memoryPercent,
        diskPercent: parsed.metrics.diskPercent,
        networkInMbps: parsed.metrics.networkInMbps,
        networkOutMbps: parsed.metrics.networkOutMbps,
        uptimeSeconds: BigInt(parsed.metrics.uptimeSeconds),
      },
    });
  }

  const eventType = existing ? "SERVER_SYNCED" : input.source === "manual_import" ? "SERVER_IMPORTED" : "SERVER_CREATED";

  await prisma.vpsAuditEvent.create({
    data: {
      orgId: input.orgId,
      serverId: server.id,
      actorUserId: input.actorUserId || null,
      eventType,
      severity: "INFO",
      sourceIp: input.ip || null,
      payloadJson: jsonValue({
        source: input.source,
        providerSlug: parsed.providerSlug,
        providerServerId,
        publicIpv4: parsed.publicIpv4,
      }),
    },
  });

  await writeAuditLog({
    actorId: input.actorUserId || null,
    actorRole: input.actorRole || null,
    orgId: input.orgId,
    action: eventType,
    resourceType: "vps_server",
    resourceId: server.id,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 1,
    metadata: {
      source: input.source,
      providerSlug: parsed.providerSlug,
      providerServerId,
      publicIpv4: parsed.publicIpv4,
    },
  });

  return { server, created: !existing };
}

export async function syncVpsFleetForOrg(input: {
  orgId: string;
  actorUserId: string;
  actorRole: string;
  providerSlug?: z.infer<typeof fleetSyncProviderSlugSchema>;
  ip?: string;
  userAgent?: string;
}) {
  const providerSlugs = input.providerSlug ? [input.providerSlug] : getConfiguredVpsProviderSlugs();

  if (!providerSlugs.length) {
    throw Object.assign(new Error("No VPS providers are configured for fleet discovery."), { httpStatus: 400 });
  }

  const providers = [] as Array<{
    providerSlug: string;
    discoveredCount: number;
    importedCount: number;
    ok: boolean;
    error?: string;
  }>;

  for (const providerSlug of providerSlugs) {
    const provider = getVpsProviderAdapter(providerSlug);

    try {
      const discoveredServers = await provider.listServers({ orgId: input.orgId });

      for (const server of discoveredServers) {
        await upsertImportedVpsServer({
          orgId: input.orgId,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          source: "provider_sync",
          data: server,
          ...(input.ip ? { ip: input.ip } : {}),
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        });
      }

      providers.push({
        providerSlug,
        discoveredCount: discoveredServers.length,
        importedCount: discoveredServers.length,
        ok: true,
      });
    } catch (error) {
      providers.push({
        providerSlug,
        discoveredCount: 0,
        importedCount: 0,
        ok: false,
        error: error instanceof Error ? error.message : "Provider discovery failed.",
      });
    }
  }

  return {
    totalImported: providers.reduce((sum, provider) => sum + provider.importedCount, 0),
    okCount: providers.filter((provider) => provider.ok).length,
    providers,
  };
}
