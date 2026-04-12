import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createTestDatabaseContext, dropTestDatabase, isPostgresUrl, prepareTestDatabase } from "./db";
import { startAppServer } from "./app";

const manualVpsServersJson = JSON.stringify([
  {
    providerSlug: "manual",
    providerServerId: "manual-server-fixture",
    instanceId: "alpha-fixture",
    name: "alpha-node",
    hostname: "alpha-node.example.internal",
    status: "RUNNING",
    powerState: "ON",
    publicIpv4: "203.0.113.10",
    sshPort: 22,
    defaultUsername: "root",
    region: "us-east",
    imageSlug: "ubuntu-24-04",
    osName: "Ubuntu 24.04 LTS",
    planSlug: "vps-2",
    vcpu: 2,
    memoryMb: 4096,
    diskGb: 80,
    bandwidthTb: 4,
    billingCycle: "MONTHLY",
    monthlyPriceCents: 2400,
    billingCurrency: "USD",
  },
]);

export default async function globalSetup() {
  let container: StartedPostgreSqlContainer | undefined;
  let baseDatabaseUrl = process.env.DATABASE_URL_TEST;
  const skipAppBoot = process.env.SKIP_TEST_APP_BOOT === "1";

  if (!baseDatabaseUrl) {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("migrateck_it")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();

    baseDatabaseUrl = container.getConnectionUri();
  }

  if (!isPostgresUrl(baseDatabaseUrl)) {
    throw new Error("DATABASE_URL_TEST must be a postgres connection string.");
  }

  const db = createTestDatabaseContext(baseDatabaseUrl);
  const testPort = Number(process.env.TEST_APP_PORT || 3109);
  const nextAuthSecret = process.env.NEXTAUTH_SECRET || "integration-tests-nextauth-secret-32-plus";
  const launchSecret = process.env.LAUNCH_TOKEN_SECRET || "integration-tests-launch-secret-32-plus";
  const mutableEnv = process.env as Record<string, string | undefined>;

  mutableEnv.NODE_ENV = "test";
  mutableEnv.DATABASE_URL = db.testUrl;
  mutableEnv.NEXTAUTH_SECRET = nextAuthSecret;
  mutableEnv.LAUNCH_TOKEN_SECRET = launchSecret;
  mutableEnv.ENFORCE_EMAIL_VERIFIED_LOGIN = "true";
  mutableEnv.SECURITY_ENFORCE_ORIGIN_CHECKS = "true";
  mutableEnv.DOWNLOAD_STORAGE_PROVIDER = "mock";
  mutableEnv.DOWNLOAD_URL_TTL_SECONDS = "300";
  mutableEnv.STRIPE_BILLING_ENABLED = "true";
  mutableEnv.STRIPE_SECRET_KEY = "sk_test_integration_secret";
  mutableEnv.STRIPE_WEBHOOK_SECRET = "whsec_test_integration_secret";
  mutableEnv.STRIPE_WEBHOOK_TOLERANCE_SECONDS = "300";
  mutableEnv.PROVISIONING_ENGINE_DRY_RUN = "true";
  mutableEnv.PROVISIONING_ENGINE_MAX_ATTEMPTS = "5";
  mutableEnv.JOB_ENVELOPE_SIGNING_SECRET = "integration-tests-job-envelope-secret-32-plus";
  mutableEnv.PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS = "3";
  mutableEnv.PROVISIONING_JOB_BACKOFF_BASE_SECONDS = "1";
  mutableEnv.STEP_UP_TIER2 = "NONE";
  mutableEnv.STEP_UP_TIER2_TTL_SECONDS = "300";
  mutableEnv.STEP_UP_TOTP_ENCRYPTION_KEY = "integration-tests-totp-encryption-secret-32-plus";
  mutableEnv.MIGRAHOSTING_VPS_SIMULATE_ACTIONS = "true";
  mutableEnv.MIGRAHOSTING_VPS_MANUAL_CONSOLE_URL = "https://console.integration.migrateck.com/session";
  mutableEnv.MIGRAHOSTING_VPS_MANUAL_SERVERS_JSON = manualVpsServersJson;

  prepareTestDatabase(db);

  let app: Awaited<ReturnType<typeof startAppServer>> | undefined;

  if (!skipAppBoot) {
    app = await startAppServer({
      port: testPort,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: db.testUrl,
        NEXTAUTH_SECRET: nextAuthSecret,
        LAUNCH_TOKEN_SECRET: launchSecret,
        NEXTAUTH_URL: `http://127.0.0.1:${testPort}`,
        ENFORCE_EMAIL_VERIFIED_LOGIN: "true",
        SECURITY_ENFORCE_ORIGIN_CHECKS: "true",
        DOWNLOAD_STORAGE_PROVIDER: "mock",
        DOWNLOAD_URL_TTL_SECONDS: "300",
        STRIPE_BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_integration_secret",
        STRIPE_WEBHOOK_SECRET: "whsec_test_integration_secret",
        STRIPE_WEBHOOK_TOLERANCE_SECONDS: "300",
        PROVISIONING_ENGINE_DRY_RUN: "true",
        PROVISIONING_ENGINE_MAX_ATTEMPTS: "5",
        JOB_ENVELOPE_SIGNING_SECRET: "integration-tests-job-envelope-secret-32-plus",
        PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS: "3",
        PROVISIONING_JOB_BACKOFF_BASE_SECONDS: "1",
        STEP_UP_TIER2: "NONE",
        STEP_UP_TIER2_TTL_SECONDS: "300",
        STEP_UP_TOTP_ENCRYPTION_KEY: "integration-tests-totp-encryption-secret-32-plus",
        MIGRAHOSTING_VPS_SIMULATE_ACTIONS: "true",
        MIGRAHOSTING_VPS_MANUAL_CONSOLE_URL: "https://console.integration.migrateck.com/session",
        MIGRAHOSTING_VPS_MANUAL_SERVERS_JSON: manualVpsServersJson,
        MIGRAPANEL_LAUNCH_URL: "https://panel.integration.migrateck.com/launch",
        MIGRAVOICE_LAUNCH_URL: "https://voice.integration.migrateck.com/launch",
        MIGRAPILOT_LAUNCH_URL: "https://pilot.integration.migrateck.com/launch",
      },
    });

    mutableEnv.TEST_BASE_URL = app.baseUrl;
  } else {
    mutableEnv.TEST_BASE_URL = `http://127.0.0.1:${testPort}`;
  }

  return async () => {
    try {
      const { prisma } = await import("../helpers/prisma");
      await prisma.$disconnect();
    } catch {
      // Ignore disconnect issues during teardown.
    }

    if (app) {
      await app.stop();
    }
    if (container) {
      await container.stop();
      return;
    }

    dropTestDatabase(db);
  };
}
