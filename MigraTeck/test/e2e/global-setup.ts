import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient, EntitlementStatus, OrgRole, ProductKey, ServerPowerState, VpsBillingCycle, VpsStatus, BillingSubscriptionStatus } from "@prisma/client";
import { createTestDatabaseContext, dropTestDatabase, isPostgresUrl, prepareTestDatabase } from "../setup/db";
import { startAppServer, type AppServerHandle } from "../setup/app";

const TEST_EMAIL = "owner+migramarket-e2e@migrateck.com";
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

  const user = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      emailNormalized: TEST_EMAIL,
      authUserId: `playwright:${TEST_EMAIL}`,
      name: "MigraMarket Playwright Owner",
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

  // ── Session for main test user ──────────────────────────────────────────
  const mainSessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      sessionToken: mainSessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  process.env.PLAYWRIGHT_SESSION_TOKEN = mainSessionToken;

  // ── Billing catalog (shared across billing E2E users) ───────────────────
  const billingProduct = await prisma.billingProduct.create({
    data: {
      code: "playwright-basic-monthly",
      name: "Playwright Basic (Monthly)",
      active: true,
    },
  });

  const billingPrice = await prisma.billingPrice.create({
    data: {
      productId: billingProduct.id,
      code: "playwright-basic-monthly-price",
      currency: "usd",
      unitAmount: 1000,
      interval: "MONTH",
      trialDays: 14,
      active: true,
      stripePriceId: "price_playwright_monthly",
      stripeProductId: "prod_playwright_basic",
    },
  });
  process.env.PLAYWRIGHT_BILLING_PRICE_ID = billingPrice.id;

  // ── Helper: create billing test user/org/session ────────────────────────
  async function createBillingUser(suffix: string) {
    const email = `owner+billing-${suffix}@migrateck.com`;
    const u = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        authUserId: `playwright:${email}`,
        name: `Billing ${suffix} Test User`,
        emailVerified: new Date(),
      },
    });
    const o = await prisma.organization.create({
      data: {
        name: `Billing ${suffix.charAt(0).toUpperCase() + suffix.slice(1)} Org`,
        slug: `billing-${suffix}-playwright`,
        createdById: u.id,
      },
    });
    await prisma.membership.create({
      data: { userId: u.id, orgId: o.id, role: OrgRole.OWNER, status: "ACTIVE" },
    });
    await prisma.user.update({ where: { id: u.id }, data: { defaultOrgId: o.id } });
    const token = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: {
        sessionToken: token,
        userId: u.id,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { user: u, org: o, sessionToken: token };
  }

  // ── ACTIVE subscription user ─────────────────────────────────────────────
  const activeCtx = await createBillingUser("active");
  await prisma.billingCustomer.create({
    data: {
      orgId: activeCtx.org.id,
      stripeCustomerId: "cus_playwright_active",
      userId: activeCtx.user.id,
      email: activeCtx.user.email,
    },
  });
  await prisma.billingSubscription.create({
    data: {
      orgId: activeCtx.org.id,
      stripeSubscriptionId: "sub_playwright_active",
      stripeCustomerId: "cus_playwright_active",
      billingPriceId: billingPrice.id,
      status: BillingSubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  process.env.PLAYWRIGHT_BILLING_ACTIVE_SESSION = activeCtx.sessionToken;
  process.env.PLAYWRIGHT_BILLING_ACTIVE_ORG_ID = activeCtx.org.id;

  // ── PAST_DUE subscription user ───────────────────────────────────────────
  const pastDueCtx = await createBillingUser("pastdue");
  await prisma.billingCustomer.create({
    data: {
      orgId: pastDueCtx.org.id,
      stripeCustomerId: "cus_playwright_pastdue",
      userId: pastDueCtx.user.id,
      email: pastDueCtx.user.email,
    },
  });
  const pastDuePeriodEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  await prisma.billingSubscription.create({
    data: {
      orgId: pastDueCtx.org.id,
      stripeSubscriptionId: "sub_playwright_pastdue",
      stripeCustomerId: "cus_playwright_pastdue",
      billingPriceId: billingPrice.id,
      status: BillingSubscriptionStatus.PAST_DUE,
      currentPeriodStart: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: pastDuePeriodEnd,
    },
  });
  process.env.PLAYWRIGHT_BILLING_PASTDUE_SESSION = pastDueCtx.sessionToken;
  process.env.PLAYWRIGHT_BILLING_PASTDUE_ORG_ID = pastDueCtx.org.id;
  process.env.PLAYWRIGHT_BILLING_PASTDUE_PERIOD_END = pastDuePeriodEnd.toISOString();

  // ── TRIALING subscription user ────────────────────────────────────────────
  const trialingCtx = await createBillingUser("trialing");
  await prisma.billingCustomer.create({
    data: {
      orgId: trialingCtx.org.id,
      stripeCustomerId: "cus_playwright_trialing",
      userId: trialingCtx.user.id,
      email: trialingCtx.user.email,
    },
  });
  const trialEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  await prisma.billingSubscription.create({
    data: {
      orgId: trialingCtx.org.id,
      stripeSubscriptionId: "sub_playwright_trialing",
      stripeCustomerId: "cus_playwright_trialing",
      billingPriceId: billingPrice.id,
      status: BillingSubscriptionStatus.TRIALING,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEnd,
      trialStart: new Date(),
      trialEnd,
    },
  });
  process.env.PLAYWRIGHT_BILLING_TRIALING_SESSION = trialingCtx.sessionToken;
  process.env.PLAYWRIGHT_BILLING_TRIALING_ORG_ID = trialingCtx.org.id;
  process.env.PLAYWRIGHT_BILLING_TRIAL_END = trialEnd.toISOString();

  // ── CANCELED subscription user ────────────────────────────────────────────
  const canceledCtx = await createBillingUser("canceled");
  await prisma.billingCustomer.create({
    data: {
      orgId: canceledCtx.org.id,
      stripeCustomerId: "cus_playwright_canceled",
      userId: canceledCtx.user.id,
      email: canceledCtx.user.email,
    },
  });
  const canceledPeriodEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days remaining
  await prisma.billingSubscription.create({
    data: {
      orgId: canceledCtx.org.id,
      stripeSubscriptionId: "sub_playwright_canceled",
      stripeCustomerId: "cus_playwright_canceled",
      billingPriceId: billingPrice.id,
      status: BillingSubscriptionStatus.CANCELED,
      currentPeriodStart: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: canceledPeriodEnd,
      canceledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });
  process.env.PLAYWRIGHT_BILLING_CANCELED_SESSION = canceledCtx.sessionToken;
  process.env.PLAYWRIGHT_BILLING_CANCELED_ORG_ID = canceledCtx.org.id;

  // ── INCOMPLETE subscription user (payment confirmation required) ──────────
  const incompleteCtx = await createBillingUser("incomplete");
  await prisma.billingCustomer.create({
    data: {
      orgId: incompleteCtx.org.id,
      stripeCustomerId: "cus_playwright_incomplete",
      userId: incompleteCtx.user.id,
      email: incompleteCtx.user.email,
    },
  });
  await prisma.billingSubscription.create({
    data: {
      orgId: incompleteCtx.org.id,
      stripeSubscriptionId: "sub_playwright_incomplete",
      stripeCustomerId: "cus_playwright_incomplete",
      billingPriceId: billingPrice.id,
      status: BillingSubscriptionStatus.INCOMPLETE,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  process.env.PLAYWRIGHT_BILLING_INCOMPLETE_SESSION = incompleteCtx.sessionToken;
  process.env.PLAYWRIGHT_BILLING_INCOMPLETE_ORG_ID = incompleteCtx.org.id;

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
