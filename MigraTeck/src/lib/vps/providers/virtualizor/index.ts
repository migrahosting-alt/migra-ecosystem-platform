import type { VpsProviderAdapter } from "@/lib/vps/providers/adapter";
import { virtualizorFetch } from "@/lib/vps/providers/virtualizor/client";
import { mapVirtualizorServer } from "@/lib/vps/providers/virtualizor/mappers";
import type { ProviderActionResult, ProviderServerRef } from "@/lib/vps/providers/types";
import { unsupportedFeatureError } from "@/lib/vps/providers/shared/errors";

function extractVirtualizorServers(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([key, value]) => /^\d+$/.test(key) && value && typeof value === "object")
    .map(([, value]) => value as Record<string, unknown>);
}

function mapVirtualizorActionResult(payload: Record<string, unknown>): ProviderActionResult {
  const done = payload.done === true;
  const vsop = payload.vsop && typeof payload.vsop === "object" ? payload.vsop as Record<string, unknown> : null;
  const statusMap = vsop?.status && typeof vsop.status === "object" ? vsop.status as Record<string, unknown> : null;
  const nextStatus = done ? "SUCCEEDED" : "FAILED";

  return {
    accepted: done,
    status: nextStatus,
    message: String(payload.done_msg || payload.error || `${vsop?.action || "action"}_failed`).trim(),
    providerRequestId: String(vsop?.id || "") || undefined,
    metadata: statusMap ? { status: statusMap } : undefined,
    raw: payload,
  };
}

function mapVirtualizorTaskResult(taskId: string, payload: Record<string, unknown>): ProviderActionResult {
  const tasks = payload.tasks && typeof payload.tasks === "object" ? payload.tasks as Record<string, unknown> : {};
  const task = tasks[taskId];
  if (!task || typeof task !== "object") {
    return {
      accepted: false,
      status: "FAILED",
      message: `Virtualizor task ${taskId} was not found.`,
      providerTaskId: taskId,
      raw: payload,
    };
  }

  const record = task as Record<string, unknown>;
  const rawStatus = String(record.status || "");
  const progress = Number(record.progress || 0);
  const normalized = rawStatus === "1" && progress >= 100 ? "SUCCEEDED" : rawStatus === "1" ? "RUNNING" : rawStatus === "0" && progress > 0 ? "RUNNING" : "FAILED";

  return {
    accepted: normalized !== "FAILED",
    status: normalized,
    message: String(record.status_txt || record.action_txt || "").trim() || undefined,
    providerTaskId: taskId,
    providerRequestId: taskId,
    raw: record,
  };
}

async function getVirtualizorServerRecord(input: ProviderServerRef) {
  const payload = await virtualizorFetch<Record<string, unknown>>(`?act=vs&vpsid=${encodeURIComponent(String(input.providerServerId || input.instanceId))}`);
  return extractVirtualizorServers(payload)[0] || null;
}

export const virtualizorAdapter: VpsProviderAdapter = {
  slug: "virtualizor",
  capabilities: {
    powerControl: true,
    console: false,
    rescue: false,
    rebuild: false,
    firewallRead: false,
    firewallWrite: false,
    snapshots: false,
    backups: false,
    metrics: false,
  },
  async listServers() {
    const payload = await virtualizorFetch<Record<string, unknown>>("?act=vs");
    return extractVirtualizorServers(payload).map((server) => mapVirtualizorServer(server));
  },
  async getServer(input) {
    const record = await getVirtualizorServerRecord(input);
    if (!record) {
      return null;
    }

    return mapVirtualizorServer({
      ...record,
      publicIpv4: record.publicIpv4 || record.ip || input.publicIpv4,
      hostname: record.hostname || input.name,
    });
  },
  async getActionStatus(_input, request) {
    const payload = await virtualizorFetch<Record<string, unknown>>("?act=tasks");
    return mapVirtualizorTaskResult(request.taskId, payload);
  },
  async powerOn(input) {
    return mapVirtualizorActionResult(await virtualizorFetch<Record<string, unknown>>(`?act=vs&action=start&vpsid=${encodeURIComponent(String(input.providerServerId || input.instanceId))}`));
  },
  async powerOff(input) {
    return mapVirtualizorActionResult(await virtualizorFetch<Record<string, unknown>>(`?act=vs&action=stop&vpsid=${encodeURIComponent(String(input.providerServerId || input.instanceId))}`));
  },
  async reboot(input) {
    return mapVirtualizorActionResult(await virtualizorFetch<Record<string, unknown>>(`?act=vs&action=restart&vpsid=${encodeURIComponent(String(input.providerServerId || input.instanceId))}`));
  },
  async enableRescue() { throw unsupportedFeatureError("virtualizor", "rescue mode"); },
  async disableRescue() { throw unsupportedFeatureError("virtualizor", "rescue mode"); },
  async rebuild() { throw unsupportedFeatureError("virtualizor", "rebuild"); },
  async createConsoleSession() { throw unsupportedFeatureError("virtualizor", "console session"); },
  async getFirewall() { throw unsupportedFeatureError("virtualizor", "firewall read"); },
  async updateFirewall() { throw unsupportedFeatureError("virtualizor", "firewall write"); },
  async listSnapshots() { throw unsupportedFeatureError("virtualizor", "snapshots"); },
  async createSnapshot() { throw unsupportedFeatureError("virtualizor", "snapshots"); },
  async restoreSnapshot() { throw unsupportedFeatureError("virtualizor", "snapshots"); },
  async deleteSnapshot() { throw unsupportedFeatureError("virtualizor", "snapshots"); },
  async getBackupPolicy() { throw unsupportedFeatureError("virtualizor", "backups"); },
  async updateBackupPolicy() { throw unsupportedFeatureError("virtualizor", "backups"); },
  async getMetrics() { throw unsupportedFeatureError("virtualizor", "metrics"); },
};
