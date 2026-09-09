/**
 * TALKING TO GOOGLE — the exchange, the refresh, the identity, the revoke.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE ONLY PLACE THE CLIENT SECRET IS USED
 *
 * It is read from the environment at the call, passed straight into a request
 * body, and never stored on an object, returned, logged, or attached to an
 * error. Nothing here puts a Google response body into a thrown message either:
 * a token endpoint's error body routinely echoes the request, which contains
 * both the authorization code and the secret.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A FAILURE'S CLASS IS DECIDED HERE, AND IT MATTERS MORE THAN IT LOOKS
 *
 * `invalid_grant` means the user revoked access, and its remedy is "reconnect".
 * Everything else — a 500, a timeout, a DNS failure — means Google is having a
 * bad day, and its remedy is to wait.
 *
 * Classifying the second as the first would, during a Google outage, mark every
 * connected user's grant as revoked and tell them all to reconnect, which
 * cannot work while Google is down. So the classification reads the documented
 * `error` field and treats everything it does not recognise as unavailability —
 * failing towards "try again" rather than towards "your connection is dead".
 */

import { GOOGLE_SCOPES, type GrantKind, type OAuthConfig } from './oauthConfig.js';
import { refreshRequestBody, tokenRequestBody, TOKEN_ENDPOINT_URL, type TokenGrant } from './oauthFlow.js';
import type { ProviderIdentity } from './connectionService.js';
import type { RefreshOutcome } from './tokenRefresh.js';

const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Bounded so a hung provider cannot hold a request open indefinitely. */
export const GOOGLE_TIMEOUT_MS = 15_000;

export interface GoogleClientDeps {
  config: OAuthConfig;
  /** Read at the call, never held. */
  clientSecret(): string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

/**
 * A scope string Google returned, mapped back to what we asked for.
 *
 * Unknown scopes are DROPPED rather than carried through: `grantedScopes` is
 * read to decide what the product may do, and an unrecognised string there
 * would be dead weight at best and a false permission at worst.
 */
export function knownScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  const permitted = new Set<string>(Object.values(GOOGLE_SCOPES));
  return scope.split(/\s+/).filter((s) => permitted.has(s));
}

async function post(
  url: string,
  body: URLSearchParams,
  deps: GoogleClientDeps,
): Promise<{ status: number; json: TokenResponse } | { status: 0; json: Record<string, never> }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      redirect: 'error',
    });
    const json = (await response.json().catch(() => ({}))) as TokenResponse;
    return { status: response.status, json };
  } catch {
    /*
     * The exception is swallowed rather than wrapped. A fetch error can carry
     * the request — including the body, which holds the client secret and the
     * authorization code. Status 0 means "we never got an answer", which is all
     * the caller needs to classify it as unavailability.
     */
    return { status: 0, json: {} };
  }
}

/** Exchange an authorization code. Throws on failure, carrying no detail. */
export async function exchangeCode(code: string, deps: GoogleClientDeps): Promise<TokenGrant> {
  const secret = deps.clientSecret();
  if (!secret) throw new Error('email oauth is not configured');

  const { status, json } = await post(
    TOKEN_ENDPOINT_URL,
    tokenRequestBody({
      code,
      clientId: deps.config.clientId,
      clientSecret: secret,
      redirectUri: deps.config.redirectUri,
    }),
    deps,
  );

  if (status !== 200 || !json.access_token) {
    // No status, no body, no Google message. The caller turns this into
    // `exchange_failed`, which is all a user should ever see.
    throw new Error('email authorization could not be completed');
  }

  const now = (deps.now ?? Date.now)();
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    // `expires_in` is seconds from now. A missing value is treated as already
    // expired rather than as forever: the refresh path is correct, and an
    // eternal token would never be renewed and would fail mid-request.
    expiresAt: now + (typeof json.expires_in === 'number' ? json.expires_in * 1000 : 0),
    grantedScopes: knownScopes(json.scope),
  };
}

/**
 * Refresh an access token, classifying the outcome.
 *
 * Returns rather than throws, because the difference between a dead grant and
 * a bad day is the whole point and an exception invites one catch for both.
 */
export async function refreshAccessToken(refreshToken: string, deps: GoogleClientDeps): Promise<RefreshOutcome> {
  const secret = deps.clientSecret();
  if (!secret) return { kind: 'unavailable' };

  const { status, json } = await post(
    TOKEN_ENDPOINT_URL,
    refreshRequestBody({ refreshToken, clientId: deps.config.clientId, clientSecret: secret }),
    deps,
  );

  if (status === 200 && json.access_token) {
    const now = (deps.now ?? Date.now)();
    const granted = knownScopes(json.scope);
    return {
      kind: 'refreshed',
      accessToken: json.access_token,
      expiresAt: now + (typeof json.expires_in === 'number' ? json.expires_in * 1000 : 0),
      // Omitted entirely when Google says nothing, so the stored grant stands.
      // An empty array here would read as "everything was withdrawn" and break
      // every connection on its first refresh.
      ...(json.scope ? { grantedScopes: granted } : {}),
    };
  }

  /*
   * 🚨 ONLY the documented value marks a grant dead. Google returns
   * `invalid_grant` with a 400 when the user has revoked access or the token
   * aged out. Anything else — including a 400 we do not recognise — is treated
   * as unavailability, because the cost of being wrong runs one way: a
   * misclassified outage tells every user to reconnect during the one period
   * when reconnecting cannot work.
   */
  if (json.error === 'invalid_grant') return { kind: 'invalid_grant' };
  return { kind: 'unavailable' };
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
}

/**
 * Ask Google whose mailbox a token opens.
 *
 * `sub` is the stable account identifier and is what the connection is keyed
 * on. `email` is display only — a Google account's address can be changed, and
 * keying on it would silently rebind a connection to a different person.
 */
export async function identifyAccount(accessToken: string, deps: GoogleClientDeps): Promise<ProviderIdentity> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let json: UserInfoResponse;
  try {
    const response = await fetchImpl(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('identity lookup failed');
    json = (await response.json()) as UserInfoResponse;
  } catch {
    throw new Error('the connected account could not be identified');
  }

  if (!json.sub) {
    /*
     * Refused rather than substituted. Falling back to the email address as an
     * identifier would key the connection on a value the user can change, and
     * the failure would appear months later as a mailbox bound to the wrong
     * person.
     */
    throw new Error('the connected account could not be identified');
  }
  return { providerAccountId: json.sub, accountAddress: json.email ?? '' };
}

/**
 * Withdraw the grant at Google.
 *
 * Returns whether it was confirmed. Never throws: the caller deletes our stored
 * authorization either way, and a thrown error here would leave a row the user
 * asked to remove.
 */
export async function revokeGrant(refreshToken: string, deps: GoogleClientDeps): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      redirect: 'error',
    });
    /*
     * Google answers 200 for a successful revocation and 400 for a token it
     * does not recognise. A 400 is treated as CONFIRMED: an unknown token
     * cannot open anything, which is exactly the state revocation is for.
     */
    return response.status === 200 || response.status === 400;
  } catch {
    return false;
  }
}

/** The grants a connection request may ask for. Read first, always. */
export const DEFAULT_GRANTS: readonly GrantKind[] = Object.freeze(['read']);
