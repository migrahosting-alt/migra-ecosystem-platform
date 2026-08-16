import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getAuthClientConfig } from "./config";

const LEGACY_STATE_COOKIE = "ma_state";
const LEGACY_VERIFIER_COOKIE = "ma_verifier";
const PKCE_COOKIE_PREFIX = "ma_pkce_";
const PKCE_COOKIE_TTL_SECONDS = 10 * 60;

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
  const transactionCookie = `${secure ? "__Host-" : ""}${PKCE_COOKIE_PREFIX}${state}`;

  // Key the verifier by OAuth state so prefetches, double-clicks, or another
  // login tab cannot overwrite the transaction that is currently returning.
  store.set(transactionCookie, verifier, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: PKCE_COOKIE_TTL_SECONDS,
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

  // Browser navigation must use the public auth origin. Server-side token,
  // userinfo, and bootstrap requests may use a private app-core endpoint.
  return `${cfg.migraAuthWebUrl ?? cfg.migraAuthBaseUrl}/authorize?${params.toString()}`;
}

export async function buildSignupRedirect() {
  const cfg = getAuthClientConfig();
  const { state, verifier, params } = buildAuthorizationParams();

  await setPkceCookies(state, verifier);

  return `${cfg.migraAuthWebUrl ?? cfg.migraAuthBaseUrl}/signup?${params.toString()}`;
}

/**
 * Where to send the browser to end the session at the issuer.
 *
 * The post-logout target is sent as `post_logout_redirect_uri` — the OIDC
 * standard name, and the one MigraAuth's logout page actually reads
 * (`apps/auth-web/src/app/logout/page.tsx`).
 *
 * It used to be sent as `return_to` only. Nothing read that on this path, so
 * every product fell through to `resolveProductHomeUrl(clientId)` instead: a
 * user who signed out of MigraPilot was handed to migrateck.com, a different
 * product, with no way back. `return_to` is still sent because the
 * authorize→login path does read it (`apps/auth-api/src/routes/oauth.ts`), and
 * an unread parameter costs nothing.
 *
 * `client_id` goes along so the issuer can brand the sign-out screen as the
 * product being left, and so a future `validatePostLogoutUri` has the client to
 * validate against — see the note in the consumer's logout route about that
 * validation existing but never being called.
 */
export function buildLogoutRedirect() {
  const cfg = getAuthClientConfig();
  const target = new URL("/logout", cfg.migraAuthWebUrl ?? cfg.migraAuthBaseUrl);

  if (cfg.clientId) {
    target.searchParams.set("client_id", cfg.clientId);
  }

  if (cfg.postLogoutRedirectUri) {
    target.searchParams.set("post_logout_redirect_uri", cfg.postLogoutRedirectUri);
    target.searchParams.set("return_to", cfg.postLogoutRedirectUri);
  }

  return target.toString();
}

export async function clearPkceCookies(state?: string) {
  const cfg = getAuthClientConfig();
  const store = await cookies();
  const secure = secureCookies(cfg.appBaseUrl);

  if (state) {
    store.delete(`${secure ? "__Host-" : ""}${PKCE_COOKIE_PREFIX}${state}`);
  }

  // Remove cookies used by the original single-transaction implementation.
  store.delete(LEGACY_STATE_COOKIE);
  store.delete(LEGACY_VERIFIER_COOKIE);
}

export async function getPkceCookies(expectedState: string) {
  const cfg = getAuthClientConfig();
  const store = await cookies();
  const secure = secureCookies(cfg.appBaseUrl);
  const verifier = store.get(
    `${secure ? "__Host-" : ""}${PKCE_COOKIE_PREFIX}${expectedState}`,
  )?.value;

  if (verifier) {
    return { state: expectedState, verifier };
  }

  // Permit a callback initiated immediately before this release to finish.
  return {
    state: store.get(LEGACY_STATE_COOKIE)?.value ?? null,
    verifier: store.get(LEGACY_VERIFIER_COOKIE)?.value ?? null,
  };
}

/**
 * The origin for back-channel calls this server makes itself.
 *
 * Distinct from `migraAuthBaseUrl`, which is where the BROWSER is sent. A
 * deployment can reach the issuer on one path and not the other; see the
 * `migraAuthApiUrl` note in `./types.ts`.
 */
function apiOrigin() {
  const cfg = getAuthClientConfig();
  return cfg.migraAuthApiUrl ?? cfg.migraAuthBaseUrl;
}

/**
 * A diagnosable one-line reason for a rejected back-channel call.
 *
 * "Token exchange failed" with no status was genuinely undiagnosable: a
 * hairpinned connection, a revoked client and a replayed code all produced the
 * identical string, and the consumer's callback discarded even that. Only the
 * status and the issuer's OAuth error code are included — never a token, never
 * the raw body, which on some error paths echoes request material back.
 */
async function describeFailure(res: Response) {
  let code = "";
  try {
    const body = (await res.json()) as { error?: unknown; error_description?: unknown };
    const parts = [body?.error, body?.error_description]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .map((part) => part.slice(0, 200));
    code = parts.join(" — ");
  } catch {
    // A non-JSON body (an HTML error page from a proxy, say) is itself a
    // useful signal, but its content is not safe to relay.
    code = "non-JSON body";
  }
  return `HTTP ${res.status}${code ? ` (${code})` : ""}`;
}

export async function exchangeCode(code: string, codeVerifier: string) {
  const cfg = getAuthClientConfig();

  const res = await fetch(`${apiOrigin()}/token`, {
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
    throw new Error(`Token exchange failed: ${await describeFailure(res)}`);
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
  const res = await fetch(`${apiOrigin()}/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Userinfo lookup failed: ${await describeFailure(res)}`);
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
