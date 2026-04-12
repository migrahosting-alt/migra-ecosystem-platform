import { isIP } from "node:net";
import { z } from "zod";
import type { CanonicalFirewallState, FirewallValidationResult } from "@/lib/vps/firewall/types";

export const firewallRuleSchema = z.object({
  id: z.string().optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  action: z.enum(["ALLOW", "DENY"]),
  protocol: z.enum(["TCP", "UDP", "ICMP", "ANY"]),
  portStart: z.number().int().min(1).max(65535).optional(),
  portEnd: z.number().int().min(1).max(65535).optional(),
  sourceCidr: z.string().max(64).optional(),
  destinationCidr: z.string().max(64).optional(),
  description: z.string().max(160).optional(),
  priority: z.number().int().min(1).max(10000),
  isEnabled: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const firewallProfileSchema = z.object({
  profileId: z.string().optional(),
  profileName: z.string().max(120).optional(),
  inboundDefaultAction: z.enum(["ALLOW", "DENY"]),
  outboundDefaultAction: z.enum(["ALLOW", "DENY"]),
  antiLockoutEnabled: z.boolean(),
  rollbackWindowSec: z.number().int().min(30).max(600),
  rules: z.array(firewallRuleSchema).max(500),
});

function isValidCidr(input?: string): boolean {
  if (!input) {
    return true;
  }

  const [ip = "", prefix] = input.split("/");
  const family = isIP(ip);
  if (!family) {
    return false;
  }

  if (!prefix) {
    return true;
  }

  const numericPrefix = Number.parseInt(prefix, 10);
  if (Number.isNaN(numericPrefix)) {
    return false;
  }

  return family === 4 ? numericPrefix >= 0 && numericPrefix <= 32 : numericPrefix >= 0 && numericPrefix <= 128;
}

export function validateFirewallState(state: CanonicalFirewallState, sshPort = 22): FirewallValidationResult {
  const parsed = firewallProfileSchema.safeParse(state);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => issue.message),
      warnings,
      antiLockoutSatisfied: false,
    };
  }

  const seenPriorities = new Set<string>();

  for (const rule of state.rules) {
    if (!isValidCidr(rule.sourceCidr)) {
      errors.push(`Rule ${rule.priority}: invalid source CIDR.`);
    }

    if (!isValidCidr(rule.destinationCidr)) {
      errors.push(`Rule ${rule.priority}: invalid destination CIDR.`);
    }

    if (rule.portStart !== undefined && rule.portEnd !== undefined && rule.portEnd < rule.portStart) {
      errors.push(`Rule ${rule.priority}: portEnd must be greater than or equal to portStart.`);
    }

    const duplicateKey = `${rule.direction}:${rule.priority}`;
    if (seenPriorities.has(duplicateKey)) {
      errors.push(`Rule ${rule.priority}: duplicate priority within ${rule.direction.toLowerCase()} rules.`);
    }
    seenPriorities.add(duplicateKey);

    if (
      rule.isEnabled
      && rule.direction === "INBOUND"
      && rule.action === "ALLOW"
      && (!rule.sourceCidr || rule.sourceCidr === "0.0.0.0/0" || rule.sourceCidr === "::/0")
      && (rule.protocol === "ANY" || rule.portStart === undefined)
    ) {
      warnings.push(`Rule ${rule.priority}: inbound allow from anywhere without a constrained port is high risk.`);
    }
  }

  if (state.outboundDefaultAction === "DENY") {
    warnings.push("Outbound default deny can break package updates, DNS, and external backups.");
  }

  const hasSshAllowRule = state.rules.some((rule) => (
    rule.isEnabled
    && rule.direction === "INBOUND"
    && rule.action === "ALLOW"
    && (rule.protocol === "TCP" || rule.protocol === "ANY")
    && (
      rule.portStart === undefined
      || rule.portStart === sshPort
      || (rule.portStart <= sshPort && (rule.portEnd || rule.portStart) >= sshPort)
    )
  ));

  const antiLockoutSatisfied = state.inboundDefaultAction === "ALLOW" || hasSshAllowRule;

  if (state.antiLockoutEnabled && !antiLockoutSatisfied) {
    errors.push("Anti-lockout failed: no enabled inbound SSH rule matches the configured SSH port.");
  }

  const hasWebAllowRule = state.rules.some((rule) => (
    rule.isEnabled
    && rule.direction === "INBOUND"
    && rule.action === "ALLOW"
    && (rule.protocol === "TCP" || rule.protocol === "ANY")
    && (rule.portStart === 80 || rule.portStart === 443)
  ));

  if (!hasWebAllowRule && state.inboundDefaultAction === "DENY") {
    warnings.push("No enabled HTTP or HTTPS inbound rule is present while inbound default is DENY.");
  }

  if (state.inboundDefaultAction === "ALLOW") {
    warnings.push("Inbound default ALLOW is high risk.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    antiLockoutSatisfied,
  };
}
