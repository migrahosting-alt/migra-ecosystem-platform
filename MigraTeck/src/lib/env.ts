import { z } from "zod";

const isBrowserRuntime = typeof window !== "undefined";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_MIGRADRIVE_BRAND_NAME: z.string().optional(),
  NEXT_PUBLIC_MIGRADRIVE_OPERATOR_NAME: z.string().optional(),
  NEXT_PUBLIC_MIGRADRIVE_WEBSITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_MIGRADRIVE_PRIVACY_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_MIGRADRIVE_LEGAL_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_MIGRADRIVE_SUPPORT_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_MIGRADRIVE_ADDRESS_LINES: z.string().optional(),
  NEXT_PUBLIC_MIGRADRIVE_LEGAL_LAST_UPDATED: z.string().optional(),
  NEXT_PUBLIC_COOKIE_CONSENT_VERSION: z.string().optional(),
  NEXT_PUBLIC_COOKIE_CONSENT_STORAGE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(32).optional(),
  MIGRAAUTH_BASE_URL: z.string().url().optional(),
  MIGRAAUTH_CLIENT_ID_DEFAULT: z.string().optional(),
  MIGRAAUTH_CLIENT_ID_MIGRATECK: z.string().optional(),
  MIGRAAUTH_CLIENT_ID_MIGRAHOSTING: z.string().optional(),
  MIGRAAUTH_CLIENT_SECRET: z.string().optional(),
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  AUTH_REFRESH_TOKEN_TTL_DAYS: z.string().optional(),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.string().optional(),
  AUTH_COOKIE_NAME: z.string().optional(),
  AUTH_COOKIE_SECURE: z.string().optional(),
  AUTH_COOKIE_DOMAIN: z.string().optional(),
  AUTH_ALLOW_REGISTRATION: z.string().optional(),
  NEXT_PUBLIC_ENABLE_SMS_LOGIN: z.string().optional(),
  ENFORCE_EMAIL_VERIFIED_LOGIN: z.string().optional(),
  SECURITY_ENFORCE_ORIGIN_CHECKS: z.string().optional(),
  SECURITY_ALLOWED_ORIGINS: z.string().optional(),
  SECURITY_ALLOWED_HOSTS: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  SMTP_IGNORE_TLS: z.string().optional(),
  NEXT_PUBLIC_ENABLE_MAGIC_LINKS: z.string().optional(),
  LAUNCH_SERVICE_URL: z.string().url().optional(),
  MIGRATECK_LAUNCH_URL: z.string().url().optional(),
  MIGRAHOSTING_LAUNCH_URL: z.string().url().optional(),
  MIGRAPANEL_LAUNCH_URL: z.string().url().optional(),
  MIGRAVOICE_LAUNCH_URL: z.string().url().optional(),
  MIGRAMAIL_LAUNCH_URL: z.string().url().optional(),
  MIGRAINTAKE_LAUNCH_URL: z.string().url().optional(),
  MIGRAMARKET_LAUNCH_URL: z.string().url().optional(),
  MIGRAPILOT_LAUNCH_URL: z.string().url().optional(),
  MIGRAINVOICE_LAUNCH_URL: z.string().url().optional(),
  MIGRADRIVE_LAUNCH_URL: z.string().url().optional(),
  LAUNCH_TOKEN_SECRET: z.string().optional(),
  PRODUCT_CONSUME_SHARED_SECRET: z.string().optional(),
  MARKET_INTERNAL_PROVISION_TOKEN: z.string().optional(),
  UPLOAD_STORAGE_PROVIDER: z.enum(["s3", "minio", "mock"]).optional(),
  DOWNLOAD_STORAGE_PROVIDER: z.enum(["s3", "minio", "mock"]).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  MIGRADRIVE_S3_ENDPOINT: z.string().url().optional(),
  MIGRADRIVE_S3_REGION: z.string().optional(),
  MIGRADRIVE_S3_ACCESS_KEY_ID: z.string().optional(),
  MIGRADRIVE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  MIGRADRIVE_S3_FORCE_PATH_STYLE: z.string().optional(),
  MIGRADRIVE_S3_BUCKET_PRIMARY: z.string().optional(),
  MIGRADRIVE_S3_BUCKET_DERIVATIVES: z.string().optional(),
  MIGRADRIVE_S3_BUCKET_ARCHIVE: z.string().optional(),
  MIGRADRIVE_S3_BUCKET_LOGS: z.string().optional(),
  DOWNLOAD_URL_TTL_SECONDS: z.string().optional(),
  MIGRADRIVE_SIGNED_URL_TTL_SECONDS: z.string().optional(),
  MIGRADRIVE_MULTIPART_MIN_PART_SIZE_MB: z.string().optional(),
  MIGRADRIVE_MAX_UPLOAD_SIZE_MB: z.string().optional(),
  ACCESS_REQUEST_NOTIFY_EMAIL: z.string().optional(),
  ACCESS_REQUEST_NOTIFY_TO: z.string().email().optional(),
  STRIPE_BILLING_ENABLED: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_WEBHOOK_TOLERANCE_SECONDS: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  PROVISIONING_ENGINE_DRY_RUN: z.string().optional(),
  PROVISIONING_ENGINE_MAX_ATTEMPTS: z.string().optional(),
  RUN_PROVISIONING_ENGINE_WORKER: z.string().optional(),
  RUN_VPS_ACTION_RECONCILE_WORKER: z.string().optional(),
  RUN_ENTITLEMENT_EXPIRY_WORKER: z.string().optional(),
  RUN_SOCIAL_CONNECTION_SYNC_WORKER: z.string().optional(),
  PROVISIONING_DISPATCH_URL: z.string().url().optional(),
  PROVISIONING_DISPATCH_TOKEN: z.string().optional(),
  PROVISIONING_DISPATCH_TIMEOUT_MS: z.string().optional(),
  MIGRATECK_PROVISION_URL: z.string().url().optional(),
  MIGRATECK_PROVISION_TOKEN: z.string().optional(),
  MIGRAHOSTING_PROVISION_URL: z.string().url().optional(),
  MIGRAHOSTING_PROVISION_TOKEN: z.string().optional(),
  MIGRAPANEL_PROVISION_URL: z.string().url().optional(),
  MIGRAPANEL_PROVISION_TOKEN: z.string().optional(),
  MIGRAVOICE_PROVISION_URL: z.string().url().optional(),
  MIGRAVOICE_PROVISION_TOKEN: z.string().optional(),
  MIGRAMAIL_PROVISION_URL: z.string().url().optional(),
  MIGRAMAIL_PROVISION_TOKEN: z.string().optional(),
  MIGRAINTAKE_PROVISION_URL: z.string().url().optional(),
  MIGRAINTAKE_PROVISION_TOKEN: z.string().optional(),
  MIGRAMARKET_PROVISION_URL: z.string().url().optional(),
  MIGRAMARKET_PROVISION_TOKEN: z.string().optional(),
  MIGRAPILOT_PROVISION_URL: z.string().url().optional(),
  MIGRAPILOT_PROVISION_TOKEN: z.string().optional(),
  MIGRADRIVE_PROVISION_URL: z.string().url().optional(),
  MIGRADRIVE_PROVISION_TOKEN: z.string().optional(),
  MIGRADRIVE_INTERNAL_PROVISION_TOKEN: z.string().optional(),
  MIGRAHOSTING_AGENT_URL: z.string().url().optional(),
  MIGRAHOSTING_AGENT_KEY_ID: z.string().optional(),
  MIGRAHOSTING_AGENT_SECRET: z.string().optional(),
  MIGRAHOSTING_VPS_IMAGES_JSON: z.string().optional(),
  VPS_CONSOLE_ENABLED: z.string().optional(),
  VPS_FIREWALL_ENABLED: z.string().optional(),
  VPS_SNAPSHOTS_ENABLED: z.string().optional(),
  VPS_BACKUPS_ENABLED: z.string().optional(),
  VPS_MONITORING_ENABLED: z.string().optional(),
  VPS_REBUILD_ENABLED: z.string().optional(),
  VPS_SUPPORT_DIAGNOSTICS_ENABLED: z.string().optional(),
  AUTH_SMS_FROM_NUMBER: z.string().optional(),
  AUTH_SMS_BRAND_NAME: z.string().optional(),
  AUTH_SMS_CODE_TTL_SECONDS: z.string().optional(),
  AUTH_SMS_MAX_ATTEMPTS: z.string().optional(),
  TELNYX_API_KEY: z.string().optional(),
  TELNYX_MESSAGING_PROFILE_ID: z.string().optional(),
  TELNYX_MESSAGING_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  TELNYX_MESSAGING_WEBHOOK_TOLERANCE_SECONDS: z.string().optional(),
  MIGRAMARKET_SMS_BATCH_SIZE: z.string().optional(),
  MIGRAMARKET_SOCIAL_CONNECT_ENCRYPTION_KEY: z.string().optional(),
  MIGRAMARKET_META_CLIENT_ID: z.string().optional(),
  MIGRAMARKET_META_CLIENT_SECRET: z.string().optional(),
  MIGRAMARKET_LINKEDIN_CLIENT_ID: z.string().optional(),
  MIGRAMARKET_LINKEDIN_CLIENT_SECRET: z.string().optional(),
  MIGRAMARKET_GOOGLE_CLIENT_ID: z.string().optional(),
  MIGRAMARKET_GOOGLE_CLIENT_SECRET: z.string().optional(),
  MIGRAMARKET_X_CLIENT_ID: z.string().optional(),
  MIGRAMARKET_X_CLIENT_SECRET: z.string().optional(),
  MIGRAMARKET_TIKTOK_CLIENT_KEY: z.string().optional(),
  MIGRAMARKET_TIKTOK_CLIENT_SECRET: z.string().optional(),
  MIGRAMARKET_PINTEREST_CLIENT_ID: z.string().optional(),
  MIGRAMARKET_PINTEREST_CLIENT_SECRET: z.string().optional(),
  MIGRAMAIL_CORE_URL: z.string().url().optional(),
  MIGRAMAIL_CORE_API_KEY: z.string().optional(),
  MIGRAPANEL_EDGE_URL: z.string().url().optional(),
  MIGRAPANEL_EDGE_TOKEN: z.string().optional(),
  OPS_ALERT_WEBHOOK_URL: z.string().url().optional(),
  OPS_ALERT_WEBHOOK_TOKEN: z.string().optional(),
  OPS_ALERT_WEBHOOK_FAILURE_THRESHOLD: z.string().optional(),
  OPS_ALERT_QUEUE_STUCK_SECONDS: z.string().optional(),
  OPS_ALERT_RETRY_THRESHOLD: z.string().optional(),
  OPS_ALERT_AUTO_RESTRICT_BURST_THRESHOLD: z.string().optional(),
  OPS_ALERT_LOCKDOWN_BLOCK_BURST_THRESHOLD: z.string().optional(),
  OPS_ALERT_SOCIAL_RECONNECT_THRESHOLD: z.string().optional(),
  OPS_ALERT_SOCIAL_STALE_THRESHOLD: z.string().optional(),
  STEP_UP_TIER2: z.enum(["NONE", "REAUTH", "TOTP", "PASSKEY"]).optional(),
  STEP_UP_TIER2_TTL_SECONDS: z.string().optional(),
  STEP_UP_TOTP_DRIFT_WINDOWS: z.string().optional(),
  STEP_UP_TOTP_ENCRYPTION_KEY: z.string().optional(),
  STEP_UP_PASSKEY_ENABLED: z.string().optional(),
  JOB_ENVELOPE_SIGNING_SECRET: z.string().optional(),
  PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS: z.string().optional(),
  PROVISIONING_JOB_BACKOFF_BASE_SECONDS: z.string().optional(),
  PROVISIONING_WORKER_PRODUCT_ALLOWLIST: z.string().optional(),
  WORKER_INSTANCE_ID: z.string().optional(),
  SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS: z.string().optional(),
  SOCIAL_CONNECTION_SYNC_VERIFICATION_STALE_HOURS: z.string().optional(),
  SOCIAL_CONNECTION_SYNC_BATCH_SIZE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed");
}

export const env = parsed.data;

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const isMagicLinkEnabled =
  env.NEXT_PUBLIC_ENABLE_MAGIC_LINKS === "true" &&
  Boolean(env.SMTP_FROM);

export const isEmailVerificationRequiredForLogin = env.ENFORCE_EMAIL_VERIFIED_LOGIN !== "false";
export const isSmsLoginEnabled = env.NEXT_PUBLIC_ENABLE_SMS_LOGIN !== "false";
export const authAllowRegistration = env.AUTH_ALLOW_REGISTRATION !== "false";

export const shouldEnforceOriginChecks =
  env.SECURITY_ENFORCE_ORIGIN_CHECKS === "true" ||
  (env.NODE_ENV === "production" && env.SECURITY_ENFORCE_ORIGIN_CHECKS !== "false");

export const securityAllowedOrigins = parseCsvEnv(env.SECURITY_ALLOWED_ORIGINS);
export const securityAllowedHosts = parseCsvEnv(env.SECURITY_ALLOWED_HOSTS);

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const downloadStorageProvider = env.DOWNLOAD_STORAGE_PROVIDER || (env.NODE_ENV === "production" ? "s3" : "mock");
export const uploadStorageProvider = env.UPLOAD_STORAGE_PROVIDER || downloadStorageProvider;
export const driveDownloadStorageProvider = downloadStorageProvider;
export const driveUploadStorageProvider = uploadStorageProvider;

