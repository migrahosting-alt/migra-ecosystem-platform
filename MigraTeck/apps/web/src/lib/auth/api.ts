/**
 * Server-side helpers for making authenticated calls to auth-api and main API.
 * Reads the OAuth access token stored in the session cookie during bootstrap.
 * Automatically refreshes expired tokens using the refresh_token grant.
 */
import { getAppSession, setAppSession, getAuthClientConfig } from "@migrateck/auth-client";
import { ensureAuthClientInitialized } from "./init";
import { resolveAuthApiUrl } from "../platform";

type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

function extractTokens(session: {
  productAccount?: Record<string, unknown> | null;
}): StoredTokens | null {
  const pa = session.productAccount as Record<string, unknown> | undefined;
  const tokens = pa?._tokens as StoredTokens | undefined;
  if (tokens?.accessToken) return tokens;

  const legacyAccessToken = typeof pa?.accessToken === "string" ? pa.accessToken : null;
  if (!legacyAccessToken) return null;

  return {
    accessToken: legacyAccessToken,
    refreshToken: typeof pa?.refreshToken === "string" ? pa.refreshToken : null,
    expiresAt: typeof pa?.expiresAt === "number" ? pa.expiresAt : Date.now() + 5 * 60_000,
  };
}

function getSafePlatformErrorMessage(status: number, fallback?: string) {
  if (status === 401 || status === 403) {
    return "This control needs a refreshed sign-in before it can load.";
  }

  return fallback ?? `API error ${status}`;
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number } | null> {
  const cfg = getAuthClientConfig();
  try {
    const res = await fetch(`${cfg.migraAuthBaseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: cfg.clientId,
        ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
      }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Get a valid access token, refreshing if expired.
 * Returns null if no token available or refresh fails.
 */
export async function getAccessToken(): Promise<string | null> {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return null;

  const tokens = extractTokens(session);
  if (!tokens) return null;

  // Token still valid (with 60s buffer)
  if (tokens.expiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }

  // Need refresh
  if (!tokens.refreshToken) return null;

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  if (!refreshed) return null;

  // Update session with new tokens
  const pa = (session.productAccount ?? {}) as Record<string, unknown>;
  await setAppSession({
    ...session,
    productAccount: {
      ...pa,
      _tokens: {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
      },
    },
  });

  return refreshed.access_token;
}

/**
 * Fetch from auth-api with Bearer token authentication.
 */
export async function fetchAuthApi<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; ok: true } | { error: string; status: number; ok: false }> {
  const token = await getAccessToken();
  if (!token) {
    return { error: "This control needs a refreshed sign-in before it can load.", status: 401, ok: false };
  }

  const baseUrl = resolveAuthApiUrl();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = getSafePlatformErrorMessage(res.status, body?.error?.message ?? body?.message);
    return { error: message, status: res.status, ok: false };
  }

  const data = await res.json() as T;
  return { data, ok: true };
}

/**
 * Fetch from the main platform API with org context.
 */
export async function fetchPlatformApi<T = unknown>(
  path: string,
  orgId: string,
  options: RequestInit = {},
): Promise<{ data: T; ok: true } | { error: string; status: number; ok: false }> {
  const token = await getAccessToken();
  const baseUrl = process.env.MIGRATECK_API_URL ?? "http://localhost:4000";
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("x-org-id", orgId);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${baseUrl}/v1${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = getSafePlatformErrorMessage(res.status, body?.error?.message ?? body?.message);
    return { error: message, status: res.status, ok: false };
  }

  const data = await res.json() as T;
  return { data, ok: true };
}
