import { ServerPowerState, SupportTier, VpsBillingCycle, VpsStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function env(name: string, fallback?: string) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function required(name: string, fallback?: string) {
  const value = env(name, fallback);
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number) {
  const value = env(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean) {
  const value = env(name);
  if (!value) {
    return fallback;
  }

  return value === "true";
}

async function main() {
  const orgSlug = required("VPS_IMPORT_ORG_SLUG", "fitdripgear");
  const providerServerId = required("VPS_IMPORT_PROVIDER_SERVER_ID", "srv_123");
  const hostname = required("VPS_IMPORT_HOSTNAME", "vps01.migrateck.local");
  const serverName = required("VPS_IMPORT_NAME", "migra-vps-01");
  const publicIpv4 = required("VPS_IMPORT_PUBLIC_IPV4", "203.0.113.10");
  const region = required("VPS_IMPORT_REGION", "us-east");
  const imageSlug = required("VPS_IMPORT_IMAGE_SLUG", "ubuntu-24.04");
  const osName = required("VPS_IMPORT_OS_NAME", "Ubuntu 24.04");
  const planSlug = required("VPS_IMPORT_PLAN_SLUG", "vps-4x8");
  const planName = env("VPS_IMPORT_PLAN_NAME", "VPS 4x8");

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, slug: true, isMigraHostingClient: true },
  });

  if (!org) {
    throw new Error(`Organization not found for slug ${orgSlug}`);
  }

  if (!org.isMigraHostingClient) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { isMigraHostingClient: true },
    });
  }

  const server = await prisma.vpsServer.upsert({
    where: { providerServerId },
    update: {
      orgId: org.id,
      providerSlug: "mh",
      providerServerId,
      name: serverName,
      hostname,
      instanceId: env("VPS_IMPORT_INSTANCE_ID", hostname),
      status: VpsStatus.RUNNING,
      powerState: ServerPowerState.ON,
      publicIpv4,
      sshPort: intEnv("VPS_IMPORT_SSH_PORT", 22),
      defaultUsername: env("VPS_IMPORT_DEFAULT_USERNAME", "root"),
      region,
      imageSlug,
      osName,
      planSlug,
      planName,
      vcpu: intEnv("VPS_IMPORT_VCPU", 4),
      memoryMb: intEnv("VPS_IMPORT_MEMORY_MB", 8192),
      diskGb: intEnv("VPS_IMPORT_DISK_GB", 160),
      bandwidthTb: intEnv("VPS_IMPORT_BANDWIDTH_TB", 5),
      monthlyPriceCents: intEnv("VPS_IMPORT_MONTHLY_PRICE_CENTS", 2400),
      billingCycle: VpsBillingCycle.MONTHLY,
      billingCurrency: env("VPS_IMPORT_BILLING_CURRENCY", "USD"),
      firewallEnabled: boolEnv("VPS_IMPORT_FIREWALL_ENABLED", true),
      backupsEnabled: boolEnv("VPS_IMPORT_BACKUPS_ENABLED", true),
      monitoringEnabled: boolEnv("VPS_IMPORT_MONITORING_ENABLED", true),
      monitoringStatus: env("VPS_IMPORT_MONITORING_STATUS", "HEALTHY"),
      supportTier: SupportTier.STANDARD,
      rescueEnabled: false,
      lastKnownProviderStateJson: {
        source: "import_vps_script",
        mode: "stub",
      },
    },
    create: {
      orgId: org.id,
      providerSlug: "mh",
      providerServerId,
      name: serverName,
      hostname,
      instanceId: env("VPS_IMPORT_INSTANCE_ID", hostname),
      status: VpsStatus.RUNNING,
      powerState: ServerPowerState.ON,
      publicIpv4,
      sshPort: intEnv("VPS_IMPORT_SSH_PORT", 22),
      defaultUsername: env("VPS_IMPORT_DEFAULT_USERNAME", "root"),
      region,
      imageSlug,
      osName,
      planSlug,
      planName,
      vcpu: intEnv("VPS_IMPORT_VCPU", 4),
      memoryMb: intEnv("VPS_IMPORT_MEMORY_MB", 8192),
      diskGb: intEnv("VPS_IMPORT_DISK_GB", 160),
      bandwidthTb: intEnv("VPS_IMPORT_BANDWIDTH_TB", 5),
      monthlyPriceCents: intEnv("VPS_IMPORT_MONTHLY_PRICE_CENTS", 2400),
      billingCycle: VpsBillingCycle.MONTHLY,
      billingCurrency: env("VPS_IMPORT_BILLING_CURRENCY", "USD"),
      firewallEnabled: boolEnv("VPS_IMPORT_FIREWALL_ENABLED", true),
      backupsEnabled: boolEnv("VPS_IMPORT_BACKUPS_ENABLED", true),
      monitoringEnabled: boolEnv("VPS_IMPORT_MONITORING_ENABLED", true),
      monitoringStatus: env("VPS_IMPORT_MONITORING_STATUS", "HEALTHY"),
      supportTier: SupportTier.STANDARD,
      rescueEnabled: false,
      lastKnownProviderStateJson: {
        source: "import_vps_script",
        mode: "stub",
      },
    },
  });

  await prisma.vpsProviderBinding.upsert({
    where: {
      providerSlug_providerServerId: {
        providerSlug: "mh",
        providerServerId,
      },
    },
    update: {
      serverId: server.id,
      metadataJson: {
        mode: "stub",
        source: "control_loop",
      },
      lastKnownStateJson: {
        source: "import_vps_script",
        providerServerId,
      },
      lastSyncedAt: new Date(),
    },
    create: {
      serverId: server.id,
      providerSlug: "mh",
      providerServerId,
      metadataJson: {
        mode: "stub",
        source: "control_loop",
      },
      lastKnownStateJson: {
        source: "import_vps_script",
        providerServerId,
      },
      lastSyncedAt: new Date(),
    },
  });

  await prisma.vpsBackupPolicy.upsert({
    where: { id: `${server.id}_backup_policy` },
    update: {
      serverId: server.id,
      status: "ACTIVE",
      frequency: "daily",
      retentionCount: 7,
      encrypted: true,
      crossRegion: false,
      lastSuccessAt: new Date(),
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    create: {
      id: `${server.id}_backup_policy`,
      serverId: server.id,
      status: "ACTIVE",
      frequency: "daily",
      retentionCount: 7,
      encrypted: true,
      crossRegion: false,
      lastSuccessAt: new Date(),
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await prisma.vpsMetricRollup.create({
    data: {
      serverId: server.id,
      cpuPercent: 26,
      memoryPercent: 41,
      diskPercent: 37,
      networkInMbps: 12,
      networkOutMbps: 6,
      uptimeSeconds: BigInt(86400),
    },
  });

  await prisma.vpsFirewallProfile.upsert({
    where: { id: `${server.id}_firewall_profile` },
    update: {
      serverId: server.id,
      providerProfileId: providerServerId,
      name: env("VPS_IMPORT_FIREWALL_PROFILE", "Default VPS Firewall"),
      status: "ACTIVE",
      protectionMode: "provider-managed",
      isActive: true,
      lastAppliedAt: new Date(),
    },
    create: {
      id: `${server.id}_firewall_profile`,
      serverId: server.id,
      providerProfileId: providerServerId,
      name: env("VPS_IMPORT_FIREWALL_PROFILE", "Default VPS Firewall"),
      status: "ACTIVE",
      protectionMode: "provider-managed",
      isActive: true,
      lastAppliedAt: new Date(),
    },
  });

  await prisma.vpsAuditEvent.create({
    data: {
      orgId: org.id,
      serverId: server.id,
      eventType: "SERVER_IMPORTED",
      severity: "INFO",
      payloadJson: {
        source: "control_loop",
        providerSlug: "mh",
        providerServerId,
      },
    },
  });

  console.log(`Imported VPS: ${server.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });