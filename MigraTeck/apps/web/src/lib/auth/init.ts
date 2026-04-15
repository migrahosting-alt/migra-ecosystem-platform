import { initAuthClient } from "@migrateck/auth-client";

let initialized = false;

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function getRequiredSessionSecret() {
  const secret = process.env.APP_SESSION_SECRET;
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    return "dev-only-change-me-before-production-32-chars";
  }

  throw new Error("APP_SESSION_SECRET must be configured.");
}

function resolveAppBaseUrl() {
  return normalizeUrl(
    process.env.APP_BASE_URL
      ?? process.env.SITE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? "http://localhost:3000",
  );
}

export function ensureAuthClientInitialized() {
  if (initialized) {
    return;
  }

  const appBaseUrl = resolveAppBaseUrl();
  const migraAuthBaseUrl = normalizeUrl(
    process.env.MIGRAAUTH_BASE_URL
      ?? process.env.AUTH_PUBLIC_URL
      ?? process.env.NEXT_PUBLIC_AUTH_URL
      ?? "http://localhost:4000",
  );

  const migraAuthWebUrl = normalizeUrl(
    process.env.MIGRAAUTH_WEB_URL
      ?? process.env.AUTH_WEB_URL
      ?? process.env.NEXT_PUBLIC_AUTH_WEB_URL
      ?? "http://localhost:4100",
  );

  initAuthClient({
    migraAuthBaseUrl,
    migraAuthWebUrl,
    clientId: process.env.MIGRAAUTH_CLIENT_ID ?? "migrateck_web",
    ...(process.env.MIGRAAUTH_CLIENT_SECRET
      ? { clientSecret: process.env.MIGRAAUTH_CLIENT_SECRET }
      : {}),
    redirectUri: normalizeUrl(process.env.MIGRAAUTH_REDIRECT_URI ?? `${appBaseUrl}/auth/callback`),
    postLogoutRedirectUri: normalizeUrl(
      process.env.MIGRAAUTH_POST_LOGOUT_REDIRECT_URI ?? `${appBaseUrl}/login`,
    ),
    appBaseUrl,
    scopes: ["openid", "profile", "email", "offline_access", "orgs:read"],
    sessionCookieName: process.env.APP_SESSION_COOKIE_NAME ?? "migrateck_web_session",
    sessionSecret: getRequiredSessionSecret(),
  });

  initialized = true;
}
