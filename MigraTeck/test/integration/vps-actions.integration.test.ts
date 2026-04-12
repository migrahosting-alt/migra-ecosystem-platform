import {
  OrgRole,
  ServerPowerState,
  VpsActionStatus,
  VpsBillingCycle,
  VpsProviderHealthState,
  VpsServerMemberRole,
  VpsStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { executeActionJob } from "@/lib/vps/jobs";
import { createSessionForUser } from "../helpers/auth";
import { createMembership, createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

type VpsServerFixtureOverrides = {
  name?: string;
  hostname?: string;
  status?: VpsStatus;
  powerState?: ServerPowerState;
  publicIpv4?: string;
  region?: string;
  imageSlug?: string;
  osName?: string;
  planSlug?: string;
  vcpu?: number;
  memoryMb?: number;
  diskGb?: number;
  bandwidthTb?: number;
  providerHealthState?: VpsProviderHealthState;
};

type QueuedActionResponse = {
  jobId?: string;
  status?: string;
  message?: string;
  result?: {
    status?: string;
    message?: string;
  };
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
  email?: string;
  orgRole?: OrgRole;
  serverRole?: VpsServerMemberRole;
  serverOverrides?: VpsServerFixtureOverrides;
}) {
  const user = await createUser({
    email: input?.email || "vps-routes@example.com",
    password: "RoutesPass123!",
    emailVerified: true,
  });

  const org = await createOrganization({
    name: "VPS Routes Org",
    slug: `vps-routes-org-${user.id.slice(0, 8)}`,
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

async function expectQueuedActionSuccess(response: { status: number; body: QueuedActionResponse | null }) {
  expect(response.status).toBe(200);
  expect(response.body?.jobId).toBeTruthy();
  expect(response.body?.status).toBe(VpsActionStatus.QUEUED);
  expect(response.body?.result?.status).toBe(VpsActionStatus.QUEUED);

  const jobId = response.body?.jobId;
  if (!jobId) {
    throw new Error("Expected a queued job id.");
  }

  const job = await executeActionJob(jobId);
  expect(job.status).toBe(VpsActionStatus.SUCCEEDED);

  return jobId;
}

describe("VPS action routes integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("queue-first shared routes enqueue jobs and legacy routes still execute successfully", async () => {
    const { server, client } = await createAuthenticatedServerContext();

    const powerOn = await client.post<QueuedActionResponse>(
      `/api/vps/servers/${server.id}/power/on`,
      { json: {} },
    );
    await expectQueuedActionSuccess(powerOn);

    const consoleSession = await client.post<{ session?: { launchUrl?: string; supported?: boolean } }>(
      `/api/vps/servers/${server.id}/console/session`,
      { json: {} },
    );
    expect(consoleSession.status).toBe(200);
    expect(consoleSession.body?.session?.supported).toBe(true);
    expect(consoleSession.body?.session?.launchUrl).toBe("https://console.integration.migrateck.com/session");

    const createSnapshot = await client.post<QueuedActionResponse>(
      `/api/vps/servers/${server.id}/snapshots`,
      { json: { name: "nightly-001" } },
    );
    await expectQueuedActionSuccess(createSnapshot);

    const restoreSnapshot = await client.post<QueuedActionResponse>(
      `/api/vps/servers/${server.id}/snapshots/snap-001/restore`,
      { json: {} },
    );
    await expectQueuedActionSuccess(restoreSnapshot);

    const deleteSnapshot = await client.delete<QueuedActionResponse>(
      `/api/vps/servers/${server.id}/snapshots/snap-001`,
    );
    await expectQueuedActionSuccess(deleteSnapshot);

    const updateBackups = await client.put<QueuedActionResponse>(
      `/api/vps/servers/${server.id}/backups`,
      {
        json: {
          enabled: true,
          frequency: "daily",
          retentionCount: 14,
          encrypted: true,
          crossRegion: false,
        },
      },
    );
    await expectQueuedActionSuccess(updateBackups);

    const rebuild = await client.post<{ job?: { status?: string }; result?: { accepted?: boolean; status?: string } }>(
      `/api/vps/servers/${server.id}/rebuild`,
      {
        json: {
          confirmText: server.name,
          imageSlug: "debian-13",
          reason: "Client requested Debian 13 before first production login.",
        },
      },
    );
    expect(rebuild.status).toBe(200);
    expect(rebuild.body?.job?.status).toBe(VpsActionStatus.SUCCEEDED);
    expect(rebuild.body?.result?.accepted).toBe(true);

    const updatedServer = await prisma.vpsServer.findUnique({
      where: { id: server.id },
      select: { imageSlug: true, osName: true, imageVersion: true },
    });

    expect(updatedServer?.imageSlug).toBe("debian-13");
    expect(updatedServer?.osName).toBe("Debian 13");
    expect(updatedServer?.imageVersion).toBe("13");
  });

  test("provider unreachable blocks queued actions and writes an access denied audit", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-provider-down@example.com",
      serverOverrides: {
        providerHealthState: VpsProviderHealthState.UNREACHABLE,
      },
    });

    const powerOff = await client.post<{ error?: string }>(`/api/vps/servers/${server.id}/power/off`, { json: {} });

    expect(powerOff.status).toBe(403);
    expect(powerOff.body?.error).toBe("Provider unavailable.");

    const [jobCount, audit] = await Promise.all([
      prisma.vpsActionJob.count({ where: { serverId: server.id, action: "POWER_OFF" } }),
      prisma.vpsAuditEvent.findFirst({
        where: { serverId: server.id, eventType: "ACCESS_DENIED" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    expect(jobCount).toBe(0);
    expect(audit).toBeTruthy();
    expect(asRecord(audit?.payloadJson)?.reason).toBe("Provider unavailable.");
    expect(asRecord(audit?.payloadJson)?.action).toBe("POWER_OFF");
  });

  test("manual sync persists drift state and emits drift audit events", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-drift@example.com",
      serverOverrides: {
        hostname: "drifted-node.example.internal",
        powerState: ServerPowerState.OFF,
        planSlug: "vps-drift",
      },
    });

    const sync = await client.post<QueuedActionResponse>(`/api/vps/servers/${server.id}/sync`, { json: {} });
    const jobId = await expectQueuedActionSuccess(sync);

    const [updatedServer, driftAudit, syncJob] = await Promise.all([
      prisma.vpsServer.findUnique({
        where: { id: server.id },
        select: {
          hostname: true,
          powerState: true,
          planSlug: true,
          providerHealthState: true,
          driftDetectedAt: true,
          driftType: true,
        },
      }),
      prisma.vpsAuditEvent.findFirst({
        where: { serverId: server.id, eventType: "DRIFT_DETECTED" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.vpsActionJob.findUnique({ where: { id: jobId }, select: { status: true } }),
    ]);

    expect(syncJob?.status).toBe(VpsActionStatus.SUCCEEDED);
    expect(updatedServer?.providerHealthState).toBe(VpsProviderHealthState.HEALTHY);
    expect(updatedServer?.driftDetectedAt).toBeTruthy();
    expect(updatedServer?.driftType).toContain("POWER_STATE_MISMATCH");
    expect(updatedServer?.driftType).toContain("CONFIG_MISMATCH");
    expect(updatedServer?.hostname).toBe("alpha-node.example.internal");
    expect(updatedServer?.powerState).toBe(ServerPowerState.ON);
    expect(updatedServer?.planSlug).toBe("vps-2");
    expect(asRecord(driftAudit?.payloadJson)?.driftType).toBe(updatedServer?.driftType);
  });

  test("server-scoped operator role cannot rebuild and denial is audited", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-rbac-deny@example.com",
      orgRole: OrgRole.OWNER,
      serverRole: VpsServerMemberRole.OPERATOR,
    });

    const rebuild = await client.post<{ error?: string }>(`/api/vps/servers/${server.id}/rebuild`, {
      json: {
        confirmText: server.name,
        imageSlug: "debian-13",
        reason: "Attempted without server-level rebuild privilege.",
      },
    });

    expect(rebuild.status).toBe(403);
    expect(rebuild.body?.error).toMatch(/forbidden/i);

    const [rebuildJobCount, audit] = await Promise.all([
      prisma.vpsActionJob.count({ where: { serverId: server.id, action: "REBUILD" } }),
      prisma.vpsAuditEvent.findFirst({
        where: { serverId: server.id, eventType: "ACCESS_DENIED" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    expect(rebuildJobCount).toBe(0);
    expect(audit).toBeTruthy();
    expect(asRecord(audit?.payloadJson)?.action).toBe("REBUILD");
    expect(asRecord(audit?.payloadJson)?.requiredRole).toBe("OWNER|ADMIN");
    expect(asRecord(audit?.payloadJson)?.actualRole).toBe(VpsServerMemberRole.OPERATOR);
  });

  test("rebuild rejects unsupported operating system images", async () => {
    const { server, client } = await createAuthenticatedServerContext({
      email: "vps-invalid-image@example.com",
    });

    const rebuild = await client.post<{ error?: string }>(
      `/api/vps/servers/${server.id}/rebuild`,
      {
        json: {
          confirmText: server.name,
          imageSlug: "totally-unsupported-os",
        },
      },
    );

    expect(rebuild.status).toBe(400);
    expect(rebuild.body?.error).toMatch(/not supported/i);
  });
});