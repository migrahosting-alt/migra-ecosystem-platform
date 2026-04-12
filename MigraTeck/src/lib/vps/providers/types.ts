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
  providerServerId?: string | null;
  providerRegionId?: string | null;
  providerPlanId?: string | null;
  name: string;
  hostname: string;
  instanceId: string;
  status: VpsStatus;
  powerState: ServerPowerState;
  publicIpv4: string;
  privateIpv4?: string | null;
  gatewayIpv4?: string | null;
  privateNetwork?: string | null;
  sshPort: number;
  defaultUsername: string;
  region: string;
  datacenterLabel?: string | null;
  imageSlug: string;
  osName: string;
  imageVersion?: string | null;
  virtualizationType?: string | null;
  planSlug: string;
  planName?: string | null;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  bandwidthTb: number;
  bandwidthUsedGb?: number;
  reverseDns?: string | null;
  reverseDnsStatus?: string | null;
  firewallEnabled?: boolean;
  firewallProfileName?: string | null;
  monitoringEnabled?: boolean;
  monitoringStatus?: string | null;
  backupsEnabled?: boolean;
  backupRegion?: string | null;
  snapshotCount?: number;
  nextInvoiceAt?: string | null;
  renewalAt?: string | null;
  billingCycle?: VpsBillingCycle;
  monthlyPriceCents?: number;
  billingCurrency?: string;
  supportTier?: SupportTier | null;
  supportTicketUrl?: string | null;
  supportDocsUrl?: string | null;
  rescueEnabled?: boolean;
  consoleUrl?: string | null;
  lastKnownProviderStateJson?: Record<string, unknown> | null;
}

export interface ProviderActionResult {
  accepted: boolean;
  status: "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  message?: string;
  providerRequestId?: string;
  providerTaskId?: string;
  serverPatch?: Partial<ProviderServerSummary>;
  metadata?: Record<string, unknown>;
  raw?: unknown;
}

export interface ProviderConsoleSessionResult {
  supported: boolean;
  mode: "FULL" | "VIEW_ONLY";
  status?: "READY" | "PENDING" | "FAILED";
  sessionId?: string;
  launchUrl?: string;
  token?: string;
  expiresAt?: string;
  message?: string;
  raw?: unknown;
}

export interface ProviderServerRef {
  providerSlug: string;
  providerServerId?: string | null;
  instanceId: string;
  publicIpv4: string;
  name: string;
}

export interface RebuildInput {
  imageSlug?: string;
  hostname?: string;
  sshKeys?: string[];
  reason?: string;
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
  sizeGb?: number | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface ProviderBackupPolicy {
  enabled: boolean;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  frequency: string;
  retentionCount: number;
  lastSuccessAt?: string | null;
  nextRunAt?: string | null;
  encrypted: boolean;
  crossRegion: boolean;
  region?: string | null;
}

export interface ProviderBackupPolicyInput {
  enabled: boolean;
  frequency: string;
  retentionCount: number;
  encrypted: boolean;
  crossRegion: boolean;
  region?: string | null;
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
