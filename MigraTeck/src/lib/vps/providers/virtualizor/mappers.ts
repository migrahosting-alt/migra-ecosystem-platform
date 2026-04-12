import { ServerPowerState, VpsBillingCycle, VpsStatus } from "@prisma/client";
import type { ProviderServerSummary } from "@/lib/vps/providers/types";

export function mapVirtualizorServer(input: Record<string, unknown>): ProviderServerSummary {
  const status = String(input.status || input.state || "offline").toLowerCase();
  return {
    providerSlug: "virtualizor",
    providerServerId: String(input.vpsid || input.id || ""),
    providerRegionId: null,
    providerPlanId: String(input.plid || ""),
    name: String(input.hostname || input.name || input.vpsid || "virtualizor-vps"),
    hostname: String(input.hostname || input.name || input.vpsid || "virtualizor-vps"),
    instanceId: String(input.vpsid || input.id || input.hostname || "virtualizor-vps"),
    status: status === "online" || status === "running" ? VpsStatus.RUNNING : VpsStatus.STOPPED,
    powerState: status === "online" || status === "running" ? ServerPowerState.ON : ServerPowerState.OFF,
    publicIpv4: String(input.ip || input.publicIpv4 || "0.0.0.0"),
    privateIpv4: null,
    gatewayIpv4: null,
    privateNetwork: null,
    sshPort: 22,
    defaultUsername: "root",
    region: String(input.node || input.region || "virtualizor"),
    datacenterLabel: String(input.node || input.region || "virtualizor"),
    imageSlug: String(input.os || "unknown"),
    osName: String(input.os_name || input.os || "Unknown"),
    imageVersion: null,
    virtualizationType: String(input.virt || "kvm"),
    planSlug: String(input.plan || "custom"),
    planName: String(input.plan_name || input.plan || "Custom"),
    vcpu: Number(input.cpus || 1),
    memoryMb: Number(input.ram || 1024),
    diskGb: Number(input.disk || 25),
    bandwidthTb: Number(input.bandwidth || 0),
    bandwidthUsedGb: Number(input.bandwidth_used || 0),
    billingCycle: VpsBillingCycle.MONTHLY,
    monthlyPriceCents: 0,
    billingCurrency: "USD",
    lastKnownProviderStateJson: input,
  };
}
