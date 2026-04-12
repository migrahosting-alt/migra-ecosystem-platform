import type { VpsProviderAdapter } from "@/lib/vps/providers/adapter";
import { proxmoxFetch } from "@/lib/vps/providers/proxmox/client";
import { mapProxmoxServer, mapProxmoxTask, mapProxmoxTaskId } from "@/lib/vps/providers/proxmox/mappers";
import type { ProviderActionResult, ProviderServerRef, ProviderSnapshot } from "@/lib/vps/providers/types";
import { unsupportedFeatureError } from "@/lib/vps/providers/shared/errors";

type ProxmoxEnvelope<T> = {
  data: T;
};

type ProxmoxVmResource = Record<string, unknown> & {
  vmid?: string | number;
  node?: string;
};

function unwrapData<T>(response: T | ProxmoxEnvelope<T>) {
  if (response && typeof response === "object" && "data" in (response as ProxmoxEnvelope<T>)) {
    return (response as ProxmoxEnvelope<T>).data;
  }

  return response as T;
}

function proxmoxVmId(input: ProviderServerRef) {
  return String(input.providerServerId || input.instanceId);
}

async function listClusterVmResources() {
  return unwrapData(await proxmoxFetch<ProxmoxVmResource[] | ProxmoxEnvelope<ProxmoxVmResource[]>>("/api2/json/cluster/resources?type=vm"));
}

async function resolveProxmoxVmResource(input: ProviderServerRef) {
  const vmid = proxmoxVmId(input);
  const resources = await listClusterVmResources();
  return resources.find((resource) => String(resource.vmid || resource.id || "") === vmid) || null;
}

async function resolveProxmoxNode(input: ProviderServerRef) {
  const resource = await resolveProxmoxVmResource(input);
  if (!resource?.node) {
    throw new Error(`Unable to resolve Proxmox node for VM ${proxmoxVmId(input)}.`);
  }

  return String(resource.node);
}

function parseProxmoxTaskNode(taskId: string) {
  if (!taskId.startsWith("UPID:")) {
    return null;
  }

  const parts = taskId.split(":");
  return parts[1] || null;
}

function mapProxmoxTaskStatus(taskId: string, payload: Record<string, unknown>): ProviderActionResult {
  const status = String(payload.status || "").toLowerCase();
  const exitStatus = String(payload.exitstatus || payload.exitStatus || "").toUpperCase();
  const message = String(payload.status || payload.exitstatus || "").trim();

  let normalized: ProviderActionResult["status"] = "QUEUED";
  if (status === "running") {
    normalized = "RUNNING";
  } else if (status === "stopped" || status === "ok") {
    normalized = exitStatus === "OK" || !exitStatus ? "SUCCEEDED" : "FAILED";
  }

  return {
    accepted: normalized !== "FAILED",
    status: normalized,
    ...(message ? { message } : {}),
    providerTaskId: taskId,
    providerRequestId: taskId,
    raw: payload,
  };
}

function mapProxmoxSnapshot(input: Record<string, unknown>): ProviderSnapshot {
  const timestamp = Number(input.snaptime || input.timestamp || 0);
  return {
    id: String(input.name || input.snapname || input.id || "snapshot"),
    name: String(input.name || input.snapname || input.id || "snapshot"),
    status: "READY",
    sizeGb: null,
    createdBy: null,
    createdAt: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
  };
}

function mapQueuedTask(task: string | Record<string, unknown>) {
  return typeof task === "string" ? mapProxmoxTaskId(task) : mapProxmoxTask(task);
}

