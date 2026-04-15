import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { isVpsPortalHost } from "@/lib/migradrive-auth-branding";

const DEFAULT_MIGRAAUTH_BASE_URL = "https://auth.migrateck.com";
const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access", "orgs:read"];

const STATE_COOKIE = "ma_state";
const VERIFIER_COOKIE = "ma_verifier";
const CLIENT_COOKIE = "ma_client_id";
const REDIRECT_COOKIE = "ma_redirect_uri";
const NEXT_COOKIE = "ma_next_path";

export type MigraAuthUserInfo = {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
};

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createState(): string {
  return base64url(crypto.randomBytes(32));
}

function createCodeVerifier(): string {
  return base64url(crypto.randomBytes(48));
}

function createCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "")
    .split(",")[0]!
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function isMigraTeckHost(host: string | null | undefined): boolean {
  const normalized = normalizeHost(host);
  return normalized === "migrateck.com" || normalized === "www.migrateck.com";
}

function sanitizeNextPath(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/app";
  }

  return nextPath;
}

export function resolveMigraAuthBaseUrl(): string {
  return env.MIGRAAUTH_BASE_URL || DEFAULT_MIGRAAUTH_BASE_URL;
}

export function resolveMigraAuthClientId(host: string | null | undefined): string {
  if (isVpsPortalHost(host) || normalizeHost(host).includes("migrahosting")) {
    return env.MIGRAAUTH_CLIENT_ID_MIGRAHOSTING || "migrahosting_web";
  }

  if (isMigraTeckHost(host)) {
    return env.MIGRAAUTH_CLIENT_ID_MIGRATECK || "migrateck_web";
  }

  return env.MIGRAAUTH_CLIENT_ID_DEFAULT || "migradrive_web";
}

export function resolveAppBaseUrl(input: {
  host: string | null | undefined;
  forwardedProto?: string | null | undefined;
}): string {
  const fallback = env.BASE_URL || env.NEXTAUTH_URL || "http://localhost:3000";
  const host = input.host?.split(",")[0]?.trim();
  if (!host) {
    return fallback.replace(/\/+$/, "");
  }

  const proto = input.forwardedProto?.split(",")[0]?.trim()
    || (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`.replace(/\/+$/, "");
}

export function resolveDefaultPostLoginPath(host: string | null | undefined): string {
  return isVpsPortalHost(host) ? "/app/vps" : "/app";
}

export async function buildAuthorizeUrl(input: {
  host: string | null | undefined;
  forwardedProto?: string | null | undefined;
  nextPath?: string | null | undefined;
}) {
  const clientId = resolveMigraAuthClientId(input.host);
  const redirectUri = `${resolveAppBaseUrl(input)}/auth/callback`;
  const nextPath = sanitizeNextPath(input.nextPath || resolveDefaultPostLoginPath(input.host));
  const state = createState();
  const verifier = createCodeVerifier();
  const challenge = createCodeChallenge(verifier);
  const store = await cookies();

  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  store.set(VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  store.set(CLIENT_COOKIE, clientId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  store.set(REDIRECT_COOKIE, redirectUri, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  store.set(NEXT_COOKIE, nextPath, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  return `${resolveMigraAuthBaseUrl()}/oauth/authorize?${params.toString()}`;
}

export function buildSignupUrl(input: {
  host: string | null | undefined;
  forwardedProto?: string | null | undefined;
}) {
  const clientId = resolveMigraAuthClientId(input.host);
  const redirectUri = `${resolveAppBaseUrl(input)}/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    return_to: redirectUri,
  });

  return `${resolveMigraAuthBaseUrl()}/signup?${params.toString()}`;
}

export function buildForgotPasswordUrl(input: {
  host: string | null | undefined;
}) {
  const params = new URLSearchParams({
    client_id: resolveMigraAuthClientId(input.host),
  });

  return `${resolveMigraAuthBaseUrl()}/forgot-password?${params.toString()}`;
}

export function buildResetPasswordUrl(input: {
  host: string | null | undefined;
  search: string;
}) {
  const params = new URLSearchParams(input.search);
  if (!params.get("client_id")) {
    params.set("client_id", resolveMigraAuthClientId(input.host));
  }
  return `${resolveMigraAuthBaseUrl()}/reset-password?${params.toString()}`;
}

export function buildVerifyEmailUrl(input: {
  host: string | null | undefined;
  search: string;
}) {
  const params = new URLSearchParams(input.search);
  if (!params.get("client_id")) {
    params.set("client_id", resolveMigraAuthClientId(input.host));
  }
  return `${resolveMigraAuthBaseUrl()}/verify-email?${params.toString()}`;
}

export function buildCentralLogoutUrl() {
  return `${resolveMigraAuthBaseUrl()}/logout`;
}

export async function readOAuthCookies() {
  const store = await cookies();
  return {
    state: store.get(STATE_COOKIE)?.value || null,
    verifier: store.get(VERIFIER_COOKIE)?.value || null,
    clientId: store.get(CLIENT_COOKIE)?.value || null,
    redirectUri: store.get(REDIRECT_COOKIE)?.value || null,
    nextPath: store.get(NEXT_COOKIE)?.value || null,
  };
}

export function clearOAuthCookies(response: {
  cookies: {
    set: (
      name: string,
      value: string,
      options: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: "lax";
        path: string;
        expires: Date;
      },
    ) => void;
  };
}) {
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE, CLIENT_COOKIE, REDIRECT_COOKIE, NEXT_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
  }
}

export async function exchangeCodeForTokens(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}) {
  const response = await fetch(`${resolveMigraAuthBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: env.MIGRAAUTH_CLIENT_SECRET || undefined,
      code_verifier: input.codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error("MigraAuth token exchange failed.");
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: "Bearer";
    scope: string;
    id_token?: string;
  }>;
}

export async function fetchUserInfo(accessToken: string) {
  const response = await fetch(`${resolveMigraAuthBaseUrl()}/oauth/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("MigraAuth userinfo fetch failed.");
  }

  return response.json() as Promise<MigraAuthUserInfo>;
}
