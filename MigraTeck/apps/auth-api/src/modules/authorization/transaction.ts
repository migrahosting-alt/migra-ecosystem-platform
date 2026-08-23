/**
 * The authorization request, as a server-side object with a lifetime.
 *
 * WHAT THIS REPLACES. The request used to travel as a dozen query parameters:
 * `/authorize` copied them into the login URL, the login page carried them
 * onward, the provider round trip carried them again, and `/authorize/complete`
 * re-parsed them from the browser to issue the code. Every hop could drop one,
 * and dropping one does not degrade the flow — it produces an invalid request
 * that MigraAuth must reject, in front of a user who has just authenticated
 * successfully. That is exactly what happened.
 *
 * WHAT IT GIVES INSTEAD. The browser carries one opaque reference. Client
 * binding, redirect equality, PKCE binding and the client's own `state` stop
 * being properties that every hop must preserve and become properties of a
 * single row. There is no browser-supplied `redirect_uri` at issuance time to
 * validate, because the only one that exists is the one validated at creation.
 *
 * TWO STATES, NOT ONE. `clientState` here protects the client↔MigraAuth hop;
 * `SocialLoginState.state` protects the MigraAuth↔provider hop. They are
 * separate because they guard different journeys, and reusing one for both
 * would let a flow inherit protection it never actually performed.
 */

import { randomBytes } from "node:crypto";
import { db } from "../../lib/db.js";
import type { AuthorizationTransaction, IdentityProvider } from "../../prisma-client.js";

/** Long enough that guessing is not a strategy. */
const ID_BYTES = 32;

/**
 * How long a half-finished sign-in stays resumable.
 *
 * Generous enough to survive a password reset detour or a slow provider, short
 * enough that an abandoned transaction on a shared machine is not still live
 * tomorrow.
 */
const TTL_MS = 15 * 60_000;

export interface CreateTransactionInput {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  clientState: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  nonce?: string | undefined;
  prompt?: string | undefined;
  loginHint?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  now?: Date;
}

/**
 * Open a transaction for a request that has ALREADY been validated.
 *
 * This function does not validate the client or the redirect URI, and that is
 * deliberate: it is called only from `/authorize`, after both checks pass, so
 * there is exactly one place where an unvalidated request could become a
 * transaction — and it does not.
 */
export async function createTransaction(input: CreateTransactionInput): Promise<AuthorizationTransaction> {
  const now = input.now ?? new Date();
  return db.authorizationTransaction.create({
    data: {
      id: randomBytes(ID_BYTES).toString("base64url"),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      responseType: input.responseType,
      scope: input.scope,
      clientState: input.clientState,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      nonce: input.nonce ?? null,
      prompt: input.prompt ?? null,
      loginHint: input.loginHint ?? null,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: new Date(now.getTime() + TTL_MS),
    },
  });
}

export type TransactionRefusal =
  | "unknown"
  | "expired"
  | "already_used"
  | "client_inactive";

export type TransactionLookup =
  | { ok: true; transaction: AuthorizationTransaction }
  | { ok: false; reason: TransactionRefusal };

/**
 * Load a transaction WITHOUT spending it.
 *
 * Used to render the login screen and to attach a provider. Every refusal is
 * named: "expired", "already used" and "never existed" lead to different
 * messages, and collapsing them tells a user to try again when trying again
 * cannot work.
 */
export async function loadTransaction(id: string, now = new Date()): Promise<TransactionLookup> {
  if (!id || id.length > 128) return { ok: false, reason: "unknown" };

  const transaction = await db.authorizationTransaction.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!transaction) return { ok: false, reason: "unknown" };
  if (transaction.consumedAt) return { ok: false, reason: "already_used" };
  if (transaction.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  // A client deactivated mid-flow must not be completable, even though the
  // transaction was valid when it opened.
  if (!transaction.client.isActive) return { ok: false, reason: "client_inactive" };

  return { ok: true, transaction };
}

/** Record which provider the user was sent to. Observability, not authority. */
export async function attachProvider(id: string, provider: IdentityProvider): Promise<void> {
  await db.authorizationTransaction.updateMany({
    where: { id, consumedAt: null },
    data: { provider },
  });
}

export type ConsumeOutcome =
  | { ok: true; transaction: AuthorizationTransaction }
  | { ok: false; reason: TransactionRefusal };

/**
 * Spend a transaction, exactly once.
 *
 * A CONDITIONAL UPDATE rather than read-then-write. Two tabs completing the same
 * transaction — a double-submitted login, a retried resume — would both pass a
 * read and both issue an authorization code for one request. Only one
 * `updateMany` can match `consumedAt: null`, so the second is told it was
 * already used rather than being handed a second code.
 *
 * The user is bound HERE, at the moment of spending, so a transaction opened
 * before a sign-in cannot carry an identity it did not authenticate.
 */
export async function consumeTransaction(input: {
  id: string;
  userId: string;
  now?: Date;
}): Promise<ConsumeOutcome> {
  const now = input.now ?? new Date();

  const claimed = await db.authorizationTransaction.updateMany({
    where: { id: input.id, consumedAt: null },
    data: { consumedAt: now, userId: input.userId },
  });

  const transaction = await db.authorizationTransaction.findUnique({
    where: { id: input.id },
    include: { client: true },
  });
  if (!transaction) return { ok: false, reason: "unknown" };
  if (claimed.count === 0) return { ok: false, reason: "already_used" };

  // Checked after claiming, so an expired transaction is still spent and cannot
  // be retried into a race the moment it lapses.
  if (transaction.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (!transaction.client.isActive) return { ok: false, reason: "client_inactive" };

  return { ok: true, transaction };
}

/**
 * Drop transactions long past use.
 *
 * Kept well beyond expiry so a replayed reference stays recognisable as a replay
 * rather than degrading into "unknown" the moment the window closes.
 */
export async function purgeExpiredTransactions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const removed = await db.authorizationTransaction.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return removed.count;
}

/**
 * What the login screen may know about a pending request.
 *
 * Deliberately narrow. The screen needs to brand itself and say which product is
 * asking; it does not need the PKCE challenge, the redirect URI or the client's
 * state, and anything handed to a browser is something a browser can alter.
 */
export interface PublicTransactionView {
  id: string;
  clientId: string;
  clientName: string;
  prompt: string | null;
  loginHint: string | null;
  expiresAt: string;
}

export function toPublicView(
  transaction: AuthorizationTransaction & { client: { clientName: string } },
): PublicTransactionView {
  return {
    id: transaction.id,
    clientId: transaction.clientId,
    clientName: transaction.client.clientName,
    prompt: transaction.prompt,
    loginHint: transaction.loginHint,
    expiresAt: transaction.expiresAt.toISOString(),
  };
}
