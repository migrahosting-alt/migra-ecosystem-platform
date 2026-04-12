import {
  OrgRole,
  ServerPowerState,
  VpsProviderHealthState,
  VpsServerMemberRole,
  VpsActionStatus,
  VpsBillingCycle,
  VpsStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { assertDiagnosticsConsistency, type VpsDiagnosticsState } from "@/lib/vps/diagnostics";
import { executeActionJob } from "@/lib/vps/jobs";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

type VpsServerFixtureOverrides = {
  name?: string | undefined;
  hostname?: string | undefined;
  status?: VpsStatus | undefined;
  powerState?: ServerPowerState | undefined;
  publicIpv4?: string | undefined;
  region?: string | undefined;
  imageSlug?: string | undefined;
  osName?: string | undefined;
  planSlug?: string | undefined;
  vcpu?: number | undefined;
  memoryMb?: number | undefined;
  diskGb?: number | undefined;
  bandwidthTb?: number | undefined;
  providerHealthState?: VpsProviderHealthState | undefined;
};

type QueuedActionResponse = {
  jobId?: string | undefined;
  status?: string | undefined;
  result?: {
    status?: string | undefined;
  } | undefined;
};

type DiagnosticsEnvelope = VpsDiagnosticsState;
type AlertQueueEnvelope = {
  items: Array<{
    id: string;
    code: string;
    status: string;
    incident: { state: string } | null;
    suppressedUntil: string | null;
  }>;
};

function expectNoSensitiveDiagnosticsLeak(body: Record<string, unknown>) {
  expect(body).not.toHaveProperty("providerBindings");
  expect(body).not.toHaveProperty("recentErrors");
  expect(body).not.toHaveProperty("payloadJson");
  expect(body).not.toHaveProperty("requestJson");
  expect(body).not.toHaveProperty("resultJson");
  expect(body).not.toHaveProperty("sourceIp");
}

async function createVpsServerFixture(orgId: string, overrides: VpsServerFixtureOverrides = {}) {
  const server = await prisma.vpsServer.create({
    data: {
      orgId,
      providerSlug: "manual",
      providerServerId: "manual-server-fixture",
      name: overrides.name || "alpha-node",
      hostname: overrides.hostname || "alpha-node.example.internal",
      instanceId: "alpha-fixture",
      status: overrides.status || VpsStatus.RUNNING,
      powerState: overrides.powerState || ServerPowerState.ON,
      publicIpv4: overrides.publicIpv4 || "203.0.113.10",
      sshPort: 22,
      defaultUsername: "root",
      region: overrides.region || "us-east",
      imageSlug: overrides.imageSlug || "ubuntu-24-04",
      osName: overrides.osName || "Ubuntu 24.04 LTS",
      planSlug: overrides.planSlug || "vps-2",
      vcpu: overrides.vcpu || 2,
      memoryMb: overrides.memoryMb || 4096,
      diskGb: overrides.diskGb || 80,
      bandwidthTb: overrides.bandwidthTb || 4,
      billingCycle: VpsBillingCycle.MONTHLY,
      monthlyPriceCents: 2400,
      providerHealthState: overrides.providerHealthState || VpsProviderHealthState.UNKNOWN,
    },
  });

  await prisma.vpsProviderBinding.create({
    data: {
      serverId: server.id,
      providerSlug: "manual",
      providerServerId: "manual-server-fixture",
    },
  });

  return server;
}

async function createAuthenticatedServerContext(input?: {
  email?: string | undefined;
  orgRole?: OrgRole | undefined;
  serverRole?: VpsServerMemberRole | undefined;
  serverOverrides?: VpsServerFixtureOverrides | undefined;
}) {
  const user = await createUser({
    email: input?.email || "vps-diagnostics@example.com",
    password: "RoutesPass123!",
    emailVerified: true,
  });

  const org = await createOrganization({
    name: "VPS Diagnostics Org",
    slug: `vps-diagnostics-org-${user.id.slice(0, 8)}`,
    createdById: user.id,
  });

  await createMembership({ userId: user.id, orgId: org.id, role: input?.orgRole || OrgRole.OWNER });
  await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

  const server = await createVpsServerFixture(org.id, input?.serverOverrides);

  if (input?.serverRole) {
    await prisma.vpsServerMember.create({
      data: {
        serverId: server.id,
        userId: user.id,
        role: input.serverRole,
      },
    });
  }

  const client = new HttpClient(baseUrl);
  await createSessionForUser(client, user.id);

  return { user, org, server, client };
}

async function fetchDiagnostics(client: HttpClient, serverId: string) {
  const response = await client.get<DiagnosticsEnvelope>(`/api/vps/servers/${serverId}/diagnostics`);
  expect(response.status).toBe(200);
  assertDiagnosticsConsistency(response.body as VpsDiagnosticsState);
  return response.body as VpsDiagnosticsState;
}

async function fetchSupport(client: HttpClient, serverId: string) {
  return client.get<{ diagnostics?: DiagnosticsEnvelope } & Record<string, unknown>>(`/api/vps/servers/${serverId}/support`);
}

async function fetchSupportDiagnostics(client: HttpClient, serverId: string) {
  const response = await client.get<DiagnosticsEnvelope>(`/api/vps/servers/${serverId}/support/diagnostics`);
  expect(response.status).toBe(200);
  assertDiagnosticsConsistency(response.body as VpsDiagnosticsState);
  return response.body as VpsDiagnosticsState;
}

async function fetchAlerts(client: HttpClient, serverId: string) {
  const response = await client.get<AlertQueueEnvelope>(`/api/vps/servers/${serverId}/alerts`);
  expect(response.status).toBe(200);
  return response.body as AlertQueueEnvelope;
}

async function fetchOverview(client: HttpClient, serverId: string) {
  return client.get<{ diagnostics?: DiagnosticsEnvelope }>(`/api/vps/servers/${serverId}`);
}

describe("VPS diagnostics integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("provider unreachable is reflected consistently across diagnostics, support, and overview", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-provider@example.com",
    });

    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: VpsProviderHealthState.UNREACHABLE,
        providerLastCheckedAt: new Date(),
        providerError: "Provider unavailable.",
      },
    });

    const diagnostics = await fetchDiagnostics(client, server.id);
    const support = await fetchSupport(client, server.id);
    const overview = await fetchOverview(client, server.id);

    expect(diagnostics.provider.health).toBe("UNREACHABLE");
    expect(diagnostics.provider.error).toBe("Provider unavailable.");
    expect(support.status).toBe(200);
    expect(support.body?.diagnostics).toEqual(diagnostics);
    expect(overview.status).toBe(200);
    expect(overview.body?.diagnostics).toEqual(diagnostics);
  });

  test("drift is visible in diagnostics and correlated in activity", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-drift@example.com",
      serverOverrides: {
        hostname: "drifted-node.example.internal",
        powerState: ServerPowerState.OFF,
        planSlug: "vps-drift",
      },
    });

    const syncResponse = await client.post<QueuedActionResponse>(`/api/vps/servers/${server.id}/sync`, { json: {} });
    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body?.jobId).toBeTruthy();
    expect(syncResponse.body?.status).toBe(VpsActionStatus.QUEUED);
    await executeActionJob(syncResponse.body?.jobId as string);

    const diagnostics = await fetchDiagnostics(client, server.id);
    const activity = await client.get<{ events: Array<{ eventType: string }>; jobs: Array<{ status: string }> }>(`/api/vps/servers/${server.id}/activity`);

    expect(diagnostics.drift.detected).toBe(true);
    expect(diagnostics.drift.type).toBeTruthy();
    expect(activity.status).toBe(200);
    expect(activity.body?.events.some((event) => event.eventType === "DRIFT_DETECTED")).toBe(true);
  });

  test("read-only diagnostics access returns the contract without leaking internal fields", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-readonly@example.com",
      orgRole: OrgRole.OWNER,
      serverRole: VpsServerMemberRole.READ_ONLY,
    });

    const response = await client.get<Record<string, unknown>>(`/api/vps/servers/${server.id}/diagnostics`);

    expect(response.status).toBe(200);
    expect(response.body?.server).toBeTruthy();
    expect(response.body?.provider).toBeTruthy();
    expect(response.body?.drift).toBeTruthy();
    expect(response.body?.alerts).toBeTruthy();
    expectNoSensitiveDiagnosticsLeak(response.body || {});
  });

  test("last failed job is visible and matches activity history", async () => {
    const { server, client, user, org } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-failure@example.com",
    });

    const failedJob = await prisma.vpsActionJob.create({
      data: {
        serverId: server.id,
        orgId: org.id,
        action: "REBOOT",
        status: VpsActionStatus.FAILED,
        requestedByUserId: user.id,
        errorJson: { message: "provider_task_failed" },
        finishedAt: new Date(),
      },
    });

    const diagnostics = await fetchDiagnostics(client, server.id);
    const activity = await client.get<{ jobs: Array<{ id: string; status: string }> }>(`/api/vps/servers/${server.id}/activity`);

    expect(diagnostics.lastFailedJob?.id).toBe(failedJob.id);
    expect(diagnostics.lastFailedJob?.error).toBe("provider_task_failed");
    expect(activity.status).toBe(200);
    expect(activity.body?.jobs.some((job) => job.id === failedJob.id && job.status === "FAILED")).toBe(true);
  });

  test("incident linkage is exposed through diagnostics", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-incident@example.com",
    });

    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: VpsProviderHealthState.UNREACHABLE,
        providerLastCheckedAt: new Date(),
        providerError: "Provider control unavailable.",
      },
    });

    const diagnostics = await fetchDiagnostics(client, server.id);

    expect(diagnostics.incident).not.toBeNull();
    expect(diagnostics.incident?.severity).toBe("CRITICAL");
    expect(diagnostics.incident?.state).toBe("OPEN");
    expect(diagnostics.alerts.openCount).toBeGreaterThan(0);
    expect(diagnostics.alerts.criticalCount).toBeGreaterThan(0);
    expect(diagnostics.alerts.items.some((event) => event.code === "PROVIDER_UNREACHABLE")).toBe(true);
  });

  test("sla state reflects breached response windows", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-sla@example.com",
    });

    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: VpsProviderHealthState.UNREACHABLE,
        providerLastCheckedAt: new Date(),
        providerError: "SLA validation incident.",
      },
    });

    await fetchDiagnostics(client, server.id);

    const incident = await prisma.vpsIncident.findFirst({
      where: { serverId: server.id },
      orderBy: { openedAt: "desc" },
    });

    expect(incident).not.toBeNull();

    await prisma.vpsIncident.update({
      where: { id: incident!.id },
      data: {
        responseDeadlineAt: new Date(Date.now() - 60 * 1000),
        mitigationDeadlineAt: new Date(Date.now() + 60 * 60 * 1000),
        breachedAt: null,
      },
    });

    const diagnostics = await fetchDiagnostics(client, server.id);

    expect(diagnostics.sla).not.toBeNull();
    expect(diagnostics.sla?.state).toBe("BREACHED");
  });

  test("support diagnostics mirror remains aligned after state changes", async () => {
    const { server, client, user, org } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-alignment@example.com",
    });

    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: VpsProviderHealthState.DEGRADED,
        providerLastCheckedAt: new Date(),
        providerError: "Rate limited by provider.",
        driftDetectedAt: new Date(),
        driftType: "CONFIG_MISMATCH",
      },
    });

    await prisma.vpsActionJob.create({
      data: {
        serverId: server.id,
        orgId: org.id,
        action: "MANUAL_SYNC",
        status: VpsActionStatus.SUCCEEDED,
        requestedByUserId: user.id,
        finishedAt: new Date(),
      },
    });

    const diagnostics = await fetchDiagnostics(client, server.id);
    const support = await fetchSupport(client, server.id);
    const supportDiagnostics = await fetchSupportDiagnostics(client, server.id);

    expect(support.status).toBe(200);
    expect(support.body?.diagnostics).toEqual(diagnostics);
    expect(supportDiagnostics).toEqual(diagnostics);
    expect(diagnostics.alerts.items.length).toBeGreaterThan(0);
  });

  test("alerts route exposes lifecycle updates and suppression removes actionable counts", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-alert-actions@example.com",
    });

    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: VpsProviderHealthState.UNREACHABLE,
        providerLastCheckedAt: new Date(),
        providerError: "Provider API timed out.",
      },
    });

    const alerts = await fetchAlerts(client, server.id);
    const providerAlert = alerts.items.find((item) => item.code === "PROVIDER_UNREACHABLE");

    expect(providerAlert).toBeTruthy();
    expect(providerAlert?.status).toBe("ACTIVE");

    const acknowledgeResponse = await client.patch<AlertQueueEnvelope>(`/api/vps/servers/${server.id}/alerts/${providerAlert?.id}`, {
      json: { action: "acknowledge" },
    });
    expect(acknowledgeResponse.status).toBe(200);
    expect(acknowledgeResponse.body?.items.find((item) => item.id === providerAlert?.id)?.status).toBe("ACKNOWLEDGED");

    const suppressResponse = await client.patch<AlertQueueEnvelope>(`/api/vps/servers/${server.id}/alerts/${providerAlert?.id}`, {
      json: { action: "suppress", suppressMinutes: 60 },
    });
    expect(suppressResponse.status).toBe(200);
    expect(suppressResponse.body?.items.find((item) => item.id === providerAlert?.id)?.status).toBe("SUPPRESSED");

    const diagnostics = await fetchDiagnostics(client, server.id);
    expect(diagnostics.alerts.openCount).toBe(0);
    expect(diagnostics.incident).toBeNull();
  });

  test("alerts route enforces server-scoped support permissions for lifecycle actions", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-alert-rbac@example.com",
      orgRole: OrgRole.MEMBER,
    });

    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: VpsProviderHealthState.UNREACHABLE,
        providerLastCheckedAt: new Date(),
        providerError: "RBAC validation.",
      },
    });

    const alerts = await fetchAlerts(client, server.id);
    const providerAlert = alerts.items.find((item) => item.code === "PROVIDER_UNREACHABLE");
    expect(providerAlert).toBeTruthy();

    const response = await client.patch<Record<string, unknown>>(`/api/vps/servers/${server.id}/alerts/${providerAlert?.id}`, {
      json: { action: "acknowledge" },
    });

    expect(response.status).toBe(403);
  });

  test("support diagnostics export enforces server-scoped RBAC", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-diagnostics-export-rbac@example.com",
      orgRole: OrgRole.MEMBER,
    });

    const response = await client.get<Record<string, unknown>>(`/api/vps/servers/${server.id}/support/diagnostics`);

    expect(response.status).toBe(403);
  });
});
