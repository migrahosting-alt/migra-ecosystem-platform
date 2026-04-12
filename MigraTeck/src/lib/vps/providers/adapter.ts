import type {
  ProviderActionResult,
  ProviderBackupPolicy,
  ProviderBackupPolicyInput,
  ProviderCapabilities,
  ProviderConsoleSessionResult,
  ProviderFirewallState,
  ProviderMetricsResult,
  ProviderServerRef,
  ProviderServerSummary,
  ProviderSnapshot,
  RebuildInput,
} from "@/lib/vps/providers/types";

export interface VpsProviderAdapter {
  slug: string;
  capabilities: ProviderCapabilities;
  listServers(input: { orgId: string }): Promise<ProviderServerSummary[]>;
  getServer(input: ProviderServerRef): Promise<ProviderServerSummary | null>;
  getActionStatus(
    input: ProviderServerRef,
    request: { taskId: string; action: string; requestJson?: unknown },
  ): Promise<ProviderActionResult>;
  powerOn(input: ProviderServerRef): Promise<ProviderActionResult>;
  powerOff(input: ProviderServerRef): Promise<ProviderActionResult>;
  reboot(input: ProviderServerRef & { hard?: boolean }): Promise<ProviderActionResult>;
  enableRescue(input: ProviderServerRef): Promise<ProviderActionResult>;
  disableRescue(input: ProviderServerRef): Promise<ProviderActionResult>;
  rebuild(input: ProviderServerRef, request: RebuildInput): Promise<ProviderActionResult>;
  createConsoleSession(
    input: ProviderServerRef,
    request: { actorUserId: string; viewOnly: boolean },
  ): Promise<ProviderConsoleSessionResult>;
  getFirewall(input: ProviderServerRef): Promise<ProviderFirewallState>;
  updateFirewall(
    input: ProviderServerRef,
    request: { firewall: ProviderFirewallState },
  ): Promise<ProviderActionResult>;
  listSnapshots(input: ProviderServerRef): Promise<ProviderSnapshot[]>;
  createSnapshot(input: ProviderServerRef, request: { name: string }): Promise<ProviderActionResult>;
  restoreSnapshot(input: ProviderServerRef, request: { snapshotId: string }): Promise<ProviderActionResult>;
  deleteSnapshot(input: ProviderServerRef, request: { snapshotId: string }): Promise<ProviderActionResult>;
  getBackupPolicy(input: ProviderServerRef): Promise<ProviderBackupPolicy>;
  updateBackupPolicy(input: ProviderServerRef, request: { policy: ProviderBackupPolicyInput }): Promise<ProviderActionResult>;
  getMetrics(input: ProviderServerRef, request: { range: string }): Promise<ProviderMetricsResult>;
}
