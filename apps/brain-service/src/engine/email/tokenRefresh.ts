/**
 * RESOLVING A USABLE ACCESS TOKEN — refresh, and what each failure MEANS.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DISTINCTION THIS FILE EXISTS TO PROTECT
 *
 * Three things look alike at the call site and must never be collapsed:
 *
 * - An EXPIRED ACCESS TOKEN is ordinary. Every connection older than an hour
 *   is in this state. Refresh and continue; the user is told nothing, because
 *   nothing happened.
 * - A REVOKED GRANT means the user withdrew access in their Google account.
 *   The remedy is to reconnect, and only the user can do it.
 * - PROVIDER UNAVAILABLE means Google is down, slow, or the network failed.
 *   The remedy is to wait. Nothing is wrong with the grant.
 *
 * 🚨 The dangerous collapse is the third into the second. A 500 or a timeout
 * classified as revocation marks a perfectly good connection as expired and
 * tells the user to reconnect — during an outage, for every connected user at
 * once. They would reconnect, which cannot work while Google is down, and the
 * support load would arrive at exactly the moment the system is least able to
 * absorb it. So ONLY an explicit `invalid_grant` marks a grant revoked.
 *
 * ---------------------------------------------------------------------------
 * 🚨 REVOCATION IS STICKY, DELIBERATELY
 *
 * Once a grant is marked revoked, no further refresh is attempted until the
 * user reconnects. Retrying would send a known-dead refresh token to Google on
 * every single request the user makes — pointless, and the fastest way to earn
 * a rate limit that then breaks the users whose grants DO work.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE REFRESH TOKEN NEVER LEAVES THIS PROCESS
 *
 * It is opened here, handed to the exchange, and dropped. It is never
 * returned, never logged, never attached to a failure, and never assigned back
 * onto a record — the record's token fields are ciphertext by type, so there is
 * nowhere on it that a plaintext token could go.
 */

import type { Scope } from '../memory/conversationStore.js';

import {
  accessTokenExpired,
  scopesFromGranted,
  type MailConnectionRecord,
  type MailConnectionStore,
} from './connectionStore.js';
import { open, seal, type SealKey } from './tokenSealing.js';
import type { EmailFailure, EmailScopes } from './types.js';

/**
 * What a refresh attempt produced.
 *
 * A discriminated result rather than an exception, because the difference
 * between `invalid_grant` and `unavailable` is the entire point of this file,
 * and a thrown error would let a caller collapse them with one catch.
 */
export type RefreshOutcome =
  | { kind: 'refreshed'; accessToken: string; expiresAt: number; grantedScopes?: string[] }
  /** Google said the grant is dead: revoked by the user, or aged out. */
  | { kind: 'invalid_grant' }
  /** Network, timeout, 5xx. The grant is not implicated. */
  | { kind: 'unavailable' };

export interface RefreshDeps {
  store: MailConnectionStore;
  key: SealKey;
  /** Server-side; carries the client secret. Never reachable from a browser. */
  exchangeRefresh(refreshToken: string): Promise<RefreshOutcome>;
  now(): number;
}

/** A usable token, and what the grant actually permits. */
export interface ResolvedAuthorization {
  accessToken: string;
  scopes: EmailScopes;
  providerAccountId: string;
  accountAddress: string;
}

type Resolution =
  | { ok: true; value: ResolvedAuthorization }
  | { ok: false; failure: EmailFailure };

/*
 * Single-flight, per connection.
 *
 * Without it, a question that fans out into several mail calls refreshes
 * several times at once. Google tolerates that, but it doubles the request
 * rate for no benefit and each result races to be the one persisted.
 *
 * 🚨 Honest about its limit: this is PER PROCESS. Two Brain instances can still
 * refresh the same connection concurrently, and that is acceptable — Google
 * does not invalidate the previous access token on refresh, so the loser of the
 * race persists a token that is merely older, not broken. It would not be
 * acceptable if the race could produce an unusable connection, and it cannot.
 */
const inFlight = new Map<string, Promise<Resolution>>();

function connectionKey(scope: Scope, provider: string, providerAccountId: string): string {
  return `${scope.owner} ${scope.workspace} ${provider} ${providerAccountId}`;
}

/**
 * Resolve an access token for a connection, refreshing if necessary.
 *
 * 🚨 Callers pass a scope from the authenticated session and an account id that
 * NARROWS within it. There is no path here that finds a connection from an
 * account id alone.
 */
export async function resolveAuthorization(input: {
  scope: Scope;
  provider: string;
  providerAccountId: string;
  deps: RefreshDeps;
}): Promise<Resolution> {
  const key = connectionKey(input.scope, input.provider, input.providerAccountId);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const attempt = resolveOnce(input).finally(() => inFlight.delete(key));
  inFlight.set(key, attempt);
  return attempt;
}

