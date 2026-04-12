import { OrgRole, ServerPowerState, VpsActionStatus, VpsBillingCycle, VpsStatus, type SupportTier } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";
import { createActionJob, executeActionJob } from "../../src/lib/vps/jobs";
import { resetVpsProvidersForTests, setVpsProviderForTests, type ProviderActionResult, type ProviderBackupPolicy, type ProviderConsoleSessionResult, type ProviderFirewallState, type ProviderMetricsResult, type ProviderServerSummary, type ProviderSnapshot, type RebuildInput, type VpsProviderAdapter } from "../../src/lib/vps/providers";
import { processVpsActionQueue } from "../../src/lib/vps/reconcile";

function buildServerSummary(serverId: string): ProviderServerSummary {
  return {
    providerSlug: "mh",
    providerServerId: `provider-${serverId}`,
    name: "queued-node",
    hostname: "queued-node.example.internal",
    instanceId: `instance-${serverId}`,
    status: VpsStatus.RUNNING,
    powerState: ServerPowerState.ON,
    publicIpv4: "203.0.113.50",
    sshPort: 22,
    defaultUsername: "root",
    region: "us-east",
    imageSlug: "ubuntu-24-04",
    osName: "Ubuntu 24.04 LTS",
    planSlug: "vps-4",
    vcpu: 4,
    memoryMb: 8192,
    diskGb: 160,
    bandwidthTb: 8,
    billingCycle: VpsBillingCycle.MONTHLY,
    monthlyPriceCents: 4200,
    billingCurrency: "USD",
    supportTier: "STANDARD" as SupportTier,
  };
}

function buildReconcileProvider(statuses: ProviderActionResult[]): VpsProviderAdapter {
  let pollIndex = 0;

  const summary = buildServerSummary("fixture");
  const nextStatus = (): ProviderActionResult => {
    const current = statuses[Math.min(pollIndex, statuses.length - 1)] ?? statuses[statuses.length - 1]!;
    pollIndex += 1;
    return current;
  };

  return {
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
    async listServers() { return [summary]; },
    async getServer(input) { return { ...summary, providerServerId: input.providerServerId || summary.providerServerId, instanceId: input.instanceId, name: input.name, publicIpv4: input.publicIpv4 }; },
    async getActionStatus(_input, request) { return { ...nextStatus(), providerTaskId: request.taskId }; },
    async powerOn() { return { accepted: true, status: "QUEUED", providerTaskId: "task-power-on" }; },
    async powerOff() { return { accepted: true, status: "QUEUED", providerTaskId: "task-power-off" }; },
    async reboot() { return { accepted: true, status: "QUEUED", providerTaskId: "task-reboot" }; },
    async enableRescue() { return { accepted: true, status: "QUEUED", providerTaskId: "task-rescue-enable" }; },
    async disableRescue() { return { accepted: true, status: "QUEUED", providerTaskId: "task-rescue-disable" }; },
    async rebuild(_input, _request: RebuildInput) { return { accepted: true, status: "QUEUED", providerTaskId: "task-rebuild" }; },
    async createConsoleSession(): Promise<ProviderConsoleSessionResult> {
      return { supported: true, mode: "FULL", status: "READY", sessionId: "console-session", launchUrl: "https://console.example.test" };
    },
    async getFirewall(): Promise<ProviderFirewallState> {
      return {
        isEnabled: true,
        profileName: "Managed",
        status: "ACTIVE",
        isActive: true,
        inboundDefaultAction: "DENY",
        outboundDefaultAction: "ALLOW",
        antiLockoutEnabled: true,
        rollbackWindowSec: 120,
        rules: [],
      };
    },
    async updateFirewall() { return { accepted: true, status: "QUEUED", providerTaskId: "task-firewall" }; },
    async listSnapshots(): Promise<ProviderSnapshot[]> { return []; },
    async createSnapshot() { return { accepted: true, status: "QUEUED", providerTaskId: "task-snapshot-create" }; },
    async restoreSnapshot() { return { accepted: true, status: "QUEUED", providerTaskId: "task-snapshot-restore" }; },
    async deleteSnapshot() { return { accepted: true, status: "QUEUED", providerTaskId: "task-snapshot-delete" }; },
    async getBackupPolicy(): Promise<ProviderBackupPolicy> {
      return { enabled: true, status: "ACTIVE", frequency: "daily", retentionCount: 7, encrypted: true, crossRegion: false };
    },
    async updateBackupPolicy() { return { accepted: true, status: "QUEUED", providerTaskId: "task-backups" }; },
    async getMetrics(): Promise<ProviderMetricsResult> { return { range: "1h", points: [] }; },
  };
}

async function createVpsServerFixture(orgId: string) {
  const server = await prisma.vpsServer.create({
    data: {
      orgId,
      providerSlug: "mh",
      providerServerId: `provider-${orgId}`,
      name: "queued-node",
      hostname: "queued-node.example.internal",
      instanceId: `instance-${orgId}`,
      status: VpsStatus.RUNNING,
      powerState: ServerPowerState.ON,
      publicIpv4: "203.0.113.50",
      sshPort: 22,
      defaultUsername: "root",
      region: "us-east",
      imageSlug: "ubuntu-24-04",
      osName: "Ubuntu 24.04 LTS",
      planSlug: "vps-4",
      vcpu: 4,
      memoryMb: 8192,
      diskGb: 160,
      bandwidthTb: 8,
      billingCycle: VpsBillingCycle.MONTHLY,
      monthlyPriceCents: 4200,
    },
  });

  await prisma.vpsProviderBinding.create({
    data: {
      serverId: server.id,
      providerSlug: "mh",
      providerServerId: server.providerServerId || server.instanceId,
    },
  });

  return server;
}

