import { ServerPowerState, VpsBillingCycle, VpsStatus } from "@prisma/client";
import type { ProviderActionResult, ProviderServerSummary } from "@/lib/vps/providers/types";
import { canonicalToProxmoxFirewall } from "@/lib/vps/providers/mappers/firewall";
import type { CanonicalFirewallState } from "@/lib/vps/firewall/types";

function normalizeMemoryMb(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1024;
  }

  return parsed > 1024 * 1024 ? Math.round(parsed / (1024 * 1024)) : Math.round(parsed);
}

function normalizeDiskGb(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }

  return parsed > 1024 * 1024 * 1024 ? Math.max(1, Math.round(parsed / (1024 * 1024 * 1024))) : Math.round(parsed);
}

export function mapProxmoxServer(input: Record<string, unknown>): ProviderServerSummary {
  return {
    providerSlug: "proxmox",
    providerServerId: String(input.vmid || input.id || ""),
    providerRegionId: null,
    providerPlanId: null,
    name: String(input.name || input.hostname || input.vmid || "proxmox-vm"),
    hostname: String(input.hostname || input.name || input.vmid || "proxmox-vm"),
    instanceId: String(input.vmid || input.id || input.name || "proxmox-vm"),
    status: String(input.status || "stopped").toLowerCase() === "running" ? VpsStatus.RUNNING : VpsStatus.STOPPED,
    powerState: String(input.status || "stopped").toLowerCase() === "running" ? ServerPowerState.ON : ServerPowerState.OFF,
    publicIpv4: String(input.publicIpv4 || input.ip || "0.0.0.0"),
    privateIpv4: null,
    gatewayIpv4: null,
    privateNetwork: null,
    sshPort: 22,
    defaultUsername: "root",
    region: String(input.node || "proxmox"),
    datacenterLabel: String(input.node || "proxmox"),
    imageSlug: String(input.template || input.os || "unknown"),
    osName: String(input.os || input.template || "Unknown"),
    imageVersion: null,
    virtualizationType: String(input.type || "qemu"),
    planSlug: String(input.planSlug || "custom"),
    planName: String(input.planName || "Custom"),
    vcpu: Number(input.cpus || input.maxcpu || 1),
    memoryMb: normalizeMemoryMb(input.maxmem || input.memory),
    diskGb: normalizeDiskGb(input.maxdisk || input.disk),
    bandwidthTb: 0,
    bandwidthUsedGb: 0,
    billingCycle: VpsBillingCycle.MONTHLY,
    monthlyPriceCents: 0,
    billingCurrency: "USD",
    lastKnownProviderStateJson: input,
  };
}

export function mapProxmoxTask(input: Record<string, unknown>): ProviderActionResult {
  return {
    accepted: true,
    status: "QUEUED",
    providerTaskId: String(input.data || input.upid || input.taskid || ""),
    providerRequestId: String(input.data || input.upid || input.taskid || ""),
    raw: input,
  } as ProviderActionResult & { raw: unknown };
}

export function mapProxmoxTaskId(taskId: string): ProviderActionResult {
  return {
    accepted: true,
    status: "QUEUED",
    providerTaskId: taskId,
    providerRequestId: taskId,
    raw: { upid: taskId },
  };
}

export { canonicalToProxmoxFirewall };
