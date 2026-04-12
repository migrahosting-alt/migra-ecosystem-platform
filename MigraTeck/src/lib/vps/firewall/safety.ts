import type { CanonicalFirewallState } from "@/lib/vps/firewall/types";

export function assessFirewallRisk(state: CanonicalFirewallState): { warnings: string[]; riskLevel: "LOW" | "MEDIUM" | "HIGH" } {
  const warnings: string[] = [];
  let riskLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";

  const exposedAllPorts = state.rules.some((rule) => (
    rule.isEnabled
    && rule.direction === "INBOUND"
    && rule.action === "ALLOW"
    && (!rule.sourceCidr || rule.sourceCidr === "0.0.0.0/0" || rule.sourceCidr === "::/0")
    && (rule.protocol === "ANY" || (rule.portStart === undefined && rule.portEnd === undefined))
  ));

  if (exposedAllPorts) {
    warnings.push("At least one inbound rule allows broad access from anywhere.");
    riskLevel = "HIGH";
  }

  const changedCriticalPorts = state.rules.some((rule) => rule.isEnabled && rule.direction === "INBOUND" && [22, 80, 443].includes(rule.portStart || 0));
  if (!exposedAllPorts && changedCriticalPorts) {
    riskLevel = "MEDIUM";
  }

  if (state.rollbackWindowSec >= 180) {
    warnings.push("Extended rollback window increases the period where confirmation is required.");
  }

  return { warnings, riskLevel };
}
