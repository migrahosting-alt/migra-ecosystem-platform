import type { VpsDiagnosticsState } from "@/lib/vps/diagnostics";

export type VpsProviderControlMode = "LIVE_API" | "STUB" | "MIXED" | "UNCONFIGURED";

export type VpsProviderHealthState = "HEALTHY" | "DEGRADED" | "UNREACHABLE" | "UNKNOWN";

export type VpsDashboardPayload = {
  diagnostics: VpsDiagnosticsState;
  server: {
    id: string;
    instanceId: string;
    providerSlug: string;
    providerServerId?: string;
    providerRegionId?: string;
    providerPlanId?: string;
    name: string;
    hostname: string;
    status: "PROVISIONING" | "RUNNING" | "STOPPED" | "REBOOTING" | "RESCUED" | "REBUILDING" | "SUSPENDED" | "TERMINATED" | "ERROR";
    powerState: "ON" | "OFF" | "UNKNOWN";
    publicIpv4: string;
    privateIpv4?: string;
    sshEndpoint: string;
    region: string;
    datacenterLabel?: string;
    osName: string;
    imageSlug: string;
    imageVersion?: string;
    plan: {
      slug: string;
      name?: string;
      vcpu: number;
      memoryGb: number;
      diskGb: number;
      bandwidthTb: number;
    };
    billing: {
      monthlyPriceCents: number;
      renewalAt?: string;
      nextInvoiceAt?: string;
      cycle: "MONTHLY" | "YEARLY";
      currency: string;
    };
    support: {
      tier: string;
      ticketUrl?: string;
      docsUrl?: string;
      openTicketCount: number;
      latestTicketUpdatedAt?: string;
    };
    providerHealthState: VpsProviderHealthState;
    providerLastCheckedAt?: string;
    providerError?: string;
    driftDetectedAt?: string;
    driftType?: string;
    createdAt: string;
    lastSyncedAt?: string;
    reverseDns?: string;
    reverseDnsStatus?: string;
    backupsEnabled: boolean;
    monitoringEnabled: boolean;
    monitoringStatus?: string;
    firewallEnabled: boolean;
    firewallProfileName?: string;
    rescueEnabled: boolean;
    defaultUsername: string;
    sshPort: number;
    privateNetwork?: string;
    gatewayIpv4?: string;
    virtualizationType?: string;
    bandwidthUsedGb: number;
  };
  features: {
    console: boolean;
    firewall: boolean;
    snapshots: boolean;
    backups: boolean;
    monitoring: boolean;
    rebuild: boolean;
    supportDiagnostics: boolean;
  };
  sync: {
    lastSyncedAt?: string;
    isStale: boolean;
    staleAfterSeconds: number;
    pendingActionCount: number;
  };
  control: {
    providerLabel: string;
    mode: VpsProviderControlMode;
    runtimeConfigured: boolean;
    detail: string;
    healthState: VpsProviderHealthState;
    healthDetail: string;
    checkedAt?: string;
    safeMode: boolean;
  };
  actions: {
    canOpenConsole: boolean;
    canSync: boolean;
    canReboot: boolean;
    canPowerControl: boolean;
    canRescue: boolean;
    canRebuild: boolean;
    canManageFirewall: boolean;
    canManageSnapshots: boolean;
    canManageBackups: boolean;
    canManageBilling: boolean;
    canOpenSupport: boolean;
  };
  drift: {
    detected: boolean;
    type?: string;
    detectedAt?: string;
  };
  monitoring: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
    networkInMbps: number;
    networkOutMbps: number;
    uptimeSeconds: number;
    cpuSeries: number[];
    memorySeries: number[];
    diskSeries: number[];
    networkInSeries: number[];
    networkOutSeries: number[];
  };
  backups: {
    enabled: boolean;
    lastSuccessAt?: string;
    nextRunAt?: string;
    frequency?: string;
    retentionCount?: number;
    encrypted?: boolean;
    crossRegion?: boolean;
  };
  snapshots: {
    count: number;
    latestCreatedAt?: string;
  };
  activity: Array<{
    id: string;
    type: string;
    message: string;
    actor: string;
    createdAt: string;
    status: "SUCCESS" | "FAILED" | "PENDING";
    severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  }>;
};

export type VpsFleetItem = {
  id: string;
  providerSlug: string;
  name: string;
  hostname: string;
  status: string;
  powerState: string;
  publicIpv4: string;
  region: string;
  osName: string;
  planLabel: string;
  cpuRamLabel: string;
  lastSyncedAt?: string | undefined;
  renewalAt?: string | undefined;
  monthlyPriceCents: number;
  billingCurrency: string;
  backupsEnabled: boolean;
  firewallEnabled: boolean;
  monitoringStatus?: string | undefined;
  providerHealthState: VpsProviderHealthState;
  driftDetectedAt?: string | undefined;
  driftType?: string | undefined;
  incidentOpen: boolean;
  openAlertCount: number;
};

export type VpsFleetProviderStatus = {
  slug: string;
  label: string;
  configured: boolean;
  runtimeConfigured: boolean;
  status: "CONNECTED" | "NOT_CONNECTED";
  state: "ACTIVE" | "READY" | "OFFLINE";
  controlMode: VpsProviderControlMode;
  detail: string;
  healthState: VpsProviderHealthState;
  healthDetail: string;
  healthCheckedAt?: string;
  serverCount: number;
  stubServerCount: number;
  lastSyncedAt?: string;
};

export type VpsFleetWorkspaceState =
  | "NOT_ENABLED"
  | "NO_PROVIDER_CONFIGURED"
  | "READY_FOR_IMPORT"
  | "SYNC_ATTENTION"
  | "ACTIVE";

export type VpsFleetWorkspace = {
  prefersVpsWorkspace: boolean;
  servers: VpsFleetItem[];
  summary: {
    total: number;
    running: number;
    protected: number;
    monitored: number;
    monthlyTotalCents: number;
    degraded: number;
    unreachable: number;
    drifted: number;
    incidentOpen: number;
  };
  providers: VpsFleetProviderStatus[];
  sync: {
    status: "UNAVAILABLE" | "PENDING_IMPORT" | "HEALTHY" | "STALE";
    lastSyncedAt?: string;
    staleServerCount: number;
  };
  workspaceState: VpsFleetWorkspaceState;
  canImportFromProviders: boolean;
  banner?: {
    tone: "neutral" | "warning" | "danger";
    title: string;
    description: string;
  };
};
