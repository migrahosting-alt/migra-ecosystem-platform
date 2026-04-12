import fs from "node:fs/promises";
import path from "node:path";
import argon2 from "argon2";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient, EntitlementStatus, OrgRole, ProductKey, ServerPowerState, VpsBillingCycle, VpsStatus } from "@prisma/client";
import { createTestDatabaseContext, dropTestDatabase, isPostgresUrl, prepareTestDatabase } from "../setup/db";
import { startAppServer, type AppServerHandle } from "../setup/app";

const TEST_EMAIL = "owner+migramarket-e2e@migrateck.com";
const TEST_PASSWORD = "ChangeMeImmediately123!";
const TEST_PORT = Number(process.env.PLAYWRIGHT_APP_PORT || 3209);
const starterDrivePlan = {
  planCode: "starter",
  storageQuotaGb: 100,
};
const vpsServerId = "cm_vps_playwright_alpha";
const vpsManualServerJson = JSON.stringify([
  {
    providerSlug: "manual",
    providerServerId: "manual-vps-playwright-alpha",
    instanceId: "playwright-alpha-instance",
    name: "alpha-node",
    hostname: "alpha-node.example.internal",
    status: "RUNNING",
    powerState: "ON",
    publicIpv4: "203.0.113.10",
    privateIpv4: "10.10.10.20",
    gatewayIpv4: "10.10.10.1",
    privateNetwork: "internal-a",
    sshPort: 22,
    defaultUsername: "root",
    region: "us-east",
    datacenterLabel: "US East A",
    imageSlug: "ubuntu-24-04",
    osName: "Ubuntu 24.04 LTS",
    imageVersion: "24.04",
    planSlug: "vps-2",
    planName: "VPS 2",
    vcpu: 4,
    memoryMb: 8192,
    diskGb: 160,
    bandwidthTb: 4,
    bandwidthUsedGb: 128,
    billingCycle: "MONTHLY",
    monthlyPriceCents: 699,
    billingCurrency: "USD",
    firewallEnabled: true,
    firewallProfileName: "Primary Edge Policy",
    monitoringEnabled: true,
    monitoringStatus: "HEALTHY",
    backupsEnabled: true,
    backupRegion: "us-east-2",
    supportTier: "STANDARD",
    supportTicketUrl: "https://support.integration.migrateck.com/tickets/vps-alpha",
    supportDocsUrl: "https://docs.integration.migrateck.com/vps-alpha",
    renewalAt: "2026-05-01T00:00:00.000Z",
    nextInvoiceAt: "2026-05-01T00:00:00.000Z",
    rescueEnabled: false,
    consoleUrl: "https://console.integration.migrateck.com/session",
  },
]);

async function seedMockStoredObject(fileKey: string, body: Buffer, contentType: string) {
  const root = path.join(process.cwd(), "tmp", "migradrive-mock-storage");
  const safeSegments = fileKey
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/\.\./g, "_").replace(/[\\/]/g, "_"));
  const filePath = path.join(root, ...safeSegments);
  const metadataPath = `${filePath}.meta.json`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
  await fs.writeFile(metadataPath, JSON.stringify({ contentType }), "utf8");
}

