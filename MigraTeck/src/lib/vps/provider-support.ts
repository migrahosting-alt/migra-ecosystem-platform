import type { VpsActionType } from "@prisma/client";
import type { ProviderCapabilities } from "@/lib/vps/providers";

export type ProviderCapabilityKey = keyof ProviderCapabilities;

const capabilityLabels: Record<ProviderCapabilityKey, string> = {
  powerControl: "power control",
  console: "console sessions",
  rescue: "rescue mode",
  rebuild: "server rebuild",
  firewallRead: "firewall read access",
  firewallWrite: "firewall write access",
  snapshots: "snapshots",
  backups: "backups",
  metrics: "monitoring metrics",
};

const actionCapabilityMap: Partial<Record<VpsActionType, ProviderCapabilityKey>> = {
  POWER_ON: "powerControl",
  POWER_OFF: "powerControl",
  REBOOT: "powerControl",
  HARD_REBOOT: "powerControl",
  ENABLE_RESCUE: "rescue",
  DISABLE_RESCUE: "rescue",
  REBUILD: "rebuild",
  OPEN_CONSOLE_SESSION: "console",
  CREATE_SNAPSHOT: "snapshots",
  RESTORE_SNAPSHOT: "snapshots",
  DELETE_SNAPSHOT: "snapshots",
  UPDATE_BACKUP_POLICY: "backups",
};

export function requiredProviderCapabilityForAction(action: VpsActionType): ProviderCapabilityKey | null {
  return actionCapabilityMap[action] || null;
}

export function assertProviderCapability(input: {
  providerSlug: string;
  capabilities: ProviderCapabilities;
  capability: ProviderCapabilityKey;
}) {
  if (input.capabilities[input.capability]) {
    return;
  }

  throw Object.assign(
    new Error(`${input.providerSlug} does not support ${capabilityLabels[input.capability]}.`),
    {
      httpStatus: 409,
      code: "PROVIDER_CAPABILITY_UNSUPPORTED",
    },
  );
}

export function assertProviderActionSupport(input: {
  providerSlug: string;
  capabilities: ProviderCapabilities;
  action: VpsActionType;
}) {
  const capability = requiredProviderCapabilityForAction(input.action);
  if (!capability) {
    return;
  }

  assertProviderCapability({
    providerSlug: input.providerSlug,
    capabilities: input.capabilities,
    capability,
  });
}