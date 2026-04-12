import type { ProviderActionResult, ProviderBackupPolicy, ProviderConsoleSessionResult, ProviderMetricsResult, ProviderServerSummary, ProviderSnapshot } from "@/lib/vps/providers/types";
import type { CanonicalFirewallState } from "@/lib/vps/firewall/types";

export function mapMhServer(input: ProviderServerSummary): ProviderServerSummary {
  return input;
}

export function mapMhFirewall(input: CanonicalFirewallState): CanonicalFirewallState {
  return input;
}

export function mapMhAction(input: ProviderActionResult): ProviderActionResult {
  return input;
}

export function mapMhConsole(input: ProviderConsoleSessionResult): ProviderConsoleSessionResult {
  return input;
}

export function mapMhSnapshots(input: { snapshots?: ProviderSnapshot[] } | ProviderSnapshot[]): ProviderSnapshot[] {
  return Array.isArray(input) ? input : input.snapshots || [];
}

export function mapMhBackupPolicy(input: ProviderBackupPolicy): ProviderBackupPolicy {
  return input;
}

export function mapMhMetrics(input: ProviderMetricsResult): ProviderMetricsResult {
  return input;
}
