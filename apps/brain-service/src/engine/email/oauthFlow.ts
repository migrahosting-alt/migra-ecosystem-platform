/**
 * THE OAUTH FLOW — begin, and the callback that completes it.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT `state` ACTUALLY DEFENDS AGAINST
 *
 * Not "CSRF" in the abstract. The concrete attack: someone gets a victim's
 * browser to complete an OAuth callback carrying the ATTACKER'S authorization
 * code. If the callback accepts it, the victim's Migra account is now
 * connected to the attacker's mailbox — and everything the victim then asks
 * about "my email" reads the attacker's inbox, while anything drafted goes out
 * from it.
 *
 * So `state` is minted per attempt, bound to the principal who began the flow,
 * single-use, and expiring. A callback whose state is unknown, already used,
 * expired, or belongs to a different principal is refused before the code is
 * exchanged for anything.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE CODE EXCHANGE IS SERVER-SIDE, ALWAYS
 *
 * The client secret is in it. A browser-side exchange would put the secret in
 * a bundle, and the refresh token in a place JavaScript can read — both of
 * which the boundary forbids for the same reason: those two values are the
 * whole of the account's security.
 *
 * ---------------------------------------------------------------------------
 * ERRORS NAME A CLASS, NEVER A VALUE
 *
 * No error here carries a code, a token, a state value or Google's own message.
 * They travel through logs and into UI, and one of them is a bearer credential.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { GOOGLE_SCOPES, IDENTITY_SCOPES, type GrantKind, type OAuthConfig } from './oauthConfig.js';

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** How long an unfinished attempt stays valid. */
export const STATE_TTL_MS = 10 * 60_000;

export interface PendingAuthorization {
  /** Opaque, unguessable, single-use. */
  state: string;
  /** The Migra principal that began this flow. The callback must match it. */
  ownerScope: string;
  grants: GrantKind[];
  createdAt: number;
  /** Where to send the user afterwards. Validated as a same-site path. */
  returnTo: string;
}

export type CallbackRefusal =
  | { kind: 'state_unknown' }
  | { kind: 'state_expired' }
  | { kind: 'state_replayed' }
  | { kind: 'principal_mismatch' }
  | { kind: 'user_declined' }
  | { kind: 'provider_error' }
  | { kind: 'exchange_failed' }
  /**
   * The code exchanged, but Google would not say whose mailbox it opens.
   *
   * Distinct from `exchange_failed`: the grant is real and may even be usable,
   * and the operator's remedy is a missing identity scope rather than anything
   * the user did. It escaped as an UNHANDLED 500 until a revoked grant stopped
   * carrying `openid`/`email` for free.
   */
  | { kind: 'identify_failed' };

export interface TokenGrant {
  accessToken: string;
  /** Absent when Google does not issue one — see `beginAuthorization`. */
  refreshToken?: string;
  expiresAt: number;
  /** What Google ACTUALLY granted, which may be less than was asked for. */
  grantedScopes: string[];
}

/**
 * Build the URL a user is sent to.
 *
 * `access_type=offline` + `prompt=consent` are both required to receive a
 * refresh token. Google issues one only on the FIRST consent for a
 * client/user pair, so an account reconnecting after a revoke would otherwise
 * come back with an access token that expires in an hour and no way to renew —
 * a connection that silently dies and looks like a bug.
 */
export function authorizationUrl(input: {
  config: OAuthConfig;
  state: string;
  grants: readonly GrantKind[];
  /** Pre-fills the chooser. A hint only; the user may pick another account. */
  loginHint?: string;
}): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.config.redirectUri);
  url.searchParams.set('response_type', 'code');
  /*
   * Mailbox authority PLUS the identity scopes the completion step depends on.
   * Asking for identity here is what stops a consent that succeeds from
   * producing a connection we cannot name — see IDENTITY_SCOPES.
   */
  url.searchParams.set(
    'scope',
    [...new Set([...input.grants.map((g) => GOOGLE_SCOPES[g]), ...IDENTITY_SCOPES])].sort().join(' '),
  );
  url.searchParams.set('state', input.state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  /*
   * Ask Google to include previously granted scopes, so adding `send` later
   * does not silently drop `read` — a partial grant that would leave a working
   * connection unable to do what it did yesterday.
   */
  url.searchParams.set('include_granted_scopes', 'true');
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
  return url.toString();
}

/** A fresh, unguessable state value. */
export function mintState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compare two state values without leaking timing.
 *
 * A length-varying comparison would let an attacker discover a valid state one
 * character at a time. Both sides are hashed first so the comparison is over
 * fixed-length buffers regardless of input length.
 */
