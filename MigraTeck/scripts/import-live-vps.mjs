import { PrismaClient, ServerPowerState, SupportTier, VpsBillingCycle, VpsStatus } from "@prisma/client";

const prisma = new PrismaClient();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = null) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function intEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return value === "true";
}

function dateEnv(name) {
  const value = process.env[name];
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date env ${name}: ${value}`);
  }
  return parsed;
}

async function main() {
  const orgSlug = optionalEnv("MIGRATECK_VPS_IMPORT_ORG_SLUG");
  const orgId = optionalEnv("MIGRATECK_VPS_IMPORT_ORG_ID");
  const createOrg = boolEnv("MIGRATECK_VPS_IMPORT_CREATE_ORG", false);
  const orgName = optionalEnv("MIGRATECK_VPS_IMPORT_ORG_NAME", "MigraHosting VPS");

  if (!orgSlug && !orgId) {
    throw new Error("Set MIGRATECK_VPS_IMPORT_ORG_SLUG or MIGRATECK_VPS_IMPORT_ORG_ID");
  }

  let org = orgId
    ? await prisma.organization.findUnique({ where: { id: orgId } })
    : await prisma.organization.findUnique({ where: { slug: orgSlug } });

  if (!org && createOrg && orgSlug) {
    org = await prisma.organization.create({
      data: {
        name: orgName,
        slug: orgSlug,
        isMigraHostingClient: true,
      },
    });
  }

  if (!org) {
    throw new Error("Target organization not found. Create it first or set MIGRATECK_VPS_IMPORT_CREATE_ORG=true");
  }

  const server = await prisma.vpsServer.upsert({
    where: {
      providerServerId: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_SERVER_ID", optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_INSTANCE_ID", `${org.slug}-vps-primary`)),
    },
    update: {
      providerSlug: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_SLUG", "manual"),
      providerRegionId: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_REGION_ID"),
      providerPlanId: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_PLAN_ID"),
      name: requiredEnv("MIGRATECK_VPS_IMPORT_NAME"),
      hostname: requiredEnv("MIGRATECK_VPS_IMPORT_HOSTNAME"),
      instanceId: optionalEnv("MIGRATECK_VPS_IMPORT_INSTANCE_ID", requiredEnv("MIGRATECK_VPS_IMPORT_HOSTNAME")),
      status: optionalEnv("MIGRATECK_VPS_IMPORT_STATUS", VpsStatus.RUNNING),
      powerState: optionalEnv("MIGRATECK_VPS_IMPORT_POWER_STATE", ServerPowerState.ON),
      publicIpv4: requiredEnv("MIGRATECK_VPS_IMPORT_PUBLIC_IPV4"),
      privateIpv4: optionalEnv("MIGRATECK_VPS_IMPORT_PRIVATE_IPV4"),
      sshPort: intEnv("MIGRATECK_VPS_IMPORT_SSH_PORT", 22),
      defaultUsername: optionalEnv("MIGRATECK_VPS_IMPORT_USERNAME", "root"),
      region: requiredEnv("MIGRATECK_VPS_IMPORT_REGION"),
      datacenterLabel: optionalEnv("MIGRATECK_VPS_IMPORT_DATACENTER_LABEL"),
      imageSlug: requiredEnv("MIGRATECK_VPS_IMPORT_IMAGE_SLUG"),
      osName: requiredEnv("MIGRATECK_VPS_IMPORT_OS_NAME"),
      imageVersion: optionalEnv("MIGRATECK_VPS_IMPORT_IMAGE_VERSION"),
      planSlug: requiredEnv("MIGRATECK_VPS_IMPORT_PLAN_SLUG"),
      planName: optionalEnv("MIGRATECK_VPS_IMPORT_PLAN_NAME"),
      vcpu: intEnv("MIGRATECK_VPS_IMPORT_VCPU", 1),
      memoryMb: intEnv("MIGRATECK_VPS_IMPORT_MEMORY_MB", 1024),
      diskGb: intEnv("MIGRATECK_VPS_IMPORT_DISK_GB", 25),
      bandwidthTb: intEnv("MIGRATECK_VPS_IMPORT_BANDWIDTH_TB", 1),
      snapshotCountCached: intEnv("MIGRATECK_VPS_IMPORT_SNAPSHOT_COUNT", 0),
      backupsEnabled: boolEnv("MIGRATECK_VPS_IMPORT_BACKUPS_ENABLED", false),
      monitoringEnabled: boolEnv("MIGRATECK_VPS_IMPORT_MONITORING_ENABLED", false),
      monitoringStatus: optionalEnv("MIGRATECK_VPS_IMPORT_MONITORING_STATUS"),
      firewallEnabled: boolEnv("MIGRATECK_VPS_IMPORT_FIREWALL_ENABLED", true),
      firewallProfileName: optionalEnv("MIGRATECK_VPS_IMPORT_FIREWALL_PROFILE"),
      renewalAt: dateEnv("MIGRATECK_VPS_IMPORT_RENEWAL_AT"),
      nextInvoiceAt: dateEnv("MIGRATECK_VPS_IMPORT_NEXT_INVOICE_AT"),
      billingCycle: optionalEnv("MIGRATECK_VPS_IMPORT_BILLING_CYCLE", VpsBillingCycle.MONTHLY),
      monthlyPriceCents: intEnv("MIGRATECK_VPS_IMPORT_MONTHLY_PRICE_CENTS", 0),
      supportTier: optionalEnv("MIGRATECK_VPS_IMPORT_SUPPORT_TIER", SupportTier.STANDARD),
      billingCurrency: optionalEnv("MIGRATECK_VPS_IMPORT_BILLING_CURRENCY", "USD"),
      lastKnownProviderStateJson: {
        source: "script_import",
      },
      lastSyncedAt: new Date(),
    },
    create: {
      orgId: org.id,
      providerSlug: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_SLUG", "manual"),
      providerServerId: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_SERVER_ID", optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_INSTANCE_ID", `${org.slug}-vps-primary`)),
      providerRegionId: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_REGION_ID"),
      providerPlanId: optionalEnv("MIGRATECK_VPS_IMPORT_PROVIDER_PLAN_ID"),
      name: requiredEnv("MIGRATECK_VPS_IMPORT_NAME"),
      hostname: requiredEnv("MIGRATECK_VPS_IMPORT_HOSTNAME"),
      instanceId: optionalEnv("MIGRATECK_VPS_IMPORT_INSTANCE_ID", requiredEnv("MIGRATECK_VPS_IMPORT_HOSTNAME")),
      status: optionalEnv("MIGRATECK_VPS_IMPORT_STATUS", VpsStatus.RUNNING),
      powerState: optionalEnv("MIGRATECK_VPS_IMPORT_POWER_STATE", ServerPowerState.ON),
      publicIpv4: requiredEnv("MIGRATECK_VPS_IMPORT_PUBLIC_IPV4"),
      privateIpv4: optionalEnv("MIGRATECK_VPS_IMPORT_PRIVATE_IPV4"),
      sshPort: intEnv("MIGRATECK_VPS_IMPORT_SSH_PORT", 22),
      defaultUsername: optionalEnv("MIGRATECK_VPS_IMPORT_USERNAME", "root"),
      region: requiredEnv("MIGRATECK_VPS_IMPORT_REGION"),
      datacenterLabel: optionalEnv("MIGRATECK_VPS_IMPORT_DATACENTER_LABEL"),
      imageSlug: requiredEnv("MIGRATECK_VPS_IMPORT_IMAGE_SLUG"),
      osName: requiredEnv("MIGRATECK_VPS_IMPORT_OS_NAME"),
      imageVersion: optionalEnv("MIGRATECK_VPS_IMPORT_IMAGE_VERSION"),
      planSlug: requiredEnv("MIGRATECK_VPS_IMPORT_PLAN_SLUG"),
      planName: optionalEnv("MIGRATECK_VPS_IMPORT_PLAN_NAME"),
      vcpu: intEnv("MIGRATECK_VPS_IMPORT_VCPU", 1),
      memoryMb: intEnv("MIGRATECK_VPS_IMPORT_MEMORY_MB", 1024),
      diskGb: intEnv("MIGRATECK_VPS_IMPORT_DISK_GB", 25),
      bandwidthTb: intEnv("MIGRATECK_VPS_IMPORT_BANDWIDTH_TB", 1),
      snapshotCountCached: intEnv("MIGRATECK_VPS_IMPORT_SNAPSHOT_COUNT", 0),
      backupsEnabled: boolEnv("MIGRATECK_VPS_IMPORT_BACKUPS_ENABLED", false),
      monitoringEnabled: boolEnv("MIGRATECK_VPS_IMPORT_MONITORING_ENABLED", false),
      monitoringStatus: optionalEnv("MIGRATECK_VPS_IMPORT_MONITORING_STATUS"),
      firewallEnabled: boolEnv("MIGRATECK_VPS_IMPORT_FIREWALL_ENABLED", true),
      firewallProfileName: optionalEnv("MIGRATECK_VPS_IMPORT_FIREWALL_PROFILE"),
      renewalAt: dateEnv("MIGRATECK_VPS_IMPORT_RENEWAL_AT"),
      nextInvoiceAt: dateEnv("MIGRATECK_VPS_IMPORT_NEXT_INVOICE_AT"),
      billingCycle: optionalEnv("MIGRATECK_VPS_IMPORT_BILLING_CYCLE", VpsBillingCycle.MONTHLY),
      monthlyPriceCents: intEnv("MIGRATECK_VPS_IMPORT_MONTHLY_PRICE_CENTS", 0),
      supportTier: optionalEnv("MIGRATECK_VPS_IMPORT_SUPPORT_TIER", SupportTier.STANDARD),
      billingCurrency: optionalEnv("MIGRATECK_VPS_IMPORT_BILLING_CURRENCY", "USD"),
      lastKnownProviderStateJson: {
        source: "script_import",
      },
      lastSyncedAt: new Date(),
    },
  });

  if (server.providerServerId) {
    await prisma.vpsProviderBinding.upsert({
      where: {
        providerSlug_providerServerId: {
          providerSlug: server.providerSlug,
          providerServerId: server.providerServerId,
        },
      },
      update: {
        serverId: server.id,
        providerRegionId: server.providerRegionId,
        providerPlanId: server.providerPlanId,
        lastKnownStateJson: {
          source: "script_import",
          publicIpv4: server.publicIpv4,
        },
        lastSyncedAt: new Date(),
      },
      create: {
        serverId: server.id,
        providerSlug: server.providerSlug,
        providerServerId: server.providerServerId,
        providerRegionId: server.providerRegionId,
        providerPlanId: server.providerPlanId,
        lastKnownStateJson: {
          source: "script_import",
          publicIpv4: server.publicIpv4,
        },
        lastSyncedAt: new Date(),
      },
    });
  }

  const firewallProfile = await prisma.vpsFirewallProfile.findFirst({
    where: { serverId: server.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (firewallProfile) {
    await prisma.vpsFirewallProfile.update({
      where: { id: firewallProfile.id },
      data: {
        providerProfileId: server.providerServerId,
        name: server.firewallProfileName || "Default VPS Firewall",
        status: server.firewallEnabled ? "ACTIVE" : "DISABLED",
        protectionMode: server.firewallEnabled ? "provider-managed" : "disabled",
        lastAppliedAt: new Date(),
      },
    });
  } else {
    await prisma.vpsFirewallProfile.create({
      data: {
        serverId: server.id,
        providerProfileId: server.providerServerId,
        name: server.firewallProfileName || "Default VPS Firewall",
        status: server.firewallEnabled ? "ACTIVE" : "DISABLED",
        protectionMode: server.firewallEnabled ? "provider-managed" : "disabled",
        lastAppliedAt: new Date(),
      },
    });
  }

  await prisma.vpsAuditEvent.create({
    data: {
      orgId: org.id,
      serverId: server.id,
      eventType: "SERVER_IMPORTED",
      severity: "INFO",
      payloadJson: {
        source: "script_import",
        publicIpv4: server.publicIpv4,
      },
    },
  });

  console.log(`Imported VPS ${server.name} (${server.publicIpv4}) into org ${org.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