export default async function globalSetup() {
  let container: StartedPostgreSqlContainer | undefined;
  let baseDatabaseUrl = process.env.DATABASE_URL_TEST;

  if (!baseDatabaseUrl) {
    try {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("migrateck_e2e")
        .withUsername("postgres")
        .withPassword("postgres")
        .start();

      baseDatabaseUrl = container.getConnectionUri();
    } catch (error) {
      throw new Error(
        "Playwright e2e setup requires either a working container runtime for Testcontainers or DATABASE_URL_TEST set to a disposable Postgres database.",
        { cause: error as Error },
      );
    }
  }

  if (!baseDatabaseUrl || !isPostgresUrl(baseDatabaseUrl)) {
    throw new Error("DATABASE_URL_TEST must be a postgres connection string.");
  }

  const db = createTestDatabaseContext(baseDatabaseUrl);
  prepareTestDatabase(db);

  const app: AppServerHandle = await startAppServer({
    port: TEST_PORT,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: db.testUrl,
      NEXTAUTH_SECRET: "playwright-tests-nextauth-secret-32-plus",
      NEXTAUTH_URL: `http://127.0.0.1:${TEST_PORT}`,
      LAUNCH_TOKEN_SECRET: "playwright-tests-launch-secret-32-plus",
      ENFORCE_EMAIL_VERIFIED_LOGIN: "true",
      SECURITY_ENFORCE_ORIGIN_CHECKS: "true",
      DOWNLOAD_STORAGE_PROVIDER: "mock",
      DOWNLOAD_URL_TTL_SECONDS: "300",
      STRIPE_BILLING_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_playwright_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_test_playwright_secret",
      STRIPE_WEBHOOK_TOLERANCE_SECONDS: "300",
      PROVISIONING_ENGINE_DRY_RUN: "true",
      JOB_ENVELOPE_SIGNING_SECRET: "playwright-tests-job-envelope-secret-32-plus",
      STEP_UP_TIER2: "NONE",
      STEP_UP_TOTP_ENCRYPTION_KEY: "playwright-tests-totp-encryption-secret-32-plus",
      MIGRAMARKET_LAUNCH_URL: "https://migramarket.integration.migrateck.com/launch",
      MIGRAHOSTING_VPS_SIMULATE_ACTIONS: "true",
      MIGRAHOSTING_VPS_MANUAL_CONSOLE_URL: "https://console.integration.migrateck.com/session",
      MIGRAHOSTING_VPS_MANUAL_SERVERS_JSON: vpsManualServerJson,
    },
  });

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: db.testUrl,
      },
    },
    log: ["error"],
  });

  const passwordHash = await argon2.hash(TEST_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      name: "MigraMarket Playwright Owner",
      passwordHash,
      emailVerified: new Date(),
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: "MigraMarket Playwright Org",
      slug: "migramarket-playwright-org",
      createdById: user.id,
    },
  });

  await prisma.membership.create({
    data: {
      userId: user.id,
      orgId: org.id,
      role: OrgRole.OWNER,
      status: "ACTIVE",
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      defaultOrgId: org.id,
    },
  });

  await prisma.orgEntitlement.create({
    data: {
      orgId: org.id,
      product: ProductKey.MIGRAMARKET,
      status: EntitlementStatus.ACTIVE,
    },
  });

  const driveEntitlement = await prisma.orgEntitlement.create({
    data: {
      orgId: org.id,
      product: ProductKey.MIGRADRIVE,
      status: EntitlementStatus.ACTIVE,
    },
  });

  await prisma.orgEntitlement.create({
    data: {
      orgId: org.id,
      product: ProductKey.MIGRAHOSTING,
      status: EntitlementStatus.ACTIVE,
    },
  });

  const driveTenant = await prisma.driveTenant.create({
    data: {
      orgId: org.id,
      orgSlug: org.slug,
      ...starterDrivePlan,
      storageUsedBytes: 24n,
      status: "ACTIVE",
      activatedAt: new Date(),
      entitlementId: driveEntitlement.id,
    },
  });

  await prisma.driveFile.createMany({
    data: [
      {
        tenantId: driveTenant.id,
        orgId: org.id,
        objectKey: `tenants/${org.id}/seed/seed-active-readme.txt`,
        fileName: "seed-active-readme.txt",
        mimeType: "text/plain",
        sizeBytes: 24n,
        status: "ACTIVE",
        uploadedAt: new Date(),
      },
      {
        tenantId: driveTenant.id,
        orgId: org.id,
        objectKey: `tenants/${org.id}/pending/seed-pending-upload.txt`,
        fileName: "seed-pending-upload.txt",
        mimeType: "text/plain",
        sizeBytes: 18n,
        status: "PENDING_UPLOAD",
      },
    ],
  });

  await seedMockStoredObject(
    `tenants/${org.id}/seed/seed-active-readme.txt`,
    Buffer.from("seed active drive object\n", "utf8"),
    "text/plain",
  );

  await prisma.platformConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      allowPublicSignup: true,
      allowOrgCreate: true,
    },
  });

  const vpsServer = await prisma.vpsServer.create({
    data: {
      id: vpsServerId,
      orgId: org.id,
      providerSlug: "manual",
      providerServerId: "manual-vps-playwright-alpha",
      providerRegionId: "us-east-1",
      providerPlanId: "vps-2",
      name: "alpha-node",
      hostname: "alpha-node.example.internal",
      instanceId: "playwright-alpha-instance",
      status: VpsStatus.RUNNING,
      powerState: ServerPowerState.ON,
      publicIpv4: "203.0.113.10",
      privateIpv4: "10.10.10.20",
      gatewayIpv4: "10.10.10.1",
      privateNetwork: "internal-a",
      sshPort: 22,
      defaultUsername: "root",
      region: "us-east",
      datacenterLabel: "US East A",
      imageSlug: "ubuntu-24-04",
      osName: "Ubuntu 24.04 LTS",
      imageVersion: "24.04",
      virtualizationType: "kvm",
      planSlug: "vps-2",
      planName: "VPS 2",
      vcpu: 4,
      memoryMb: 8192,
      diskGb: 160,
      bandwidthTb: 4,
      bandwidthUsedGb: 128,
      reverseDns: "alpha-node.migrahosting.test",
      reverseDnsStatus: "ACTIVE",
      firewallEnabled: true,
      firewallProfileName: "Primary Edge Policy",
      monitoringEnabled: true,
      monitoringStatus: "HEALTHY",
      backupsEnabled: true,
      backupRegion: "us-east-2",
      snapshotCountCached: 1,
      nextInvoiceAt: new Date("2026-05-01T00:00:00.000Z"),
      renewalAt: new Date("2026-05-01T00:00:00.000Z"),
      billingCycle: VpsBillingCycle.MONTHLY,
      monthlyPriceCents: 699,
      billingCurrency: "USD",
      supportTier: "STANDARD",
      supportTicketUrl: "https://support.integration.migrateck.com/tickets/vps-alpha",
      supportDocsUrl: "https://docs.integration.migrateck.com/vps-alpha",
      rescueEnabled: false,
      lastSyncedAt: new Date(),
    },
  });

  await prisma.vpsProviderBinding.create({
    data: {
      serverId: vpsServer.id,
      providerSlug: "manual",
      providerServerId: "manual-vps-playwright-alpha",
      providerRegionId: "us-east-1",
      providerPlanId: "vps-2",
      lastSyncedAt: new Date(),
    },
  });

  await prisma.vpsSnapshot.create({
    data: {
      serverId: vpsServer.id,
      name: "pre-launch-baseline",
      status: "READY",
      sizeGb: 24,
      createdBy: user.id,
    },
  });

  await prisma.vpsBackupPolicy.create({
    data: {
      serverId: vpsServer.id,
      status: "ACTIVE",
      frequency: "daily",
      retentionCount: 14,
      lastSuccessAt: new Date("2026-04-10T22:00:00.000Z"),
      nextRunAt: new Date("2026-04-11T22:00:00.000Z"),
      encrypted: true,
      crossRegion: true,
    },
  });

  await prisma.vpsMetricRollup.createMany({
    data: [
      {
        serverId: vpsServer.id,
        cpuPercent: 18,
        memoryPercent: 41,
        diskPercent: 36,
        networkInMbps: 12,
        networkOutMbps: 7,
        uptimeSeconds: 86400n,
        capturedAt: new Date("2026-04-11T08:00:00.000Z"),
      },
      {
        serverId: vpsServer.id,
        cpuPercent: 24,
        memoryPercent: 44,
        diskPercent: 36,
        networkInMbps: 18,
        networkOutMbps: 9,
        uptimeSeconds: 90000n,
        capturedAt: new Date("2026-04-11T12:00:00.000Z"),
      },
    ],
  });

  await prisma.vpsSupportLink.create({
    data: {
      serverId: vpsServer.id,
      externalTicketId: "SUP-1001",
      title: "Initial VPS onboarding",
      priority: "normal",
      status: "OPEN",
      url: "https://support.integration.migrateck.com/tickets/vps-alpha",
      lastUpdatedAt: new Date("2026-04-11T12:30:00.000Z"),
    },
  });

  await prisma.vpsAuditEvent.create({
    data: {
      orgId: org.id,
      serverId: vpsServer.id,
      actorUserId: user.id,
      eventType: "SERVER_SYNCED",
      severity: "INFO",
      payloadJson: {
        message: "Provider sync completed for alpha-node.",
      },
    },
  });

  process.env.PLAYWRIGHT_VPS_SERVER_ID = vpsServer.id;

  process.env.PLAYWRIGHT_TEST_EMAIL = TEST_EMAIL;
  process.env.PLAYWRIGHT_TEST_PASSWORD = TEST_PASSWORD;

  return async () => {
    await prisma.$disconnect();
    await app.stop();
    if (container) {
      await container.stop();
    } else {
      dropTestDatabase(db);
    }
  };
}