export function stateMatches(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/** Only a same-site PATH. An absolute URL here is an open redirect. */
export function safeReturnTo(raw: string | undefined): string {
  if (!raw) return '/';
  // Must start with a single slash. `//evil.com` is protocol-relative and
  // would send the user off-site after a successful connection.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  try {
    // Reject anything that parses as absolute despite the leading slash.
    if (new URL(raw, 'https://placeholder.invalid').origin !== 'https://placeholder.invalid') return '/';
  } catch {
    return '/';
  }
  return raw;
}

export interface CallbackDeps {
  /** The pending attempt for this state, or null. Consumed by the caller. */
  takePending(state: string): Promise<PendingAuthorization | null>;
  /** Exchange the code. Server-side; carries the client secret. */
  exchange(code: string): Promise<TokenGrant>;
  now(): number;
}

/**
 * Complete a callback, or refuse.
 *
 * The order is deliberate: everything that can be checked WITHOUT contacting
 * Google is checked first, so a replayed or forged callback costs nothing and
 * reveals nothing.
 */
export async function completeCallback(input: {
  state: string | undefined;
  code: string | undefined;
  /** Google's own `error` parameter, when the user declined. */
  error: string | undefined;
  /** The principal making the callback request, from their session. */
  ownerScope: string;
  deps: CallbackDeps;
}): Promise<
  | { ok: true; grant: TokenGrant; pending: PendingAuthorization }
  | { ok: false; refusal: CallbackRefusal }
> {
  const { deps } = input;

  if (input.error) {
    /*
     * `access_denied` is the user pressing Cancel — an ordinary outcome, not a
     * fault, and it must not be reported as one. Any other error is Google's
     * and is not passed through.
     */
    return {
      ok: false,
      refusal: { kind: input.error === 'access_denied' ? 'user_declined' : 'provider_error' },
    };
  }

  if (!input.state || !input.code) return { ok: false, refusal: { kind: 'state_unknown' } };

  const pending = await deps.takePending(input.state);
  // Taken, not read: a second callback with the same state finds nothing, which
  // is what makes it single-use.
  if (!pending) return { ok: false, refusal: { kind: 'state_replayed' } };

  if (!stateMatches(pending.state, input.state)) {
    return { ok: false, refusal: { kind: 'state_unknown' } };
  }
  if (deps.now() - pending.createdAt > STATE_TTL_MS) {
    return { ok: false, refusal: { kind: 'state_expired' } };
  }

  /*
   * 🚨 THE CHECK THAT STOPS A MAILBOX BEING GRAFTED ONTO SOMEONE ELSE.
   *
   * The flow was begun by one principal; the callback arrives in some session.
   * If they differ, a victim's account is about to be connected to whoever
   * started the flow — so the code is never exchanged.
   */
  if (pending.ownerScope !== input.ownerScope) {
    return { ok: false, refusal: { kind: 'principal_mismatch' } };
  }

  try {
    const grant = await deps.exchange(input.code);
    return { ok: true, grant, pending };
  } catch {
    // The exception may carry the code or Google's response body. Neither is
    // propagated.
    return { ok: false, refusal: { kind: 'exchange_failed' } };
  }
}

/** The body of a token exchange. Kept here so the secret has one call site. */
export function tokenRequestBody(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): URLSearchParams {
  return new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });
}

export function refreshRequestBody(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  return new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
  });
}

export const TOKEN_ENDPOINT_URL = TOKEN_ENDPOINT;

/** What a user is told. Engine-owned; no Google vocabulary, no values. */
export function callbackRefusalMessage(refusal: CallbackRefusal): string {
  switch (refusal.kind) {
    case 'user_declined':
      return 'Connecting your email was cancelled.';
    case 'state_expired':
      return 'That took too long. Start connecting your email again.';
    case 'state_replayed':
    case 'state_unknown':
    case 'principal_mismatch':
      /*
       * Deliberately one message for three refusals. Distinguishing them would
       * tell whoever sent a forged callback which check they failed, which is
       * a probing oracle. The engineering trace keeps them separate.
       */
      return 'That connection request is not valid. Start connecting your email again.';
    case 'provider_error':
    case 'exchange_failed':
      return 'Your email account could not be connected. Try again shortly.';
    case 'identify_failed':
      /*
       * The same sentence as a failed exchange, on purpose. To the user both
       * are "it did not connect, try again"; the difference is an OPERATOR's
       * fact — a missing identity scope — and it belongs in telemetry, not in
       * a message that would send someone hunting through Google's settings.
       */
      return 'Your email account could not be connected. Try again shortly.';
  }
}
