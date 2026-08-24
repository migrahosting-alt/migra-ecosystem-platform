/**
 * MigraAuth — Environment configuration.
 * Single source for all environment-derived settings.
 * Dev: loaded via `tsx watch --env-file .env`
 * Prod: loaded via systemd EnvironmentFile
 */
import { readFileSync } from "node:fs";

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function envList(key: string): string[] {
  const value = process.env[key];
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Read a signing key from an inline env var, or from a *_FILE path (PEM). HS256 fallback if neither. */
function readKeyMaybe(inlineKey: string, fileKey: string): string | undefined {
  const inline = process.env[inlineKey];
  if (inline && inline.trim()) return inline;
  const file = process.env[fileKey];
  if (file && file.trim()) {
    try {
      return readFileSync(file, "utf8");
    } catch (err) {
      console.error(`[auth] failed to read key file from ${fileKey}=${file}:`, (err as Error).message);
      return undefined;
    }
  }
  return undefined;
}

/**
 * Normalize a MigraAuth client id into the ENV-VAR suffix that names its
 * per-product provider credentials.
 *
 * `migrapilot_web` -> `MIGRAPILOT_WEB`, so the variable reads
 * `AUTH_GOOGLE_CLIENT_ID__MIGRAPILOT_WEB`. Derived rather than mapped, so
 * registering a product and configuring its provider app cannot drift apart.
 */
export function providerEnvSuffix(productClientId: string): string {
  return productClientId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export interface ProviderCredentialPair {
  clientId: string;
  clientSecret: string;
}

/**
 * PER-PRODUCT PROVIDER APPS.
 *
 * WHY THIS EXISTS. Google shows the consent screen of the PROJECT the OAuth
 * client belongs to — one brand per project, shared by every client in it. With
 * a single ecosystem-wide Google app, every product's sign-in says "Continue to
 * <whatever that one project is called>", and no per-client setting can change
 * it. Giving a product its own Google project, and therefore its own client, is
 * the only way its consent screen can name it.
 *
 * ABSENT IS THE NORMAL CASE. A product with no override signs in through the
 * shared credential exactly as before, so products migrate one at a time.
 *
 * A HALF-CONFIGURED OVERRIDE IS FATAL AT BOOT, never a silent fallback. Falling
 * back would start the product against the shared app and show the wrong
 * product name on the consent screen — the precise failure this feature exists
 * to prevent — while every health check stayed green. An id without its secret
 * is a deployment mistake, and it says so before it can serve a request.
 */
export function providerOverrides(provider: "GOOGLE" | "GITHUB"): Record<string, ProviderCredentialPair> {
  const idPrefix = `AUTH_${provider}_CLIENT_ID__`;
  const secretPrefix = `AUTH_${provider}_CLIENT_SECRET__`;
  const suffixes = new Set<string>();

  for (const key of Object.keys(process.env)) {
    if (key.startsWith(idPrefix)) suffixes.add(key.slice(idPrefix.length));
    else if (key.startsWith(secretPrefix)) suffixes.add(key.slice(secretPrefix.length));
  }

  const overrides: Record<string, ProviderCredentialPair> = {};
  for (const suffix of suffixes) {
    const clientId = (process.env[idPrefix + suffix] ?? "").trim();
    const clientSecret = (process.env[secretPrefix + suffix] ?? "").trim();
    if (!clientId || !clientSecret) {
      throw new Error(
        `Incomplete ${provider} app for product "${suffix}": ` +
          `${idPrefix}${suffix} and ${secretPrefix}${suffix} must BOTH be set. ` +
          `Refusing to start rather than sign that product in through the shared app.`,
      );
    }
    overrides[suffix] = { clientId, clientSecret };
  }
  return overrides;
}

export const config = {
  /** Server */
  port: envInt("AUTH_PORT", 4000),
  host: env("AUTH_HOST", "0.0.0.0"),
  publicUrl: env("AUTH_PUBLIC_URL", "http://localhost:4000"),
  webUrl: env("AUTH_WEB_URL", "http://localhost:4100"),

  /** Database */
  databaseUrl: env("AUTH_DATABASE_URL", "postgresql://migra:migra_dev_password@127.0.0.1:5432/auth_migrateck?schema=public"),

  /** Redis (optional, for rate limits/ephemeral data) */
  redisUrl: process.env["REDIS_URL"] ?? undefined,

  /** JWT / Signing */
  jwtIssuer: env("AUTH_JWT_ISSUER", "https://auth.migrateck.com"),
  /** RSA private key PEM or auto-generate in dev */
  jwtPrivateKey: readKeyMaybe("AUTH_JWT_PRIVATE_KEY", "AUTH_JWT_PRIVATE_KEY_FILE"),
  jwtPublicKey: readKeyMaybe("AUTH_JWT_PUBLIC_KEY", "AUTH_JWT_PUBLIC_KEY_FILE"),
  /** HMAC fallback for dev (not for production) */
  jwtSecret: env("AUTH_JWT_SECRET", "dev-only-change-me-in-production-32-chars!!"),

  /** Token lifetimes (seconds) */
  accessTokenTtl: envInt("AUTH_ACCESS_TOKEN_TTL", 900),        // 15 min
  refreshTokenTtl: envInt("AUTH_REFRESH_TOKEN_TTL", 2592000),  // 30 days
  authCodeTtl: envInt("AUTH_CODE_TTL", 300),                   // 5 min
  emailVerifyTtl: envInt("AUTH_EMAIL_VERIFY_TTL", 3600),       // 1 hour
  passwordResetTtl: envInt("AUTH_PASSWORD_RESET_TTL", 1800),   // 30 min
  sessionTtl: envInt("AUTH_SESSION_TTL", 604800),              // 7 days
  verificationCodeTtl: envInt("AUTH_VERIFICATION_CODE_TTL", 600),
  verificationCodeMaxAttempts: envInt("AUTH_VERIFICATION_CODE_MAX_ATTEMPTS", 5),
  verificationResendCooldownSec: envInt("AUTH_VERIFICATION_RESEND_COOLDOWN", 30),

  /** Cookie */
  cookieDomain: process.env["AUTH_COOKIE_DOMAIN"] ?? undefined,
  cookieSecure: env("AUTH_COOKIE_SECURE", "false") === "true",
  sessionCookieName: env("AUTH_SESSION_COOKIE", "migraauth_session"),
  refreshCookieName: env("AUTH_REFRESH_COOKIE", "migraauth_refresh"),
  firstPartyRefreshClientId: env("AUTH_FIRST_PARTY_REFRESH_CLIENT_ID", "migraauth_web"),

  /**
   * External identity providers.
   *
   * ABSENT CREDENTIALS MEAN THE PROVIDER IS OFF, not broken. A deployment
   * without a Google app must not render a Google button that leads to a
   * consent screen for a client that does not exist — so these are optional,
   * and `availableProviders()` reads them to decide what the UI may offer.
   *
   * Secrets live here and nowhere else: never in a schema, never in a client
   * bundle, never in a redirect.
   */
  social: {
    google: {
      clientId: process.env["AUTH_GOOGLE_CLIENT_ID"] ?? "",
      clientSecret: process.env["AUTH_GOOGLE_CLIENT_SECRET"] ?? "",
      /**
       * Per-product Google apps, keyed by `providerEnvSuffix(clientId)`. The
       * shared credential above stays the default for every product without
       * one. See `providerOverrides`.
       */
      byProduct: providerOverrides("GOOGLE"),
    },
    github: {
      clientId: process.env["AUTH_GITHUB_CLIENT_ID"] ?? "",
      clientSecret: process.env["AUTH_GITHUB_CLIENT_SECRET"] ?? "",
      byProduct: providerOverrides("GITHUB"),
    },
    /**
     * Extra origins a provider sign-in may return to, beyond this service and
     * its own web UI. An allowlist of ORIGINS — never a prefix match, which
     * `https://auth.migrateck.com.evil.test` would satisfy.
     */
    returnOrigins: envList("AUTH_SOCIAL_RETURN_ORIGINS"),
  },

  /** CORS */
  corsOrigins: env("AUTH_CORS_ORIGINS", "http://localhost:4100,http://localhost:3000,http://localhost:3200").split(","),

  /** Email / SMTP */
  smtpHost: env("SMTP_HOST", "localhost"),
  smtpPort: envInt("SMTP_PORT", 587),
  smtpUser: process.env["SMTP_USER"] ?? process.env["SMTP_USERNAME"] ?? undefined,
  smtpPass: process.env["SMTP_PASS"] ?? process.env["SMTP_PASSWORD"] ?? undefined,
  emailFrom:
    process.env["AUTH_EMAIL_FROM"] ??
    process.env["SMTP_FROM"] ??
    "MigraTeck Account <noreply@auth.migrateck.com>",
  smsProvider: env("AUTH_SMS_PROVIDER", "console"),
  sms: {
    console: {
      logBody: env("AUTH_SMS_CONSOLE_LOG_BODY", "false") === "true",
    },
    twilio: {
      accountSid: process.env["AUTH_SMS_TWILIO_ACCOUNT_SID"] ?? undefined,
      authToken: process.env["AUTH_SMS_TWILIO_AUTH_TOKEN"] ?? undefined,
      fromNumber: process.env["AUTH_SMS_TWILIO_FROM_NUMBER"] ?? undefined,
      messagingServiceSid: process.env["AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID"] ?? undefined,
      statusCallbackUrl: process.env["AUTH_SMS_TWILIO_STATUS_CALLBACK_URL"] ?? undefined,
    },
    testLane: {
      url: process.env["AUTH_SMS_TEST_LANE_URL"] ?? undefined,
      apiKey: process.env["AUTH_SMS_TEST_LANE_API_KEY"] ?? undefined,
      label: process.env["AUTH_SMS_TEST_LANE_LABEL"] ?? "migraauth-staging",
      allowedNumbers: envList("AUTH_SMS_TEST_LANE_ALLOWED_NUMBERS"),
    },
  },

  /** Rate limits */
  loginRateLimit: envInt("AUTH_LOGIN_RATE_LIMIT", 10),         // per minute
  signupRateLimit: envInt("AUTH_SIGNUP_RATE_LIMIT", 5),        // per minute
  globalRateLimit: envInt("AUTH_GLOBAL_RATE_LIMIT", 100),      // per minute

  /** Security */
  maxFailedLogins: envInt("AUTH_MAX_FAILED_LOGINS", 10),
  lockoutDurationSec: envInt("AUTH_LOCKOUT_DURATION", 900),    // 15 min

  /** Environment */
  nodeEnv: env("NODE_ENV", "development"),
  isDev: env("NODE_ENV", "development") === "development",

  /** Billing (Stripe) */
  billing: {
    stripeSecretKey: process.env["STRIPE_SECRET_KEY"] ?? undefined,
    stripeWebhookSecret: process.env["STRIPE_WEBHOOK_SECRET"] ?? undefined,
    guestCheckoutEnabled: process.env["GUEST_CHECKOUT_ENABLED"] === "1",
    stripePriceCatalogVersion: env("STRIPE_PRICE_CATALOG_VERSION", "v1"),
  },
} as const;
