/**
 * MigraAuth — Environment configuration.
 * Single source for all environment-derived settings.
 */

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
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
  jwtPrivateKey: process.env["AUTH_JWT_PRIVATE_KEY"] ?? undefined,
  jwtPublicKey: process.env["AUTH_JWT_PUBLIC_KEY"] ?? undefined,
  /** HMAC fallback for dev (not for production) */
  jwtSecret: env("AUTH_JWT_SECRET", "dev-only-change-me-in-production-32-chars!!"),

  /** Token lifetimes (seconds) */
  accessTokenTtl: envInt("AUTH_ACCESS_TOKEN_TTL", 900),        // 15 min
  refreshTokenTtl: envInt("AUTH_REFRESH_TOKEN_TTL", 2592000),  // 30 days
  authCodeTtl: envInt("AUTH_CODE_TTL", 300),                   // 5 min
  emailVerifyTtl: envInt("AUTH_EMAIL_VERIFY_TTL", 3600),       // 1 hour
  passwordResetTtl: envInt("AUTH_PASSWORD_RESET_TTL", 1800),   // 30 min
  sessionTtl: envInt("AUTH_SESSION_TTL", 604800),              // 7 days

  /** Cookie */
  cookieDomain: process.env["AUTH_COOKIE_DOMAIN"] ?? undefined,
  cookieSecure: env("AUTH_COOKIE_SECURE", "false") === "true",
  sessionCookieName: env("AUTH_SESSION_COOKIE", "migraauth_session"),

  /** CORS */
  corsOrigins: env("AUTH_CORS_ORIGINS", "http://localhost:4100,http://localhost:3000,http://localhost:3200").split(","),

  /** Email / SMTP */
  smtpHost: env("SMTP_HOST", "localhost"),
  smtpPort: envInt("SMTP_PORT", 587),
  smtpUser: process.env["SMTP_USER"] ?? undefined,
  smtpPass: process.env["SMTP_PASS"] ?? undefined,
  emailFrom: env("AUTH_EMAIL_FROM", "MigraTeck Account <noreply@auth.migrateck.com>"),

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
} as const;
