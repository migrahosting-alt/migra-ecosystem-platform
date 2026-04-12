import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeVpsAuditEvent } from "@/lib/vps/audit";
import { syncVpsAlertState } from "@/lib/vps/alerts";
import { diffFirewallState } from "@/lib/vps/firewall/diff";
import { canonicalStateFromProfile, sanitizeCanonicalState } from "@/lib/vps/firewall/normalize";
import { getPrimaryProviderBinding } from "@/lib/vps/queries";
import { getProvider } from "@/lib/vps/providers";
import { classifyProviderHealth, detectServerDrift, healthyProviderState } from "@/lib/vps/server-state";

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export async function syncServer(serverId: string, context?: { actorUserId?: string | null; sourceIp?: string }) {
  const server = await prisma.vpsServer.findUniqueOrThrow({
    where: { id: serverId },
    include: {
      providerBindings: true,
      firewallProfiles: {
        include: {
          rules: {
            orderBy: { priority: "asc" },
          },
        },
        orderBy: [
          { isActive: "desc" },
          { updatedAt: "desc" },
        ],
      },
    },
  });

  const binding = getPrimaryProviderBinding(server);
  if (!binding) {
    throw new Error("Missing provider binding");
  }

  const provider = getProvider(binding.providerSlug);
  let remote;

  try {
    remote = await provider.getServer({
      providerSlug: binding.providerSlug,
      providerServerId: binding.providerServerId,
      instanceId: server.instanceId,
      publicIpv4: server.publicIpv4,
      name: server.name,
    });
  } catch (error) {
    const health = classifyProviderHealth(error);
    await prisma.vpsServer.update({
      where: { id: serverId },
      data: {
        providerHealthState: health.providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: health.providerError,
      },
    });
    throw error;
  }

  if (!remote) {
    await prisma.vpsServer.update({
      where: { id: serverId },
      data: {
        providerHealthState: "UNREACHABLE",
        providerLastCheckedAt: new Date(),
        providerError: "Provider returned no server state",
      },
    });
    throw new Error("Provider returned no server state");
  }

  let firewallDriftDetected = false;

  if (provider.capabilities.firewallRead) {
    const activeProfile = server.firewallProfiles.find((profile) => profile.isActive) || server.firewallProfiles[0] || null;
    const localFirewallState = canonicalStateFromProfile({
      server,
      profile: activeProfile,
    });
    const providerFirewallState = sanitizeCanonicalState(await provider.getFirewall({
      providerSlug: binding.providerSlug,
      providerServerId: binding.providerServerId,
      instanceId: server.instanceId,
      publicIpv4: server.publicIpv4,
      name: server.name,
    }));
    const firewallDiff = diffFirewallState(localFirewallState, providerFirewallState);
    firewallDriftDetected = firewallDiff.added.length > 0 || firewallDiff.removed.length > 0 || firewallDiff.changed.length > 0;

    if (activeProfile) {
      await prisma.vpsFirewallProfile.update({
        where: { id: activeProfile.id },
        data: firewallDriftDetected
          ? {
            driftDetectedAt: new Date(),
            driftSummaryJson: jsonValue({
              added: firewallDiff.added.length,
              removed: firewallDiff.removed.length,
              changed: firewallDiff.changed.length,
              warnings: firewallDiff.warnings,
            }),
          }
          : {
            driftDetectedAt: null,
            driftSummaryJson: Prisma.JsonNull,
          },
      });
    }
  }

  const drift = detectServerDrift({
    local: {
      hostname: server.hostname,
      planSlug: server.planSlug,
      powerState: server.powerState,
    },
    remote,
    firewallDriftDetected,
  });

  await prisma.$transaction(async (tx) => {
    await tx.vpsServer.update({
      where: { id: serverId },
      data: {
        name: remote.name,
        hostname: remote.hostname || server.hostname,
        status: remote.status,
        powerState: remote.powerState,
        publicIpv4: remote.publicIpv4 || server.publicIpv4,
        privateIpv4: remote.privateIpv4 ?? server.privateIpv4,
        gatewayIpv4: remote.gatewayIpv4 ?? server.gatewayIpv4,
        privateNetwork: remote.privateNetwork ?? server.privateNetwork,
        sshPort: remote.sshPort ?? server.sshPort,
        defaultUsername: remote.defaultUsername || server.defaultUsername,
        region: remote.region || server.region,
        datacenterLabel: remote.datacenterLabel ?? server.datacenterLabel,
        imageSlug: remote.imageSlug || server.imageSlug,
        osName: remote.osName || server.osName,
        imageVersion: remote.imageVersion ?? server.imageVersion,
        virtualizationType: remote.virtualizationType ?? server.virtualizationType,
        planSlug: remote.planSlug || server.planSlug,
        planName: remote.planName ?? server.planName,
        vcpu: remote.vcpu ?? server.vcpu,
        memoryMb: remote.memoryMb ?? server.memoryMb,
        diskGb: remote.diskGb ?? server.diskGb,
        bandwidthTb: remote.bandwidthTb ?? server.bandwidthTb,
        bandwidthUsedGb: remote.bandwidthUsedGb ?? server.bandwidthUsedGb,
        reverseDns: remote.reverseDns ?? server.reverseDns,
        reverseDnsStatus: remote.reverseDnsStatus ?? server.reverseDnsStatus,
        firewallEnabled: remote.firewallEnabled ?? server.firewallEnabled,
        firewallProfileName: remote.firewallProfileName ?? server.firewallProfileName,
        monitoringEnabled: remote.monitoringEnabled ?? server.monitoringEnabled,
        monitoringStatus: remote.monitoringStatus ?? server.monitoringStatus,
        backupsEnabled: remote.backupsEnabled ?? server.backupsEnabled,
        backupRegion: remote.backupRegion ?? server.backupRegion,
        snapshotCountCached: remote.snapshotCount ?? server.snapshotCountCached,
        nextInvoiceAt: remote.nextInvoiceAt ? new Date(remote.nextInvoiceAt) : server.nextInvoiceAt,
        renewalAt: remote.renewalAt ? new Date(remote.renewalAt) : server.renewalAt,
        billingCycle: remote.billingCycle ?? server.billingCycle,
        monthlyPriceCents: remote.monthlyPriceCents ?? server.monthlyPriceCents,
        billingCurrency: remote.billingCurrency ?? server.billingCurrency,
        supportTier: remote.supportTier ?? server.supportTier,
        supportTicketUrl: remote.supportTicketUrl ?? server.supportTicketUrl,
        supportDocsUrl: remote.supportDocsUrl ?? server.supportDocsUrl,
        rescueEnabled: remote.rescueEnabled ?? server.rescueEnabled,
        providerHealthState: healthyProviderState().providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: null,
        driftDetectedAt: drift.detected ? new Date() : null,
        driftType: drift.driftType,
        lastKnownProviderStateJson: jsonValue(remote),
        lastSyncedAt: new Date(),
      },
    });

    const existingBinding = getPrimaryProviderBinding(server);
    if (existingBinding && "id" in existingBinding && existingBinding.id) {
      await tx.vpsProviderBinding.update({
        where: { id: existingBinding.id },
        data: {
          providerSlug: remote.providerSlug,
          providerServerId: remote.providerServerId || existingBinding.providerServerId,
          providerRegionId: remote.providerRegionId ?? existingBinding.providerRegionId,
          providerPlanId: remote.providerPlanId ?? existingBinding.providerPlanId,
          lastKnownStateJson: jsonValue(remote),
          lastSyncedAt: new Date(),
        },
      });
    } else if (remote.providerServerId) {
      await tx.vpsProviderBinding.create({
        data: {
          serverId: server.id,
          providerSlug: remote.providerSlug,
          providerServerId: remote.providerServerId,
          providerRegionId: remote.providerRegionId ?? null,
          providerPlanId: remote.providerPlanId ?? null,
          lastKnownStateJson: jsonValue(remote),
          lastSyncedAt: new Date(),
        },
      });
    }
  });

  if (drift.detected) {
    await writeVpsAuditEvent({
      orgId: server.orgId,
      serverId: server.id,
      actorUserId: context?.actorUserId || null,
      sourceIp: context?.sourceIp || null,
      eventType: "DRIFT_DETECTED",
      severity: "WARNING",
      metadataJson: {
        driftType: drift.driftType,
      },
    });
  }

  await syncVpsAlertState(server.id, {
    actorUserId: context?.actorUserId || null,
  });

  return prisma.vpsServer.findUniqueOrThrow({ where: { id: serverId } });
}