if (!isBrowserRuntime && downloadStorageProvider === "mock" && env.NODE_ENV === "production") {
  throw new Error("DOWNLOAD_STORAGE_PROVIDER=mock is not allowed in production.");
}

if (!isBrowserRuntime && uploadStorageProvider === "mock" && env.NODE_ENV === "production") {
  throw new Error("UPLOAD_STORAGE_PROVIDER=mock is not allowed in production.");
}

if (!isBrowserRuntime && downloadStorageProvider === "mock" && env.NODE_ENV === "development") {
  console.warn("[migradrive] DOWNLOAD_STORAGE_PROVIDER=mock enabled. Local signed URLs will resolve through mock storage routes.");
}

if (!isBrowserRuntime && uploadStorageProvider === "mock" && env.NODE_ENV === "development") {
  console.warn("[migradrive] UPLOAD_STORAGE_PROVIDER=mock enabled. Local upload URLs will resolve through mock storage routes.");
}

export const downloadUrlTtlSeconds = parseInteger(env.DOWNLOAD_URL_TTL_SECONDS, 300);
const resolvedAuthAccessTokenSecret = env.AUTH_ACCESS_TOKEN_SECRET || env.NEXTAUTH_SECRET;

if (!resolvedAuthAccessTokenSecret && !isBrowserRuntime) {
  throw new Error("AUTH_ACCESS_TOKEN_SECRET or NEXTAUTH_SECRET must be configured.");
}

