import type { AuthClientConfig } from "./types";

let config: AuthClientConfig | null = null;

export function initAuthClient(nextConfig: AuthClientConfig) {
  config = {
    migraAuthBaseUrl: nextConfig.migraAuthBaseUrl.replace(/\/+$/, ""),
    clientId: nextConfig.clientId,
    ...(nextConfig.clientSecret ? { clientSecret: nextConfig.clientSecret } : {}),
    ...(nextConfig.migraAuthWebUrl ? { migraAuthWebUrl: nextConfig.migraAuthWebUrl.replace(/\/+$/, "") } : {}),
    redirectUri: nextConfig.redirectUri.replace(/\/+$/, ""),
    ...(nextConfig.postLogoutRedirectUri
      ? { postLogoutRedirectUri: nextConfig.postLogoutRedirectUri.replace(/\/+$/, "") }
      : {}),
    appBaseUrl: nextConfig.appBaseUrl.replace(/\/+$/, ""),
    scopes: nextConfig.scopes,
    sessionCookieName: nextConfig.sessionCookieName,
    sessionSecret: nextConfig.sessionSecret,
  };
}

export function getAuthClientConfig(): AuthClientConfig {
  if (!config) {
    throw new Error("Auth client not initialized");
  }

  return config;
}
