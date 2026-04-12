import type { VpsProviderAdapter } from "@/lib/vps/providers/adapter";
import { mhFetch } from "@/lib/vps/providers/mh/client";
import { getMhStubServer, listMhStubServers, mhStubDisableRescue, mhStubEnableRescue, mhStubPowerOff, mhStubPowerOn, mhStubReboot, shouldUseMhStub } from "@/lib/vps/providers/mh/stub";
import { mapMhAction, mapMhBackupPolicy, mapMhConsole, mapMhFirewall, mapMhMetrics, mapMhServer, mapMhSnapshots } from "@/lib/vps/providers/mh/mappers";

export const mhAdapter: VpsProviderAdapter = {
  slug: "mh",
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
    if (process.env.MH_STUB_MODE === "true") {
      return listMhStubServers();
    }

    const response = await mhFetch<{ servers?: unknown[] } | unknown[]>("/v1/servers");
    const rows = Array.isArray(response) ? response : response.servers || [];
    return rows.map((row) => mapMhServer(row as never));
  },
  async getServer(input) {
    if (await shouldUseMhStub(input)) {
      return getMhStubServer(input);
    }

    return mapMhServer(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}`));
  },
  async getActionStatus(input, request) {
    return mapMhAction(await mhFetch(`/v1/tasks/${request.taskId}`));
  },
  async powerOn(input) {
    if (await shouldUseMhStub(input)) {
      return mhStubPowerOn(input);
    }

    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/power/on`, { method: "POST", body: JSON.stringify({}) }));
  },
  async powerOff(input) {
    if (await shouldUseMhStub(input)) {
      return mhStubPowerOff(input);
    }

    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/power/off`, { method: "POST", body: JSON.stringify({}) }));
  },
  async reboot(input) {
    if (await shouldUseMhStub(input)) {
      return mhStubReboot(input);
    }

    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/power/reboot`, { method: "POST", body: JSON.stringify({ hard: input.hard === true }) }));
  },
  async enableRescue(input) {
    if (await shouldUseMhStub(input)) {
      return mhStubEnableRescue(input);
    }

    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/rescue/enable`, { method: "POST", body: JSON.stringify({}) }));
  },
  async disableRescue(input) {
    if (await shouldUseMhStub(input)) {
      return mhStubDisableRescue(input);
    }

    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/rescue/disable`, { method: "POST", body: JSON.stringify({}) }));
  },
  async rebuild(input, request) {
    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/rebuild`, { method: "POST", body: JSON.stringify(request) }));
  },
  async createConsoleSession(input, request) {
    return mapMhConsole(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/console/session`, { method: "POST", body: JSON.stringify({ actorUserId: request.actorUserId, viewOnly: request.viewOnly }) }));
  },
  async getFirewall(input) {
    return mapMhFirewall(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/firewall`));
  },
  async updateFirewall(input, request) {
    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/firewall`, { method: "PUT", body: JSON.stringify(request.firewall) }));
  },
  async listSnapshots(input) {
    return mapMhSnapshots(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/snapshots`));
  },
  async createSnapshot(input, request) {
    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/snapshots`, { method: "POST", body: JSON.stringify(request) }));
  },
  async restoreSnapshot(input, request) {
    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/snapshots/${request.snapshotId}/restore`, { method: "POST", body: JSON.stringify({}) }));
  },
  async deleteSnapshot(input, request) {
    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/snapshots/${request.snapshotId}`, { method: "DELETE" }));
  },
  async getBackupPolicy(input) {
    return mapMhBackupPolicy(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/backups`));
  },
  async updateBackupPolicy(input, request) {
    return mapMhAction(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/backups`, { method: "PUT", body: JSON.stringify(request.policy) }));
  },
  async getMetrics(input, request) {
    return mapMhMetrics(await mhFetch(`/v1/servers/${input.providerServerId || input.instanceId}/metrics?range=${request.range}`));
  },
};
