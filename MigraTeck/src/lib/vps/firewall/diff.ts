import { assessFirewallRisk } from "@/lib/vps/firewall/safety";
import type { CanonicalFirewallRule, CanonicalFirewallState, FirewallApplyPreview } from "@/lib/vps/firewall/types";

function stableRuleKey(rule: CanonicalFirewallRule): string {
  return JSON.stringify({
    direction: rule.direction,
    action: rule.action,
    protocol: rule.protocol,
    portStart: rule.portStart,
    portEnd: rule.portEnd,
    sourceCidr: rule.sourceCidr,
    destinationCidr: rule.destinationCidr,
    description: rule.description,
    priority: rule.priority,
    isEnabled: rule.isEnabled,
  });
}

export function diffFirewallState(before: CanonicalFirewallState, after: CanonicalFirewallState): FirewallApplyPreview {
  const beforeMap = new Map(before.rules.map((rule) => [rule.id || stableRuleKey(rule), rule]));
  const afterMap = new Map(after.rules.map((rule) => [rule.id || stableRuleKey(rule), rule]));

  const added: CanonicalFirewallRule[] = [];
  const removed: CanonicalFirewallRule[] = [];
  const changed: Array<{ before: CanonicalFirewallRule; after: CanonicalFirewallRule }> = [];

  for (const [key, rule] of afterMap) {
    const previous = beforeMap.get(key);
    if (!previous) {
      added.push(rule);
      continue;
    }

    if (JSON.stringify(previous) !== JSON.stringify(rule)) {
      changed.push({ before: previous, after: rule });
    }
  }

  for (const [key, rule] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push(rule);
    }
  }

  const safety = assessFirewallRisk(after);
  const warnings = [...safety.warnings];
  if (removed.some((rule) => rule.portStart === 22 || rule.portStart === 80 || rule.portStart === 443)) {
    warnings.push("A critical access port is being removed or narrowed.");
  }

  return {
    added,
    removed,
    changed,
    warnings,
    riskLevel: safety.riskLevel,
  };
}
