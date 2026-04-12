import { ServerPowerState, SupportTier, VpsBillingCycle, VpsStatus } from "@prisma/client";
import type { CanonicalFirewallRule, CanonicalFirewallState } from "@/lib/vps/firewall/types";

export interface ProviderCapabilities {
  powerControl: boolean;
  console: boolean;
  rescue: boolean;
  rebuild: boolean;
  firewallRead: boolean;
  firewallWrite: boolean;
  snapshots: boolean;
  backups: boolean;
  metrics: boolean;
}

export interface ProviderServerSummary {
  providerSlug: string;
  providerServerId?: string | null | undefined;
  providerRegionId?: string | null | undefined;
  providerPlanId?: string | null | undefined;
  name: string;
  hostname: string;
  instanceId: string;
  status: VpsStatus;
  powerState: ServerPowerState;
  publicIpv4: string;
  privateIpv4?: string | null | undefined;
  gatewayIpv4?: string | null | undefined;
  privateNetwork?: string | null | undefined;
  sshPort: number;
  defaultUsername: string;
  region: string;
  datacenterLabel?: string | null | undefined;
  imageSlug: string;
  osName: string;
  imageVersion?: string | null | undefined;
  virtualizationType?: string | null | undefined;
  planSlug: string;
  planName?: string | null | undefined;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  bandwidthTb: number;
  bandwidthUsedGb?: number | undefined;
  reverseDns?: string | null | undefined;
  reverseDnsStatus?: string | null | undefined;
  firewallEnabled?: boolean | undefined;
  firewallProfileName?: string | null | undefined;
  monitoringEnabled?: boolean | undefined;
  monitoringStatus?: string | null | undefined;
  backupsEnabled?: boolean | undefined;
  backupRegion?: string | null | undefined;
  snapshotCount?: number | undefined;
  nextInvoiceAt?: string | null | undefined;
  renewalAt?: string | null | undefined;
  billingCycle?: VpsBillingCycle | undefined;
  monthlyPriceCents?: number | undefined;
  billingCurrency?: string | undefined;
  supportTier?: SupportTier | null | undefined;
  supportTicketUrl?: string | null | undefined;
  supportDocsUrl?: string | null | undefined;
  rescueEnabled?: boolean | undefined;
  consoleUrl?: string | null | undefined;
  lastKnownProviderStateJson?: Record<string, unknown> | null | undefined;
}

export interface ProviderActionResult {
  accepted: boolean;
  status: "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  message?: string | undefined;
  providerRequestId?: string | undefined;
  providerTaskId?: string | undefined;
  serverPatch?: Partial<ProviderServerSummary> | undefined;
  metadata?: Record<string, unknown> | undefined;
  raw?: unknown;
}

export interface ProviderConsoleSessionResult {
  supported: boolean;
  mode: "FULL" | "VIEW_ONLY";
  status?: "READY" | "PENDING" | "FAILED" | undefined;
  sessionId?: string | undefined;
  launchUrl?: string | undefined;
  token?: string | undefined;
  expiresAt?: string | undefined;
  message?: string | undefined;
  raw?: unknown;
}

export interface ProviderServerRef {
  providerSlug: string;
  providerServerId?: string | null | undefined;
  instanceId: string;
  publicIpv4: string;
  name: string;
}

export interface RebuildInput {
  imageSlug?: string | undefined;
  hostname?: string | undefined;
  sshKeys?: string[] | undefined;
  reason?: string | undefined;
}

export type ProviderFirewallRule = CanonicalFirewallRule;

export interface ProviderFirewallDefaults {
  inboundDefaultAction: "ALLOW" | "DENY";
  outboundDefaultAction: "ALLOW" | "DENY";
}

export type ProviderFirewallState = CanonicalFirewallState;

export interface ProviderSnapshot {
  id: string;
  name: string;
  status: "CREATING" | "READY" | "RESTORING" | "FAILED" | "DELETING";
  sizeGb?: number | null | undefined;
  createdBy?: string | null | undefined;
  createdAt: string;
}

export interface ProviderBackupPolicy {
  enabled: boolean;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  frequency: string;
  retentionCount: number;
  lastSuccessAt?: string | null | undefined;
  nextRunAt?: string | null | undefined;
  encrypted: boolean;
  crossRegion: boolean;
  region?: string | null | undefined;
}

export interface ProviderBackupPolicyInput {
  enabled: boolean;
  frequency: string;
  retentionCount: number;
  encrypted: boolean;
  crossRegion: boolean;
  region?: string | null | undefined;
}

export interface ProviderMetricsPoint {
  capturedAt: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  networkInMbps: number;
  networkOutMbps: number;
  uptimeSeconds: number;
}

export interface ProviderMetricsResult {
  range: string;
  points: ProviderMetricsPoint[];
}
