import type { CanonicalFirewallState } from "@/lib/vps/firewall/types";

export function providerToCanonicalFirewall(input: CanonicalFirewallState): CanonicalFirewallState {
  return input;
}

export function canonicalToProxmoxFirewall(input: CanonicalFirewallState) {
  return {
    enable: input.isEnabled !== false ? 1 : 0,
    options: {
      policy_in: input.inboundDefaultAction.toLowerCase(),
      policy_out: input.outboundDefaultAction.toLowerCase(),
    },
    rules: input.rules.map((rule) => ({
      type: rule.direction === "INBOUND" ? "in" : "out",
      action: rule.action.toLowerCase(),
      proto: rule.protocol.toLowerCase(),
      sport: rule.portStart,
      dport: rule.portEnd || rule.portStart,
      source: rule.sourceCidr,
      dest: rule.destinationCidr,
      comment: rule.description,
      pos: rule.priority,
      enable: rule.isEnabled ? 1 : 0,
    })),
  };
}

export function canonicalToVirtualizorFirewall(input: CanonicalFirewallState) {
  return {
    inbound_default: input.inboundDefaultAction,
    outbound_default: input.outboundDefaultAction,
    rules: input.rules,
  };
}

export function canonicalToMhFirewall(input: CanonicalFirewallState) {
  return input;
}