async function resolveOnce(input: {
  scope: Scope;
  provider: string;
  providerAccountId: string;
  deps: RefreshDeps;
}): Promise<Resolution> {
  const { deps } = input;
  const record = await deps.store.get(input.scope, input.provider, input.providerAccountId);
  if (!record) {
    return { ok: false, failure: { kind: 'not_connected', detail: 'Email is not connected yet.' } };
  }

  // Sticky: a known-dead grant is not re-tried against Google on every request.
  if (record.authorizationRevokedAt !== null) {
    return { ok: false, failure: expiredFailure() };
  }

  if (!accessTokenExpired(record, deps.now())) {
    const opened = open(deps.key, sealBinding(record, 'access_token'), record.sealedAccessToken);
    if (!opened.ok) return { ok: false, failure: unreadableFailure() };
    return { ok: true, value: resolved(record, opened.value) };
  }

  return refresh(record, input.scope, deps);
}

async function refresh(
  record: MailConnectionRecord,
  scope: Scope,
  deps: RefreshDeps,
): Promise<Resolution> {
  const openedRefresh = open(deps.key, sealBinding(record, 'refresh_token'), record.sealedRefreshToken);
  if (!openedRefresh.ok) {
    /*
     * 🚨 NOT marked revoked. An unopenable seal means the key is wrong or the
     * row was tampered with — a deployment problem. Marking it revoked would
     * tell the user to reconnect, and reconnecting would overwrite the row,
     * destroying the evidence of what actually went wrong.
     */
    return { ok: false, failure: unreadableFailure() };
  }

  const outcome = await deps.exchangeRefresh(openedRefresh.value);

  if (outcome.kind === 'unavailable') {
    /*
     * 🚨 THE GRANT IS NOT IMPLICATED. Marking it revoked here would, during a
     * Google outage, tell every connected user to reconnect — which cannot
     * work while Google is down.
     */
    return { ok: false, failure: { kind: 'provider_unavailable', detail: 'Email is unavailable right now.' } };
  }

  if (outcome.kind === 'invalid_grant') {
    // The ONLY thing that marks a grant revoked. The row is retained.
    await deps.store.markAuthorizationRevoked({
      scope,
      provider: record.provider,
      providerAccountId: record.providerAccountId,
      at: deps.now(),
    });
    return { ok: false, failure: expiredFailure() };
  }

  await deps.store.recordRefresh({
    scope,
    provider: record.provider,
    providerAccountId: record.providerAccountId,
    sealedAccessToken: seal(deps.key, sealBinding(record, 'access_token'), outcome.accessToken),
    accessTokenExpiresAt: outcome.expiresAt,
    at: deps.now(),
  });

  /*
   * Scopes come from the refreshed grant when Google states them, and from the
   * stored grant otherwise. Google may return a NARROWER set than before if the
   * user has adjusted permissions, and keeping the stored value in that case
   * would promise a send that is refused at dispatch.
   */
  const grantedScopes = outcome.grantedScopes ?? record.grantedScopes;
  return { ok: true, value: resolved({ ...record, grantedScopes }, outcome.accessToken) };
}

function sealBinding(record: MailConnectionRecord, purpose: 'access_token' | 'refresh_token') {
  return {
    ownerScope: record.ownerScope,
    workspaceScope: record.workspaceScope,
    provider: record.provider,
    providerAccountId: record.providerAccountId,
    purpose,
  } as const;
}

function resolved(record: MailConnectionRecord, accessToken: string): ResolvedAuthorization {
  return {
    accessToken,
    scopes: scopesFromGranted(record.grantedScopes),
    providerAccountId: record.providerAccountId,
    accountAddress: record.accountAddress,
  };
}

function expiredFailure(): EmailFailure {
  return { kind: 'authorization_expired', detail: 'Your email account needs reconnecting.' };
}

/** A deployment fault, told to the user as unavailability — never as reconnect. */
function unreadableFailure(): EmailFailure {
  return { kind: 'provider_unavailable', detail: 'Email is unavailable right now.' };
}

/**
 * Check ONE operation's scope, separately from the others.
 *
 * 🚨 Read, draft and send are resolved independently because a user may
 * reasonably connect for reading only. A single `authorized` boolean would
 * either hide working search or promise a send that is refused at dispatch —
 * and the second is worse, because the user learns about it after composing.
 */
export function requireScope(
  authorization: ResolvedAuthorization,
  needed: keyof EmailScopes,
): { ok: true } | { ok: false; failure: EmailFailure } {
  if (authorization.scopes[needed]) return { ok: true };
  return { ok: false, failure: { kind: 'insufficient_scope', needed } };
}

/** Test seam only: the single-flight table is process-global. */
export function __resetInFlightForTest(): void {
  inFlight.clear();
}