export const authAccessTokenSecret: string = resolvedAuthAccessTokenSecret || "";

export const authAccessTokenTtlSeconds = parseInteger(env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 900);
export const authRefreshTokenTtlDays = parseInteger(env.AUTH_REFRESH_TOKEN_TTL_DAYS, 30);
export const authCookieName = env.AUTH_COOKIE_NAME || "migradrive_refresh";
export const authCookieSecure = env.AUTH_COOKIE_SECURE
  ? env.AUTH_COOKIE_SECURE === "true"
  : env.NODE_ENV === "production";
export const authCookieDomain = env.AUTH_COOKIE_DOMAIN || "";
export const driveSignedUrlTtlSeconds = parseInteger(env.MIGRADRIVE_SIGNED_URL_TTL_SECONDS, 900);
export const driveMultipartMinPartSizeMb = parseInteger(env.MIGRADRIVE_MULTIPART_MIN_PART_SIZE_MB, 8);
export const driveMaxUploadSizeMb = parseInteger(env.MIGRADRIVE_MAX_UPLOAD_SIZE_MB, 5120);
export const driveMaxUploadSizeBytes = driveMaxUploadSizeMb * 1024 * 1024;
export const accessRequestNotificationsEnabled = env.ACCESS_REQUEST_NOTIFY_EMAIL === "true";
export const stripeBillingEnabled = env.STRIPE_BILLING_ENABLED === "true";
export const stripeWebhookToleranceSeconds = parseInteger(env.STRIPE_WEBHOOK_TOLERANCE_SECONDS, 300);
export const provisioningEngineDryRun = env.PROVISIONING_ENGINE_DRY_RUN !== "false";
export const provisioningEngineMaxAttempts = parseInteger(env.PROVISIONING_ENGINE_MAX_ATTEMPTS, 5);
export const vpsConsoleEnabled = env.VPS_CONSOLE_ENABLED !== "false";
export const vpsFirewallEnabled = env.VPS_FIREWALL_ENABLED !== "false";
export const vpsSnapshotsEnabled = env.VPS_SNAPSHOTS_ENABLED !== "false";
export const vpsBackupsEnabled = env.VPS_BACKUPS_ENABLED !== "false";
export const vpsMonitoringEnabled = env.VPS_MONITORING_ENABLED !== "false";
export const vpsRebuildEnabled = env.VPS_REBUILD_ENABLED !== "false";
export const vpsSupportDiagnosticsEnabled = env.VPS_SUPPORT_DIAGNOSTICS_ENABLED !== "false";
export const opsAlertWebhookFailureThreshold = parseInteger(env.OPS_ALERT_WEBHOOK_FAILURE_THRESHOLD, 3);
export const opsAlertQueueStuckSeconds = parseInteger(env.OPS_ALERT_QUEUE_STUCK_SECONDS, 900);
export const opsAlertRetryThreshold = parseInteger(env.OPS_ALERT_RETRY_THRESHOLD, 20);
export const opsAlertAutoRestrictBurstThreshold = parseInteger(env.OPS_ALERT_AUTO_RESTRICT_BURST_THRESHOLD, 20);
export const opsAlertLockdownBlockBurstThreshold = parseInteger(env.OPS_ALERT_LOCKDOWN_BLOCK_BURST_THRESHOLD, 20);
export const opsAlertSocialReconnectThreshold = parseInteger(env.OPS_ALERT_SOCIAL_RECONNECT_THRESHOLD, 1);
export const opsAlertSocialStaleThreshold = parseInteger(env.OPS_ALERT_SOCIAL_STALE_THRESHOLD, 3);
export const stepUpTier2Method = env.STEP_UP_TIER2 || "NONE";
export const stepUpTier2TtlSeconds = parseInteger(env.STEP_UP_TIER2_TTL_SECONDS, 300);
export const stepUpTotpDriftWindows = parseInteger(env.STEP_UP_TOTP_DRIFT_WINDOWS, 1);
export const stepUpPasskeyEnabled = env.STEP_UP_PASSKEY_ENABLED === "true";
export const provisioningJobDefaultMaxAttempts = parseInteger(env.PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS, 5);
export const provisioningJobBackoffBaseSeconds = parseInteger(env.PROVISIONING_JOB_BACKOFF_BASE_SECONDS, 30);
export const provisioningDispatchTimeoutMs = parseInteger(env.PROVISIONING_DISPATCH_TIMEOUT_MS, 10000);
export const provisioningWorkerProductAllowlist = new Set(parseCsvEnv(env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST));
export const authSmsFromNumber = env.AUTH_SMS_FROM_NUMBER || "+18775455428";
export const authSmsBrandName = env.AUTH_SMS_BRAND_NAME || "MigraHosting";
export const authSmsCodeTtlSeconds = parseInteger(env.AUTH_SMS_CODE_TTL_SECONDS, 600);
export const authSmsMaxAttempts = parseInteger(env.AUTH_SMS_MAX_ATTEMPTS, 5);
export const telnyxMessagingWebhookToleranceSeconds = parseInteger(env.TELNYX_MESSAGING_WEBHOOK_TOLERANCE_SECONDS, 300);
export const migraMarketSmsBatchSize = parseInteger(env.MIGRAMARKET_SMS_BATCH_SIZE, 50);
export const runSocialConnectionSyncWorker = env.RUN_SOCIAL_CONNECTION_SYNC_WORKER === "true";
export const socialConnectionSyncRefreshWindowHours = parseInteger(env.SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS, 72);
export const socialConnectionVerificationStaleHours = parseInteger(env.SOCIAL_CONNECTION_SYNC_VERIFICATION_STALE_HOURS, 24);
export const socialConnectionSyncBatchSize = parseInteger(env.SOCIAL_CONNECTION_SYNC_BATCH_SIZE, 25);
