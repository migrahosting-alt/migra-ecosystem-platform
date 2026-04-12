import type { VpsFirewallProfile, VpsFirewallRule, VpsServer } from "@prisma/client";
import type { CanonicalFirewallRule, CanonicalFirewallState } from "@/lib/vps/firewall/types";

const DEFAULT_STATE: Pick<CanonicalFirewallState, "inboundDefaultAction" | "outboundDefaultAction" | "antiLockoutEnabled" | "rollbackWindowSec" | "rules"> = {
  inboundDefaultAction: "DENY",
  outboundDefaultAction: "ALLOW",
  antiLockoutEnabled: true,
  rollbackWindowSec: 120,
  rules: [],
};

export function protocolToCanonical(protocol?: string | null): CanonicalFirewallRule["protocol"] {
  const value = (protocol || "TCP").toUpperCase();
  if (value === "UDP" || value === "ICMP" || value === "ANY") {
    return value;
  }
  return "TCP";
}

export function boundsToPortRange(portStart?: number, portEnd?: number): string | null {
  if (!portStart && !portEnd) {
    return null;
  }

  if (portStart && portEnd && portStart !== portEnd) {
    return `${portStart}-${portEnd}`;
  }

  return String(portStart || portEnd);
}

export function portRangeToBounds(portRange?: string | null): Pick<CanonicalFirewallRule, "portStart" | "portEnd"> {
  if (!portRange) {
    return {};
  }

  const trimmed = portRange.trim();
  if (!trimmed) {
    return {};
  }

  const match = trimmed.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return {};
  }

  const portStart = Number.parseInt(match[1] ?? "0", 10);
  const portEnd = Number.parseInt(match[2] ?? match[1] ?? "0", 10);
  return { portStart, portEnd };
}

export function canonicalRuleFromDb(rule: Pick<VpsFirewallRule, "id" | "direction" | "action" | "protocol" | "portStart" | "portEnd" | "portRange" | "sourceCidr" | "destinationCidr" | "description" | "priority" | "enabled" | "expiresAt">): CanonicalFirewallRule {
  const bounds = rule.portStart || rule.portEnd
    ? {
        ...(rule.portStart ? { portStart: rule.portStart } : {}),
        ...(rule.portEnd ? { portEnd: rule.portEnd } : {}),
      }
    : portRangeToBounds(rule.portRange);

  return {
    id: rule.id,
    direction: rule.direction,
    action: rule.action,
    protocol: protocolToCanonical(rule.protocol),
    ...bounds,
    ...(rule.sourceCidr ? { sourceCidr: rule.sourceCidr } : {}),
    ...(rule.destinationCidr ? { destinationCidr: rule.destinationCidr } : {}),
    ...(rule.description ? { description: rule.description } : {}),
    priority: rule.priority,
    isEnabled: rule.enabled,
    expiresAt: rule.expiresAt ? rule.expiresAt.toISOString() : null,
  };
}

export function canonicalStateFromProfile(input: {
  server: Pick<VpsServer, "firewallEnabled">;
  profile?: (Pick<VpsFirewallProfile, "id" | "name" | "status" | "defaultInboundAction" | "defaultOutboundAction" | "antiLockoutEnabled" | "rollbackWindowSec" | "providerVersion" | "lastAppliedAt" | "lastApplyJobId" | "lastError" | "isActive" | "rollbackPendingUntil" | "confirmedAt" | "driftDetectedAt"> & {
    rules: Array<Pick<VpsFirewallRule, "id" | "direction" | "action" | "protocol" | "portStart" | "portEnd" | "portRange" | "sourceCidr" | "destinationCidr" | "description" | "priority" | "enabled" | "expiresAt">>;
  }) | null | undefined;
}): CanonicalFirewallState {
  const profile = input.profile;
  if (!profile) {
    return {
      ...DEFAULT_STATE,
      profileName: "Default VPS Firewall",
      status: input.server.firewallEnabled ? "ACTIVE" : "DISABLED",
      isEnabled: input.server.firewallEnabled,
      isActive: false,
    };
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    status: profile.status,
    isEnabled: input.server.firewallEnabled,
    isActive: profile.isActive,
    inboundDefaultAction: profile.defaultInboundAction,
    outboundDefaultAction: profile.defaultOutboundAction,
    antiLockoutEnabled: profile.antiLockoutEnabled,
    rollbackWindowSec: profile.rollbackWindowSec,
    providerVersion: profile.providerVersion,
    lastAppliedAt: profile.lastAppliedAt ? profile.lastAppliedAt.toISOString() : null,
    lastApplyJobId: profile.lastApplyJobId,
    lastError: profile.lastError,
    rollbackPendingUntil: profile.rollbackPendingUntil ? profile.rollbackPendingUntil.toISOString() : null,
    confirmedAt: profile.confirmedAt ? profile.confirmedAt.toISOString() : null,
    driftDetectedAt: profile.driftDetectedAt ? profile.driftDetectedAt.toISOString() : null,
    rules: profile.rules.map(canonicalRuleFromDb).sort((left, right) => left.priority - right.priority),
  };
}

export function sanitizeCanonicalState(input: CanonicalFirewallState): CanonicalFirewallState {
  return {
    ...DEFAULT_STATE,
    ...input,
    rules: [...input.rules]
      .map((rule) => ({
        ...rule,
        protocol: protocolToCanonical(rule.protocol),
        priority: Number(rule.priority),
        isEnabled: rule.isEnabled !== false,
        sourceCidr: rule.sourceCidr?.trim() || undefined,
        destinationCidr: rule.destinationCidr?.trim() || undefined,
        description: rule.description?.trim() || undefined,
      }))
      .sort((left, right) => left.priority - right.priority),
  };
}

export function canonicalRuleToRuleRecord(rule: CanonicalFirewallRule) {
  return {
    direction: rule.direction,
    action: rule.action,
    protocol: rule.protocol,
    portStart: rule.portStart ?? null,
    portEnd: rule.portEnd ?? null,
    portRange: boundsToPortRange(rule.portStart, rule.portEnd),
    sourceCidr: rule.sourceCidr || null,
    destinationCidr: rule.destinationCidr || null,
    description: rule.description || null,
    priority: rule.priority,
    enabled: rule.isEnabled,
    expiresAt: rule.expiresAt ? new Date(rule.expiresAt) : null,
  };
}
