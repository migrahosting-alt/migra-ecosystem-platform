import { PrismaClient } from "@prisma/client";
import { getVpsDashboardPayload, getVpsFleetWorkspace, listVpsActivity } from "@/lib/vps/data";
import { handleServerAction } from "@/lib/vps/handlers";

const prisma = new PrismaClient();

async function responseJson(response: Response) {
  return response.json().catch(() => null);
}

async function main() {
  const userEmail = process.env.VPS_CONTROL_LOOP_USER_EMAIL || "myspeeteck@gmail.com";
  const orgSlug = process.env.VPS_CONTROL_LOOP_ORG_SLUG || "fitdripgear";
  const providerServerId = process.env.VPS_CONTROL_LOOP_PROVIDER_SERVER_ID || "srv_123";

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: userEmail },
    select: { id: true, email: true },
  });

  const membership = await prisma.membership.findFirstOrThrow({
    where: {
      userId: user.id,
      status: "ACTIVE",
      org: { slug: orgSlug },
    },
    include: { org: true },
  });

  const server = await prisma.vpsServer.findFirstOrThrow({
    where: {
      orgId: membership.orgId,
      providerSlug: "mh",
      providerServerId,
    },
    select: {
      id: true,
      name: true,
      status: true,
      powerState: true,
      rescueEnabled: true,
      lastSyncedAt: true,
    },
  });

  const actor = {
    userId: user.id,
    orgId: membership.orgId,
    role: membership.role,
    membership,
  };

  const fleetBefore = await getVpsFleetWorkspace(membership);
  const overviewBefore = await getVpsDashboardPayload(server.id, membership);

  const syncResponse = await handleServerAction({
    actor,
    serverId: server.id,
    actionType: "MANUAL_SYNC",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "MANUAL_SYNC_REQUESTED",
  });

  const rebootResponse = await handleServerAction({
    actor,
    serverId: server.id,
    actionType: "REBOOT",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "REBOOT_REQUESTED",
  });

  const rescueResponse = await handleServerAction({
    actor,
    serverId: server.id,
    actionType: "ENABLE_RESCUE",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "RESCUE_ENABLE_REQUESTED",
  });

  const fleetAfter = await getVpsFleetWorkspace(membership);
  const overviewAfter = await getVpsDashboardPayload(server.id, membership);
  const activity = await listVpsActivity(server.id, membership.orgId, 20);
  const liveServer = await prisma.vpsServer.findUniqueOrThrow({
    where: { id: server.id },
    select: {
      id: true,
      name: true,
      status: true,
      powerState: true,
      rescueEnabled: true,
      publicIpv4: true,
      lastSyncedAt: true,
      lastKnownProviderStateJson: true,
    },
  });

  console.log(JSON.stringify({
    user,
    org: {
      id: membership.orgId,
      slug: membership.org.slug,
      role: membership.role,
    },
    fleetBefore: {
      total: fleetBefore.summary.total,
      providerState: fleetBefore.providers.find((provider) => provider.slug === "mh"),
    },
    overviewBefore: overviewBefore ? {
      serverId: overviewBefore.server.id,
      status: overviewBefore.server.status,
      powerState: overviewBefore.server.powerState,
      publicIpv4: overviewBefore.server.publicIpv4,
      lastSyncedAt: overviewBefore.sync.lastSyncedAt || null,
    } : null,
    syncResponse: await responseJson(syncResponse),
    rebootResponse: await responseJson(rebootResponse),
    rescueResponse: await responseJson(rescueResponse),
    fleetAfter: {
      total: fleetAfter.summary.total,
      servers: fleetAfter.servers.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        powerState: item.powerState,
        publicIpv4: item.publicIpv4,
        lastSyncedAt: item.lastSyncedAt || null,
      })),
      providerState: fleetAfter.providers.find((provider) => provider.slug === "mh"),
    },
    overviewAfter: overviewAfter ? {
      status: overviewAfter.server.status,
      powerState: overviewAfter.server.powerState,
      rescueEnabled: overviewAfter.server.rescueEnabled,
      lastSyncedAt: overviewAfter.sync.lastSyncedAt || null,
      pendingActionCount: overviewAfter.sync.pendingActionCount,
      activity: overviewAfter.activity.slice(0, 8).map((item) => ({
        type: item.type,
        status: item.status,
      })),
    } : null,
    liveServer,
    activity: activity ? {
      eventTypes: activity.events.slice(0, 12).map((event) => event.eventType),
      jobs: activity.jobs.slice(0, 12).map((job) => ({ action: job.action, status: job.status })),
    } : null,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });