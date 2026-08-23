/**
 * One in-flight provider sign-in, held server-side and spent exactly once.
 *
 * WHY THE SERVER HOLDS IT. The PKCE verifier cannot travel in the browser — a
 * verifier the client can read is a verifier an attacker can read, which is the
 * entire attack PKCE exists to stop. And `return_to` cannot travel in the URL,
 * because a destination an attacker can set is an open redirect wearing this
 * domain's name.
 *
 * WHY CONSUMED ROWS ARE KEPT. Deleting on use makes a replayed `state`
 * indistinguishable from an expired or invented one, and they are different
 * facts: the first means someone is re-submitting a captured callback, and it
 * is worth refusing loudly and auditing. Retained-and-marked lets the check
 * answer "already used" instead of "never existed".
 */

import { randomBytes, createHash } from "node:crypto";
import { db } from "../../lib/db.js";
import type { IdentityProvider } from "../../prisma-client.js";
import type { LinkMode } from "./linking.js";

/** Long enough that guessing is not a strategy. */
const STATE_BYTES = 32;
/** A sign-in someone walked away from should not stay valid all day. */
const STATE_TTL_MS = 10 * 60_000;

export interface CreatedState {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
}

const b64url = (buffer: Buffer): string => buffer.toString("base64url");

export async function createLoginState(input: {
  provider: IdentityProvider;
  mode: LinkMode;
  returnTo: string;
  /** The authorization request this trip interrupts, when there is one. */
  transactionId?: string | null;
  linkUserId?: string | null;
  ip?: string;
  userAgent?: string;
  now?: Date;
}): Promise<CreatedState> {
  const state = b64url(randomBytes(STATE_BYTES));
  const codeVerifier = b64url(randomBytes(STATE_BYTES));
  const nonce = b64url(randomBytes(16));
  const now = input.now ?? new Date();

  await db.socialLoginState.create({
    data: {
      state,
      provider: input.provider,
      mode: input.mode,
      codeVerifier,
      nonce,
      returnTo: input.returnTo,
      transactionId: input.transactionId ?? null,
      linkUserId: input.linkUserId ?? null,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    },
  });

  return {
    state,
    codeVerifier,
    // S256, always. The `plain` method offers no protection over sending the
    // verifier itself, and every provider that supports PKCE supports S256.
    codeChallenge: b64url(createHash("sha256").update(codeVerifier).digest()),
    nonce,
  };
}

export type StateOutcome =
  | { ok: true; state: ConsumedState }
  | { ok: false; reason: "unknown" | "replayed" | "expired" | "provider_mismatch" };

export interface ConsumedState {
  state: string;
  provider: IdentityProvider;
  mode: LinkMode;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  transactionId: string | null;
  linkUserId: string | null;
}

/**
 * Spend a state, or say precisely why it cannot be spent.
 *
 * The consume is a CONDITIONAL UPDATE rather than a read-then-write: two
 * callbacks arriving together — a double-submitted callback URL, a retried
 * request — would both pass a read and both proceed, which is the replay this
 * is here to prevent. Only one `updateMany` can match `consumedAt: null`.
 */
export async function consumeLoginState(input: {
  state: string;
  provider: IdentityProvider;
  now?: Date;
}): Promise<StateOutcome> {
  const now = input.now ?? new Date();
  if (!input.state || input.state.length > 128) return { ok: false, reason: "unknown" };

  const claimed = await db.socialLoginState.updateMany({
    where: { state: input.state, consumedAt: null },
    data: { consumedAt: now },
  });

  const row = await db.socialLoginState.findUnique({ where: { state: input.state } });
  if (!row) return { ok: false, reason: "unknown" };

  // The row exists but this call did not claim it, so something else did.
  if (claimed.count === 0) return { ok: false, reason: "replayed" };

  // Checked AFTER claiming, so an expired state is still spent and cannot be
  // retried into a race the moment it lapses.
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  /*
   * The provider in the callback path must match the one the flow started with.
   * Otherwise a state minted for the provider a user trusts could be redeemed
   * against a different one, and the code exchanged with whoever the attacker
   * prefers.
   */
  if (row.provider !== input.provider) return { ok: false, reason: "provider_mismatch" };

  return {
    ok: true,
    state: {
      state: row.state,
      provider: row.provider,
      mode: row.mode === "link" ? "link" : "login",
      codeVerifier: row.codeVerifier,
      nonce: row.nonce,
      returnTo: row.returnTo,
      transactionId: row.transactionId,
      linkUserId: row.linkUserId,
    },
  };
}

/**
 * Drop states that are long past use.
 *
 * Kept well beyond expiry so replay stays DETECTABLE for a while after the
 * window closes — a captured callback replayed two minutes late should be
 * refused as a replay, not as an unknown state.
 */
export async function purgeExpiredLoginStates(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const removed = await db.socialLoginState.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return removed.count;
}
