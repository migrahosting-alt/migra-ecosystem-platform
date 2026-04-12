import { ServerPowerState, SupportTier, VpsBillingCycle, VpsStatus } from "@prisma/client";
import type { VpsProviderAdapter } from "@/lib/vps/providers/adapter";
import type {
  ProviderActionResult,
  ProviderBackupPolicy,
  ProviderConsoleSessionResult,
  ProviderFirewallState,
  ProviderMetricsResult,
  ProviderServerRef,
  ProviderServerSummary,
  ProviderSnapshot,
} from "@/lib/vps/providers/types";

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

function asString(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

function asNumber(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function parseDateIso(input: unknown): string | null {
  const value = asString(input);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseEnum<T extends Record<string, string>>(values: T, input: unknown, fallback: T[keyof T]): T[keyof T] {
  const value = asString(input);
  return value && Object.values(values).includes(value) ? (value as T[keyof T]) : fallback;
}

function parseJsonEnv<T>(value: string | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error("[vps-provider] failed to parse JSON env", error);
    return fallback;
  }
}

function parseManualServer(input: unknown, providerSlug: string): ProviderServerSummary | null {
  const row = asRecord(input);
  if (!row) return null;

  const name = asString(row.name);
  const hostname = asString(row.hostname);
  const publicIpv4 = asString(row.publicIpv4);
  const region = asString(row.region);
  const imageSlug = asString(row.imageSlug);
  const osName = asString(row.osName);
  const planSlug = asString(row.planSlug);

  if (!name || !hostname || !publicIpv4 || !region || !imageSlug || !osName || !planSlug) {
    return null;
  }

  return {
    providerSlug: asString(row.providerSlug) || providerSlug,
    providerServerId: asString(row.providerServerId) || asString(row.providerInstanceId),
    providerRegionId: asString(row.providerRegionId),
    providerPlanId: asString(row.providerPlanId),
    name,
    hostname,
    instanceId: asString(row.instanceId) || hostname,
    status: parseEnum(VpsStatus, row.status, VpsStatus.RUNNING),
    powerState: parseEnum(ServerPowerState, row.powerState, ServerPowerState.ON),
    publicIpv4,
    privateIpv4: asString(row.privateIpv4),
    gatewayIpv4: asString(row.gatewayIpv4),
    privateNetwork: asString(row.privateNetwork),
    sshPort: asNumber(row.sshPort) || 22,
    defaultUsername: asString(row.defaultUsername) || "root",
    region,
    datacenterLabel: asString(row.datacenterLabel),
    imageSlug,
    osName,
    imageVersion: asString(row.imageVersion),
    virtualizationType: asString(row.virtualizationType),
    planSlug,
    planName: asString(row.planName),
    vcpu: asNumber(row.vcpu) || 1,
    memoryMb: asNumber(row.memoryMb) || 1024,
    diskGb: asNumber(row.diskGb) || 25,
    bandwidthTb: asNumber(row.bandwidthTb) || 1,
    bandwidthUsedGb: asNumber(row.bandwidthUsedGb) || 0,
    reverseDns: asString(row.reverseDns),
    reverseDnsStatus: asString(row.reverseDnsStatus),
    firewallEnabled: row.firewallEnabled !== false,
    firewallProfileName: asString(row.firewallProfileName),
    monitoringEnabled: row.monitoringEnabled === true,
    monitoringStatus: asString(row.monitoringStatus),
    backupsEnabled: row.backupsEnabled === true,
    backupRegion: asString(row.backupRegion),
    snapshotCount: asNumber(row.snapshotCount) || 0,
    nextInvoiceAt: parseDateIso(row.nextInvoiceAt),
    renewalAt: parseDateIso(row.renewalAt),
    billingCycle: parseEnum(VpsBillingCycle, row.billingCycle, VpsBillingCycle.MONTHLY),
    monthlyPriceCents: asNumber(row.monthlyPriceCents) || 0,
    billingCurrency: asString(row.billingCurrency) || "USD",
    supportTier: parseEnum(SupportTier, row.supportTier, SupportTier.STANDARD),
    supportTicketUrl: asString(row.supportTicketUrl),
    supportDocsUrl: asString(row.supportDocsUrl),
    rescueEnabled: row.rescueEnabled === true,
    consoleUrl: asString(row.consoleUrl),
    lastKnownProviderStateJson: row,
  };
}

function getManualServers(providerSlug: string): ProviderServerSummary[] {
  const sources = [
    process.env.MIGRAHOSTING_VPS_MANUAL_SERVERS_JSON,
    process.env.MIGRAHOSTING_VPS_MANUAL_SERVER_JSON,
  ].filter(Boolean) as string[];

  const rows: ProviderServerSummary[] = [];
  for (const source of sources) {
    const parsed = parseJsonEnv<unknown>(source, null);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      const server = parseManualServer(item, providerSlug);
      if (server) {
        rows.push(server);
      }
    }
  }

  return rows;
}

function findManualServer(ref: ProviderServerRef, providerSlug: string): ProviderServerSummary | null {
  const servers = getManualServers(providerSlug);
  return (
    servers.find((server) => (
      (ref.providerServerId && server.providerServerId && server.providerServerId === ref.providerServerId)
      || server.instanceId === ref.instanceId
      || server.publicIpv4 === ref.publicIpv4
      || server.name === ref.name
    )) || null
  );
}

function simulatedActionResult(
  providerSlug: string,
  action: string,
  patch: Partial<ProviderServerSummary>,
): ProviderActionResult {
  return {
    accepted: true,
    status: "SUCCEEDED",
    message: `${action.toLowerCase()}_simulated`,
    serverPatch: patch,
    metadata: {
      provider: providerSlug,
      simulated: true,
      action,
    },
  };
}

function unsupportedAction(providerSlug: string, message: string): ProviderActionResult {
  return {
    accepted: false,
    status: "FAILED",
    message,
    metadata: { provider: providerSlug },
  };
}

function getManualFirewallState(): ProviderFirewallState {
  return parseJsonEnv<ProviderFirewallState>(process.env.MIGRAHOSTING_VPS_MANUAL_FIREWALL_JSON, {
    isEnabled: true,
    profileName: "Secure SSH Only",
    status: "ACTIVE",
    isActive: true,
    inboundDefaultAction: "DENY",
    outboundDefaultAction: "ALLOW",
    antiLockoutEnabled: true,
    rollbackWindowSec: 120,
    rules: [
      {
        id: "ssh",
        direction: "INBOUND",
        action: "ALLOW",
        protocol: "TCP",
        portStart: 22,
        portEnd: 22,
        sourceCidr: "0.0.0.0/0",
        description: "SSH access",
        priority: 100,
        isEnabled: true,
      },
    ],
  });
}

function getManualSnapshots(): ProviderSnapshot[] {
  return parseJsonEnv<ProviderSnapshot[]>(process.env.MIGRAHOSTING_VPS_MANUAL_SNAPSHOTS_JSON, []);
}

function getManualBackupPolicy(): ProviderBackupPolicy {
  return parseJsonEnv<ProviderBackupPolicy>(process.env.MIGRAHOSTING_VPS_MANUAL_BACKUP_POLICY_JSON, {
    enabled: false,
    status: "DISABLED",
    frequency: "daily",
    retentionCount: 7,
    encrypted: true,
    crossRegion: false,
  });
}

function getManualMetrics(range: string): ProviderMetricsResult {
  const fallback = {
    range,
    points: [
      {
        capturedAt: new Date().toISOString(),
        cpuPercent: 0,
        memoryPercent: 0,
        diskPercent: 0,
        networkInMbps: 0,
        networkOutMbps: 0,
        uptimeSeconds: 0,
      },
    ],
  };

  return parseJsonEnv<ProviderMetricsResult>(process.env.MIGRAHOSTING_VPS_MANUAL_METRICS_JSON, fallback);
}

export function createEnvBackedProviderAdapter(providerSlug: string): VpsProviderAdapter {
  return {
    slug: providerSlug,
    capabilities: {
      powerControl: true,
      console: true,
      rescue: true,
      rebuild: true,
      firewallRead: true,
      firewallWrite: true,
      snapshots: true,
      backups: true,
      metrics: true,
    },
    async listServers() {
      return getManualServers(providerSlug).filter((server) => server.providerSlug === providerSlug);
    },
    async getServer(input) {
      return findManualServer(input, providerSlug);
    },
    async getActionStatus(_input, request) {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return {
          accepted: true,
          status: "SUCCEEDED",
          message: `${request.action.toLowerCase()}_simulated`,
          providerTaskId: request.taskId,
          metadata: {
            provider: providerSlug,
            simulated: true,
            action: request.action,
            taskId: request.taskId,
          },
        };
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_action_status_not_configured`);
    },
    async powerOn() {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "POWER_ON", {
          powerState: ServerPowerState.ON,
          status: VpsStatus.RUNNING,
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_power_on_not_configured`);
    },
    async powerOff() {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "POWER_OFF", {
          powerState: ServerPowerState.OFF,
          status: VpsStatus.STOPPED,
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_power_off_not_configured`);
    },
    async reboot(_input) {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "REBOOT", {
          powerState: ServerPowerState.ON,
          status: VpsStatus.RUNNING,
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_reboot_not_configured`);
    },
    async enableRescue() {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "ENABLE_RESCUE", {
          powerState: ServerPowerState.ON,
          status: VpsStatus.RESCUED,
          rescueEnabled: true,
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_enable_rescue_not_configured`);
    },
    async disableRescue() {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "DISABLE_RESCUE", {
          powerState: ServerPowerState.ON,
          status: VpsStatus.RUNNING,
          rescueEnabled: false,
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_disable_rescue_not_configured`);
    },
    async rebuild(_input, request) {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "REBUILD", {
          powerState: ServerPowerState.ON,
          status: VpsStatus.RUNNING,
          rescueEnabled: false,
          ...(request.imageSlug ? { imageSlug: request.imageSlug } : {}),
          ...(request.hostname ? { hostname: request.hostname } : {}),
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_rebuild_not_configured`);
    },
    async createConsoleSession(input, request): Promise<ProviderConsoleSessionResult> {
      const record = findManualServer(input, providerSlug);
      const launchUrl = record?.consoleUrl || asString(process.env.MIGRAHOSTING_VPS_MANUAL_CONSOLE_URL);

      if (!launchUrl) {
        return {
          supported: false,
          mode: request.viewOnly ? "VIEW_ONLY" : "FULL",
          message: `${providerSlug}_provider_console_not_configured`,
        };
      }

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      return {
        supported: true,
        mode: request.viewOnly ? "VIEW_ONLY" : "FULL",
        sessionId: `${providerSlug}-${input.instanceId}-${Date.now()}`,
        launchUrl,
        token: `${providerSlug}-console-session`,
        expiresAt,
        message: `${providerSlug}_provider_console_session`,
      };
    },
    async getFirewall() {
      return getManualFirewallState();
    },
    async updateFirewall(_input, request) {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "UPDATE_FIREWALL", {
          firewallEnabled: request.firewall.isEnabled !== false,
          firewallProfileName: request.firewall.profileName || "Managed Firewall",
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_update_firewall_not_configured`);
    },
    async listSnapshots() {
      return getManualSnapshots();
    },
    async createSnapshot(_input, request) {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "CREATE_SNAPSHOT", {
          snapshotCount: getManualSnapshots().length + 1,
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_create_snapshot_not_configured:${request.name}`);
    },
    async restoreSnapshot() {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "RESTORE_SNAPSHOT", {
          status: VpsStatus.RUNNING,
          powerState: ServerPowerState.ON,
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_restore_snapshot_not_configured`);
    },
    async deleteSnapshot() {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "DELETE_SNAPSHOT", {
          snapshotCount: Math.max(getManualSnapshots().length - 1, 0),
        });
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_delete_snapshot_not_configured`);
    },
    async getBackupPolicy() {
      return getManualBackupPolicy();
    },
    async updateBackupPolicy() {
      if (process.env.MIGRAHOSTING_VPS_SIMULATE_ACTIONS === "true") {
        return simulatedActionResult(providerSlug, "UPDATE_BACKUP_POLICY", {});
      }

      return unsupportedAction(providerSlug, `${providerSlug}_provider_update_backup_policy_not_configured`);
    },
    async getMetrics(_input, request) {
      return getManualMetrics(request.range);
    },
  };
}

export const mockVpsProviderAdapter = createEnvBackedProviderAdapter("manual");
