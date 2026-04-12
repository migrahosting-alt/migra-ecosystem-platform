export type {
  ProviderActionResult,
  ProviderBackupPolicy,
  ProviderBackupPolicyInput,
  ProviderCapabilities,
  ProviderConsoleSessionResult,
  ProviderFirewallDefaults,
  ProviderFirewallRule,
  ProviderFirewallState,
  ProviderMetricsResult,
  ProviderServerRef,
  ProviderServerSummary,
  ProviderSnapshot,
  RebuildInput,
} from "@/lib/vps/providers/types";
export type { VpsProviderAdapter } from "@/lib/vps/providers/adapter";
export { getProvider, getVpsProviderAdapter, resetVpsProvidersForTests, setVpsProviderForTests } from "@/lib/vps/providers/registry";