export const proxmoxAdapter: VpsProviderAdapter = {
  slug: "proxmox",
  capabilities: {
    powerControl: true,
    console: false,
    rescue: false,
    rebuild: false,
    firewallRead: false,
    firewallWrite: false,
    snapshots: true,
    backups: false,
    metrics: false,
  },
  async listServers() {
    const resources = await listClusterVmResources();
    return resources.map((resource) => mapProxmoxServer(resource));
  },
  async getServer(input) {
    const resource = await resolveProxmoxVmResource(input);
    if (!resource) {
      return null;
    }

    return mapProxmoxServer({
      ...resource,
      publicIpv4: resource.publicIpv4 || resource.ip || input.publicIpv4,
      name: resource.name || input.name,
    });
  },
  async getActionStatus(_input, request) {
    const node = parseProxmoxTaskNode(request.taskId);
    if (!node) {
      throw new Error(`Unable to resolve Proxmox task node from ${request.taskId}.`);
    }

    const payload = unwrapData(await proxmoxFetch<Record<string, unknown> | ProxmoxEnvelope<Record<string, unknown>>>(`/api2/json/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(request.taskId)}/status`));
    return mapProxmoxTaskStatus(request.taskId, payload);
  },
  async powerOn(input) {
    const node = await resolveProxmoxNode(input);
    return mapQueuedTask(unwrapData(await proxmoxFetch<string | ProxmoxEnvelope<string>>(`/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(proxmoxVmId(input))}/status/start`, { method: "POST" })));
  },
  async powerOff(input) {
    const node = await resolveProxmoxNode(input);
    return mapQueuedTask(unwrapData(await proxmoxFetch<string | ProxmoxEnvelope<string>>(`/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(proxmoxVmId(input))}/status/stop`, { method: "POST" })));
  },
  async reboot(input) {
    const node = await resolveProxmoxNode(input);
    const action = input.hard ? "reset" : "reboot";
    return mapQueuedTask(unwrapData(await proxmoxFetch<string | ProxmoxEnvelope<string>>(`/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(proxmoxVmId(input))}/status/${action}`, { method: "POST" })));
  },
  async enableRescue() { throw unsupportedFeatureError("proxmox", "rescue mode"); },
  async disableRescue() { throw unsupportedFeatureError("proxmox", "rescue mode"); },
  async rebuild() { throw unsupportedFeatureError("proxmox", "rebuild"); },
  async createConsoleSession() { throw unsupportedFeatureError("proxmox", "console session"); },
  async getFirewall() { throw unsupportedFeatureError("proxmox", "firewall read"); },
  async updateFirewall() { throw unsupportedFeatureError("proxmox", "firewall write"); },
  async listSnapshots(input) {
    const node = await resolveProxmoxNode(input);
    const payload = unwrapData(await proxmoxFetch<Record<string, unknown>[] | ProxmoxEnvelope<Record<string, unknown>[]>>(`/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(proxmoxVmId(input))}/snapshot`));
    return payload
      .filter((snapshot) => String(snapshot.name || "") !== "current")
      .map((snapshot) => mapProxmoxSnapshot(snapshot));
  },
  async createSnapshot(input, request) {
    const node = await resolveProxmoxNode(input);
    const body = new URLSearchParams({ snapname: request.name }).toString();
    return mapQueuedTask(unwrapData(await proxmoxFetch<string | ProxmoxEnvelope<string>>(`/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(proxmoxVmId(input))}/snapshot`, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })));
  },
  async restoreSnapshot() { throw unsupportedFeatureError("proxmox", "snapshot restore"); },
  async deleteSnapshot(input, request) {
    const node = await resolveProxmoxNode(input);
    return mapQueuedTask(unwrapData(await proxmoxFetch<string | ProxmoxEnvelope<string>>(`/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(proxmoxVmId(input))}/snapshot/${encodeURIComponent(request.snapshotId)}`, {
      method: "DELETE",
    })));
  },
  async getBackupPolicy() { throw unsupportedFeatureError("proxmox", "backups"); },
  async updateBackupPolicy() { throw unsupportedFeatureError("proxmox", "backups"); },
  async getMetrics() { throw unsupportedFeatureError("proxmox", "metrics"); },
};