describe("VPS action reconciliation integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetVpsProvidersForTests();
  });

  test("queued VPS actions reconcile through running to succeeded", async () => {
    setVpsProviderForTests("mh", buildReconcileProvider([
      { accepted: true, status: "RUNNING", message: "still_working" },
      { accepted: true, status: "SUCCEEDED", message: "completed" },
    ]));

    const user = await createUser({ email: "vps-worker@example.com", password: "WorkerPass123!", emailVerified: true });
    const org = await createOrganization({ name: "VPS Worker Org", slug: "vps-worker-org", createdById: user.id });
    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    const server = await createVpsServerFixture(org.id);

    const job = await createActionJob({
      serverId: server.id,
      orgId: org.id,
      action: "CREATE_SNAPSHOT",
      requestedByUserId: user.id,
      requestJson: { name: "nightly-001" },
    });

    expect(await processVpsActionQueue(10)).toBe(1);

    let updated = await prisma.vpsActionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(VpsActionStatus.QUEUED);
    expect(updated.providerTaskId).toBe("task-snapshot-create");
    expect(updated.nextPollAt).toBeTruthy();

    await prisma.vpsActionJob.update({ where: { id: job.id }, data: { nextPollAt: new Date(Date.now() - 1000) } });
    expect(await processVpsActionQueue(10)).toBe(1);

    updated = await prisma.vpsActionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(VpsActionStatus.RUNNING);
    expect(updated.finishedAt).toBeNull();
    expect(updated.nextPollAt).toBeTruthy();

    await prisma.vpsActionJob.update({ where: { id: job.id }, data: { nextPollAt: new Date(Date.now() - 1000) } });
    expect(await processVpsActionQueue(10)).toBe(1);

    updated = await prisma.vpsActionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(VpsActionStatus.SUCCEEDED);
    expect(updated.finishedAt).toBeTruthy();
    expect(updated.nextPollAt).toBeNull();

    const auditEvents = await prisma.vpsAuditEvent.findMany({
      where: { relatedJobId: job.id },
      orderBy: { createdAt: "asc" },
    });

    expect(auditEvents.some((event) => event.eventType === "CREATE_SNAPSHOT_QUEUED")).toBe(true);
    expect(auditEvents.some((event) => event.eventType === "CREATE_SNAPSHOT_RUNNING")).toBe(true);
    expect(auditEvents.some((event) => event.eventType === "CREATE_SNAPSHOT_SUCCEEDED")).toBe(true);
  });

  test("failed provider reconciliation marks the VPS action as failed", async () => {
    setVpsProviderForTests("mh", buildReconcileProvider([
      { accepted: false, status: "FAILED", message: "provider_rejected" },
    ]));

    const user = await createUser({ email: "vps-worker-fail@example.com", password: "WorkerPass123!", emailVerified: true });
    const org = await createOrganization({ name: "VPS Worker Fail Org", slug: "vps-worker-fail-org", createdById: user.id });
    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    const server = await createVpsServerFixture(org.id);

    const job = await createActionJob({
      serverId: server.id,
      orgId: org.id,
      action: "DELETE_SNAPSHOT",
      requestedByUserId: user.id,
      requestJson: { snapshotId: "snap-001" },
    });

    await executeActionJob(job.id);
    await prisma.vpsActionJob.update({ where: { id: job.id }, data: { nextPollAt: new Date(Date.now() - 1000) } });

    expect(await processVpsActionQueue(10)).toBe(1);

    const updated = await prisma.vpsActionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(VpsActionStatus.FAILED);
    expect(updated.finishedAt).toBeTruthy();
    expect(updated.nextPollAt).toBeNull();
    expect(updated.errorJson).toBeTruthy();

    const auditEvents = await prisma.vpsAuditEvent.findMany({
      where: { relatedJobId: job.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditEvents.some((event) => event.eventType === "DELETE_SNAPSHOT_FAILED")).toBe(true);
  });

  test("unsupported provider capabilities fail queued jobs before provider execution", async () => {
    const unsupportedSnapshotsProvider: VpsProviderAdapter = {
      ...buildReconcileProvider([{ accepted: true, status: "SUCCEEDED" }]),
      capabilities: {
        powerControl: true,
        console: true,
        rescue: true,
        rebuild: true,
        firewallRead: true,
        firewallWrite: true,
        snapshots: false,
        backups: true,
        metrics: true,
      },
      async createSnapshot() {
        throw new Error("snapshot handler should not be reached");
      },
    };

    setVpsProviderForTests("mh", unsupportedSnapshotsProvider);

    const user = await createUser({ email: "vps-worker-unsupported@example.com", password: "WorkerPass123!", emailVerified: true });
    const org = await createOrganization({ name: "VPS Unsupported Org", slug: "vps-unsupported-org", createdById: user.id });
    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    const server = await createVpsServerFixture(org.id);

    const job = await createActionJob({
      serverId: server.id,
      orgId: org.id,
      action: "CREATE_SNAPSHOT",
      requestedByUserId: user.id,
      requestJson: { name: "blocked-snapshot" },
    });

    await expect(executeActionJob(job.id)).rejects.toThrow("does not support snapshots");

    const updated = await prisma.vpsActionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(VpsActionStatus.FAILED);
    expect(updated.finishedAt).toBeTruthy();
  });
});