import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getAuthClientConfig } from "./config";

const STATE_COOKIE = "ma_state";
const VERIFIER_COOKIE = "ma_verifier";

function base64url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function secureCookies(appBaseUrl: string) {
  return appBaseUrl.startsWith("https://") || process.env.NODE_ENV === "production";
}

function makeState() {
  return base64url(crypto.randomBytes(32));
}

function makeVerifier() {
  return base64url(crypto.randomBytes(48));
}

function makeChallenge(verifier: string) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

async function setPkceCookies(state: string, verifier: string) {
  const cfg = getAuthClientConfig();
  const store = await cookies();
  const secure = secureCookies(cfg.appBaseUrl);

  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });

  store.set(VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });
}

function buildAuthorizationParams() {
  const cfg = getAuthClientConfig();
  const state = makeState();
  const verifier = makeVerifier();
  const challenge = makeChallenge(verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  return { state, verifier, params };
}

export async function buildLoginRedirect() {
  const cfg = getAuthClientConfig();
  const { state, verifier, params } = buildAuthorizationParams();

  await setPkceCookies(state, verifier);

  return `${cfg.migraAuthBaseUrl}/authorize?${params.toString()}`;
}

export async function buildSignupRedirect() {
  const cfg = getAuthClientConfig();
  const { state, verifier, params } = buildAuthorizationParams();

  await setPkceCookies(state, verifier);

  return `${cfg.migraAuthWebUrl ?? cfg.migraAuthBaseUrl}/signup?${params.toString()}`;
}

export function buildLogoutRedirect() {
  const cfg = getAuthClientConfig();
  const target = new URL("/logout", cfg.migraAuthWebUrl ?? cfg.migraAuthBaseUrl);

  if (cfg.postLogoutRedirectUri) {
    target.searchParams.set("return_to", cfg.postLogoutRedirectUri);
  }

  return target.toString();
}

export async function clearPkceCookies() {
  const store = await cookies();
  store.delete(STATE_COOKIE);
  store.delete(VERIFIER_COOKIE);
}

export async function getPkceCookies() {
  const store = await cookies();

  return {
    state: store.get(STATE_COOKIE)?.value ?? null,
    verifier: store.get(VERIFIER_COOKIE)?.value ?? null,
  };
}

export async function exchangeCode(code: string, codeVerifier: string) {
  const cfg = getAuthClientConfig();

  const res = await fetch(`${cfg.migraAuthBaseUrl}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    throw new Error("Token exchange failed");
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: "Bearer";
    scope: string;
    id_token?: string;
  }>;
}

export async function fetchUserInfo(accessToken: string) {
  const cfg = getAuthClientConfig();

  const res = await fetch(`${cfg.migraAuthBaseUrl}/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Userinfo lookup failed");
  }

  return res.json() as Promise<{
    sub: string;
    email: string;
    name?: string;
    email_verified?: boolean;
    given_name?: string;
    family_name?: string;
  }>;
}
