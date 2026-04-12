import type { VpsServer } from "@prisma/client";

export function toServerSummary(server: VpsServer) {
  return {
    id: server.id,
    name: server.name,
    hostname: server.hostname,
    status: server.status,
    powerState: server.powerState,
    publicIpv4: server.publicIpv4,
    privateIpv4: server.privateIpv4,
    sshPort: server.sshPort,
    region: server.region,
    osName: server.osName,
    imageSlug: server.imageSlug,
    planSlug: server.planSlug,
    vcpu: server.vcpu,
    memoryMb: server.memoryMb,
    diskGb: server.diskGb,
    bandwidthTb: server.bandwidthTb,
    billingCycle: server.billingCycle,
    monthlyPriceCents: server.monthlyPriceCents,
    renewalAt: server.renewalAt?.toISOString() ?? null,
    supportTier: server.supportTier,
    firewallEnabled: server.firewallEnabled,
    backupsEnabled: server.backupsEnabled,
    backupEnabled: server.backupsEnabled,
    monitoringEnabled: server.monitoringEnabled,
    lastSyncedAt: server.lastSyncedAt?.toISOString() ?? null,
  };
}
