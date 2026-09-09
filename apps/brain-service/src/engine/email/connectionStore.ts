/**
 * THE CONNECTION RECORD — what "your email is connected" durably means.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE RECORD NEVER HOLDS A TOKEN
 *
 * Not "must not be logged" — CANNOT be. Both token fields are `SealedValue`,
 * i.e. ciphertext, so `JSON.stringify(record)` is safe by construction rather
 * than by discipline. Plaintext exists only as the return value of `open()`,
 * inside the one function that needs it, and is never assigned back onto a
 * record.
 *
 * This is deliberate after a real defect in this module's sibling: the Gmail
 * adapter serialised its access token through `JSON.stringify`, because
 * TypeScript's `private` is compile-time only. A rule that depends on nobody
 * logging the wrong object is a rule that fails eventually.
 *
 * ---------------------------------------------------------------------------
 * 🚨 EVERY LOOKUP IS SCOPE-FIRST
 *
 * There is deliberately no `getByProviderAccountId`. A function that finds a
 * connection from a provider account id alone is all an attacker needs: pass
 * someone else's account id and read their mail. The scope always comes from
 * the authenticated session, and the account id — even when the browser sends
 * one back from a list WE rendered — only ever narrows within that scope.
 *
 * That is the storage-layer half of the boundary rule "the client never names
 * an account".
 *
 * ---------------------------------------------------------------------------
 * 🚨 REVOKED IS A STATE, NOT A DELETION
 *
 * When Google answers `invalid_grant`, the row stays. The row is what records
 * that the user DID connect, which is what makes the remedy "reconnect" rather
 * than "start from nothing" — and it is what a support conversation needs
 * three days later. Deleting it erases the distinction the whole state model
 * is built on. Only an explicit disconnect removes a row.
 */

import type { Scope } from '../memory/conversationStore.js';

import type { SealedValue } from './tokenSealing.js';
import type { EmailConnectionState, EmailScopes } from './types.js';
import { GOOGLE_SCOPES } from './oauthConfig.js';

export interface MailConnectionRecord {
  ownerScope: string;
  workspaceScope: string;
  /** Provider identity — a tiny fixed set, e.g. `gmail`. */
  provider: string;
  /** The provider's STABLE id. Not the address, which the user can change. */
  providerAccountId: string;
  /**
   * For display only. Recorded so the UI can say which account is connected
   * without another provider round-trip; never used to decide anything, since
   * an address can be reassigned to a different person.
   */
  accountAddress: string;
  sealedAccessToken: SealedValue;
  /** Sealed separately, with its own purpose, so the two cannot be swapped. */
  sealedRefreshToken: SealedValue;
  accessTokenExpiresAt: number;
  /** What Google ACTUALLY granted, which may be less than was requested. */
  grantedScopes: string[];
  /**
   * When the grant stopped working. Non-null means `authorization_expired` —
   * the row is retained precisely so this can be distinguished from never
   * having connected.
   */
  authorizationRevokedAt: number | null;
  connectedAt: number;
  lastRefreshAt: number | null;
  updatedAt: number;
}

/**
 * Why a grant could not be stored.
 *
 * `no_refresh_token` is the one worth explaining. The authorization URL always
 * asks for offline access and forces consent, so a grant without a refresh
 * token is anomalous — and storing it would create a connection that works for
 * an hour, then tells the user to reconnect, forever, with no explanation and
 * no way for them to tell it from a real revocation. Refusing at store time
 * turns a silent decay into one honest failure at the moment they acted.
 */
export type StoreRefusal =
  | { kind: 'no_refresh_token' }
  | { kind: 'no_usable_scope' };

export interface MailConnectionStore {
  /** Every connection this principal owns for a provider. Scope-first. */
  list(scope: Scope, provider: string): Promise<MailConnectionRecord[]>;
  /**
   * One connection. The account id NARROWS within the scope; it never
   * identifies a row on its own.
   */
  get(scope: Scope, provider: string, providerAccountId: string): Promise<MailConnectionRecord | null>;
  /** Insert or replace, keyed on scope + provider + account. */
  put(record: MailConnectionRecord): Promise<void>;
  /** Record a new access token after a refresh. Does not touch the refresh token. */
  recordRefresh(input: {
    scope: Scope;
    provider: string;
    providerAccountId: string;
    sealedAccessToken: SealedValue;
    accessTokenExpiresAt: number;
    at: number;
  }): Promise<void>;
  /** The grant stopped working. Keeps the row — see the header. */
  markAuthorizationRevoked(input: {
    scope: Scope;
    provider: string;
    providerAccountId: string;
    at: number;
  }): Promise<void>;
  /**
   * The user asked to disconnect. THIS is what removes a row, and it is the
   * only thing that does. Returns whether a row was actually removed, so a
   * caller can tell "disconnected" from "there was nothing to disconnect"
   * rather than reporting success for a no-op.
   */
  disconnect(scope: Scope, provider: string, providerAccountId: string): Promise<boolean>;
}

/** Reverse of GOOGLE_SCOPES: what a granted scope string permits. */
export function scopesFromGranted(granted: readonly string[]): EmailScopes {
  const has = (scope: string) => granted.includes(scope);
  return {
    read: has(GOOGLE_SCOPES.read),
    draft: has(GOOGLE_SCOPES.draft),
    send: has(GOOGLE_SCOPES.send),
  };
}

/**
 * Validate a grant before it is stored.
 *
 * Refuses rather than storing something that cannot work, so the failure
 * happens while the user is still looking at the screen they started from.
 */
export function refusalForGrant(input: {
  hasRefreshToken: boolean;
  grantedScopes: readonly string[];
}): StoreRefusal | null {
  if (!input.hasRefreshToken) return { kind: 'no_refresh_token' };
  const scopes = scopesFromGranted(input.grantedScopes);
  // A grant that permits nothing this product does is not a connection; it
  // would show as connected and then refuse every operation.
  if (!scopes.read && !scopes.draft && !scopes.send) return { kind: 'no_usable_scope' };
  return null;
}

/**
 * How a stored token opened. Kept separate from `EmailConnectionState` because
 * one of these outcomes must NOT reach the user as a reconnect prompt.
 */
export type SealOutcome = 'opened' | 'unreadable';

/**
 * Derive the user-facing connection state.
 *
 * 🚨 An expired ACCESS token is still `connected`. It is the ordinary state of
 * every connection older than an hour, and the refresh path exists to handle
 * it. Reporting it as expired authorization would tell users to reconnect a
 * working mailbox several times a day.
 *
 * 🚨 An unreadable seal is NOT `authorization_expired`, even though the row is
 * unusable. That state's remedy is "reconnect", and reconnecting would
 * overwrite a perfectly good row to work around a misconfigured key — after
 * which the evidence of what actually went wrong is gone. It surfaces as
 * provider unavailability, which is what the user experiences and whose remedy
 * is to wait, while the operator gets the real fact through telemetry.
 */
export function connectionStateFor(input: {
  record: MailConnectionRecord | null;
  providerConfigured: boolean;
  seal: SealOutcome;
}): EmailConnectionState {
  if (!input.providerConfigured) return 'not_configured';
  if (!input.record) return 'not_connected';
  if (input.record.authorizationRevokedAt !== null) return 'authorization_expired';
  if (input.seal === 'unreadable') return 'provider_unavailable';
  return 'connected';
}

/** Whether the stored access token needs refreshing before use. */
export function accessTokenExpired(record: MailConnectionRecord, now: number, skewMs = 60_000): boolean {
  // Refreshed slightly early: a token that expires mid-request fails the
  // request rather than the check, and the retry looks like a provider fault.
  return record.accessTokenExpiresAt - skewMs <= now;
}

/** What a user is told. Engine-owned; no provider vocabulary, no values. */
export function storeRefusalMessage(refusal: StoreRefusal): string {
  switch (refusal.kind) {
    case 'no_refresh_token':
      return 'Your email account could not be connected. Try connecting it again.';
    case 'no_usable_scope':
      return 'Your email account was connected without permission to read mail. Try again and allow access.';
  }
}
