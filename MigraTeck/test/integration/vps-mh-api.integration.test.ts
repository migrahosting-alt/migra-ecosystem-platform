import { ServerPowerState, VpsBillingCycle, VpsStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

async function createMhServerFixture() {
  const owner = await createUser({
    email: "mh-api-owner@example.com",
    password: "MhApiOwnerPass123!",
    emailVerified: true,
  });

  const org = await createOrganization({
    name: "MH API Org",
    slug: "mh-api-org",
    createdById: owner.id,
    isMigraHostingClient: true,
  });

  const server = await prisma.vpsServer.create({
    data: {
      orgId: org.id,
      providerSlug: "mh",
      providerServerId: "srv-mh-001",
      providerRegionId: "iad-1",
      providerPlanId: "mh-vps-4",
      name: "mh-node-01",
      hostname: "mh-node-01.migrahosting.test",
      instanceId: "mh-node-01",
      status: VpsStatus.RUNNING,
      powerState: ServerPowerState.ON,
      publicIpv4: "203.0.113.77",
      sshPort: 22,
      defaultUsername: "root",
      region: "us-east",
      datacenterLabel: "IAD-1",
      imageSlug: "ubuntu-24-04",
      osName: "Ubuntu 24.04 LTS",
      planSlug: "vps-4",
      planName: "VPS 4",
      vcpu: 4,
      memoryMb: 8192,
      diskGb: 160,
      bandwidthTb: 8,
      billingCycle: VpsBillingCycle.MONTHLY,
      monthlyPriceCents: 4200,
      billingCurrency: "USD",
      rescueEnabled: false,
      snapshotCountCached: 0,
    },
  });

  await prisma.vpsProviderBinding.create({
    data: {
      serverId: server.id,
      providerSlug: "mh",
      providerServerId: server.providerServerId!,
      metadataJson: { mode: "stub", source: "test_fixture" },
    },
  });

  return server;
}

describe("MH provider API integration", () => {
  const originalMhApiToken = process.env.MH_API_TOKEN;

  beforeEach(async () => {
    await resetDatabase();
    process.env.MH_API_TOKEN = "test-mh-provider-token";
  });

  afterEach(() => {
    if (originalMhApiToken === undefined) {
      delete process.env.MH_API_TOKEN;
      return;
    }

    process.env.MH_API_TOKEN = originalMhApiToken;
  });

  test("requires bearer auth for MH server inventory", async () => {
    const { GET } = await import("../../src/app/v1/servers/route");

    const response = await GET(new Request("http://127.0.0.1:3109/v1/servers"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  test("lists servers and powers off through the MH contract", async () => {
    const server = await createMhServerFixture();
    const { GET: listServers } = await import("../../src/app/v1/servers/route");
    const { GET: getServer } = await import("../../src/app/v1/servers/[serverId]/route");
    const { POST: powerOff } = await import("../../src/app/v1/servers/[serverId]/power/off/route");

    const authHeaders = { authorization: `Bearer ${process.env.MH_API_TOKEN}` };

    const listResponse = await listServers(new Request("http://127.0.0.1:3109/v1/servers", { headers: authHeaders }));
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      servers: [
        expect.objectContaining({
          providerServerId: "srv-mh-001",
          name: "mh-node-01",
          powerState: ServerPowerState.ON,
        }),
      ],
    });

    const powerResponse = await powerOff(
      new Request("http://127.0.0.1:3109/v1/servers/srv-mh-001/power/off", {
        method: "POST",
        headers: authHeaders,
      }),
      { params: Promise.resolve({ serverId: "srv-mh-001" }) },
    );

    expect(powerResponse.status).toBe(200);
    await expect(powerResponse.json()).resolves.toMatchObject({
      accepted: true,
      status: "SUCCEEDED",
      message: "power_off_completed",
      serverPatch: expect.objectContaining({
        providerServerId: "srv-mh-001",
        powerState: ServerPowerState.OFF,
        status: VpsStatus.STOPPED,
      }),
    });

    const serverResponse = await getServer(
      new Request(`http://127.0.0.1:3109/v1/servers/${server.providerServerId}`, { headers: authHeaders }),
      { params: Promise.resolve({ serverId: server.providerServerId || server.id }) },
    );

    expect(serverResponse.status).toBe(200);
    await expect(serverResponse.json()).resolves.toMatchObject({
      providerServerId: "srv-mh-001",
      powerState: ServerPowerState.OFF,
      status: VpsStatus.STOPPED,
    });

    const refreshedServer = await prisma.vpsServer.findUniqueOrThrow({ where: { id: server.id } });
    expect(refreshedServer.powerState).toBe(ServerPowerState.OFF);
    expect(refreshedServer.status).toBe(VpsStatus.STOPPED);
    expect(refreshedServer.lastKnownProviderStateJson).toBeTruthy();

    const binding = await prisma.vpsProviderBinding.findFirstOrThrow({
      where: { serverId: server.id, providerSlug: "mh" },
    });
    expect(binding.metadataJson).toMatchObject({ mode: "live_api", source: "mh_api" });

    const auditEvent = await prisma.vpsAuditEvent.findFirst({
      where: { serverId: server.id, eventType: "MH_API_POWER_OFF" },
    });
    expect(auditEvent).toBeTruthy();
  });

  test("reports MH provider health through the contract", async () => {
    await createMhServerFixture();
    const { GET } = await import("../../src/app/v1/health/route");

    const response = await GET(new Request("http://127.0.0.1:3109/v1/health", {
      headers: { authorization: `Bearer ${process.env.MH_API_TOKEN}` },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      provider: "mh",
      serverCount: 1,
    });
  });
});