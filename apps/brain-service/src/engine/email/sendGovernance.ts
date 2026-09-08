/**
 * GOVERNED SEND — the one operation here that cannot be taken back.
 *
 * ---------------------------------------------------------------------------
 * THE SEQUENCE, AND WHY EVERY STEP IS LOAD-BEARING
 *
 *   propose → approve → RECHECK AUTHORIZATION → claim idempotency → dispatch
 *
 * Each step exists because of a specific way a send goes wrong:
 *
 *   propose      the user sees the exact message, bound by fingerprint
 *   approve      consent is recorded against THAT message, not "a send"
 *   recheck      🚨 a grant can be revoked between approval and dispatch. The
 *                user may have disconnected the account in another tab, or
 *                Google may have expired the token. Approval is consent, not
 *                authorization, and treating it as both means dispatching with
 *                a credential we were told to stop using.
 *   claim        the durable primitive makes "did this already send?" a
 *                question with an answer, across restarts
 *   dispatch     once, or not at all
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY A FAILED SEND IS NOT AUTOMATICALLY RETRIED
 *
 * The dangerous state is not failure — it is UNCERTAINTY. A provider that
 * times out after accepting the message has already sent it; a provider that
 * times out before accepting has not. From here the two are indistinguishable,
 * and retrying resolves that ambiguity by sending a second copy.
 *
 * So an uncertain outcome settles to `outcome_unknown`, which is terminal:
 * this system will not retry it, and the user is told to look at their Sent
 * mail. A duplicate email to a client is worse than an honest "I am not sure".
 */

import {
  mayDispatch,
  reattempt,
  settle,
  verdictFor,
  type ClaimVerdict,
  type IdempotencyRecord,
  type OperationIdentity,
} from '../tools/idempotency.js';
import { bindingFor, changedFields, fingerprint, idempotencyKeyFor, type SendBinding } from './sendBinding.js';
import type { EmailConnection, EmailDraft, EmailFailure, EmailProvider } from './types.js';

export interface SendProposal {
  /** What the user is being asked to approve. */
  binding: SendBinding;
  /** Stored against the approval; a changed message will not match. */
  fingerprint: string;
  /** Derived from the fingerprint, so a retry is the same operation. */
  idempotencyKey: string;
}

export type SendRefusal =
  | { kind: 'not_connected' }
  | { kind: 'authorization_expired' }
  | { kind: 'insufficient_scope' }
  | { kind: 'approval_missing' }
  | { kind: 'approval_expired' }
  | { kind: 'approval_declined' }
  /** The message changed after approval. `changed` names which fields. */
  | { kind: 'approval_stale'; changed: string[] }
  /** Already sent under this identity. NOT an error — the correct outcome. */
  | { kind: 'already_sent'; providerMessageId?: string }
  /** A previous attempt ended uncertainly. Terminal; never auto-retried. */
  | { kind: 'outcome_unknown' };

export type SendResult =
  | { ok: true; providerMessageId: string; idempotencyKey: string }
  | { ok: false; refusal: SendRefusal }
  | { ok: false; failure: EmailFailure };

/** What the caller must supply. Injected so every branch is testable offline. */
export interface SendDeps {
  provider: EmailProvider;
  /** Re-read at dispatch time, NOT the value captured at proposal time. */
  currentConnection(): Promise<EmailConnection>;
  /** The approval the user granted, if any. */
  approvalFor(fingerprint: string): Promise<
    { state: 'approved' | 'declined' | 'expired'; binding: SendBinding } | null
  >;
  /** Durable idempotency record for this operation identity. */
  loadRecord(key: string): Promise<IdempotencyRecord | null>;
  saveRecord(record: IdempotencyRecord): Promise<void>;
  now(): number;
}

/** Build the proposal a user is shown and asked to approve. */
export function proposeSend(account: string, draft: EmailDraft): SendProposal {
  const binding = bindingFor(account, draft);
  return {
    binding,
    fingerprint: fingerprint(binding),
    idempotencyKey: idempotencyKeyFor(binding),
  };
}

/**
 * Dispatch an approved send, exactly once, or refuse with a reason.
 *
 * Ordering below is deliberate: consent is checked BEFORE authorization is
 * rechecked, because "you did not approve this" is a more useful thing to hear
 * than "your account needs reconnecting" when both are true — the user has not
 * asked for anything yet.
 */
export async function dispatchSend(
  account: string,
  draft: EmailDraft,
  deps: SendDeps,
  identity: Omit<OperationIdentity, 'idempotencyKey' | 'normalizedInputHash'>,
): Promise<SendResult> {
  const proposal = proposeSend(account, draft);

  // ── 1. consent, bound to THIS message ─────────────────────────────────────
  const approval = await deps.approvalFor(proposal.fingerprint);
  if (!approval) {
    /*
     * No approval matching this fingerprint. That covers both "never approved"
     * and "approved something else" — and the second is the dangerous one, so
     * the caller re-derives the difference by looking up the user's most recent
     * approval and comparing. See `explainStaleApproval`.
     */
    return { ok: false, refusal: { kind: 'approval_missing' } };
  }
  if (approval.state === 'declined') return { ok: false, refusal: { kind: 'approval_declined' } };
  if (approval.state === 'expired') return { ok: false, refusal: { kind: 'approval_expired' } };

  const changed = changedFields(approval.binding, proposal.binding);
  if (changed.length > 0) {
    // Defence in depth: the fingerprint lookup should already have missed.
    return { ok: false, refusal: { kind: 'approval_stale', changed } };
  }

  // ── 2. 🚨 authorization RE-CHECKED, not remembered ───────────────────────
  const connection = await deps.currentConnection();
  if (connection.state === 'not_connected' || connection.state === 'not_configured') {
    return { ok: false, refusal: { kind: 'not_connected' } };
  }
  if (connection.state === 'authorization_expired') {
    return { ok: false, refusal: { kind: 'authorization_expired' } };
  }
  if (!connection.scopes.send) {
    return { ok: false, refusal: { kind: 'insufficient_scope' } };
  }
  if (connection.state === 'provider_unavailable') {
    return {
      ok: false,
      failure: { kind: 'provider_unavailable', detail: 'the mail provider is not answering' },
      };
  }

  // ── 3. durable claim ─────────────────────────────────────────────────────
  const fullIdentity: OperationIdentity = {
    ...identity,
    idempotencyKey: proposal.idempotencyKey,
    normalizedInputHash: proposal.fingerprint,
  };
  const existing = await deps.loadRecord(proposal.idempotencyKey);
  const verdict: ClaimVerdict = verdictFor(existing, fullIdentity, deps.now());

  /*
   * The primitive already knows this operation's fate in every case but one.
   * `already_committed` is NOT an error: the message went out, and reporting
   * that without sending again is exactly right.
   */
  if (verdict.kind === 'already_committed') {
    const sentId = (verdict.record.result as { providerMessageId?: string } | undefined)?.providerMessageId;
    return { ok: false, refusal: { kind: 'already_sent', ...(sentId ? { providerMessageId: sentId } : {}) } };
  }
  if (verdict.kind === 'needs_reconciliation') {
    // Dispatched and unobserved. Reconcile, never retry — that is how one send
    // becomes two.
    return { ok: false, refusal: { kind: 'outcome_unknown' } };
  }
  if (verdict.kind === 'in_flight') {
    // Another attempt holds this operation. Not a failure, and not a licence
    // to send alongside it.
    return { ok: false, refusal: { kind: 'outcome_unknown' } };
  }
  if (verdict.kind === 'refused') {
    // The key names a different operation — a changed message reaching a stale
    // key. The primitive's own mismatch is the authority on which field moved.
    return { ok: false, refusal: { kind: 'approval_stale', changed: [verdict.mismatch] } };
  }

  /*
   * `retryable` means the previous attempt failed BEFORE dispatch, so nothing
   * left the building and a fresh attempt is safe. `reattempt` enforces that:
   * it throws for any other state, which is the guard against retrying an
   * unknown outcome.
   */
  const claimed =
    verdict.kind === 'retryable' ? reattempt(verdict.record, deps.now()) : verdict.record;
  if (!mayDispatch(verdict) && verdict.kind !== 'retryable') {
    return { ok: false, refusal: { kind: 'outcome_unknown' } };
  }
  await deps.saveRecord(claimed);

  // ── 4. dispatch, once ────────────────────────────────────────────────────
  let outcome;
  try {
    outcome = await deps.provider.send(draft, proposal.idempotencyKey);
  } catch (error) {
    /*
     * 🚨 A THROW IS UNCERTAINTY, NOT FAILURE.
     *
     * The request may have reached the provider and been accepted before the
     * connection broke. Settling this as `failed_before_dispatch` would invite
     * a retry that sends a second copy to a real person.
     */
    await deps.saveRecord(
      settle(claimed, 'outcome_unknown', deps.now(), {
        detail: error instanceof Error ? error.message : 'transport error',
      }),
    );
    return { ok: false, refusal: { kind: 'outcome_unknown' } };
  }

  if (outcome.ok) {
    await deps.saveRecord(
      settle(claimed, 'committed', deps.now(), {
        result: { providerMessageId: outcome.value.providerMessageId },
      }),
    );
    return { ok: true, providerMessageId: outcome.value.providerMessageId, idempotencyKey: proposal.idempotencyKey };
  }

  /*
   * A TYPED failure from the provider. Only the ones that prove nothing left
   * the building are safe to call `failed_before_dispatch`; a timeout is not
   * one of them, because a provider that timed out after accepting has already
   * sent the message.
   */
  const provablyNotSent =
    outcome.failure.kind === 'not_connected' ||
    outcome.failure.kind === 'not_configured' ||
    outcome.failure.kind === 'authorization_expired' ||
    outcome.failure.kind === 'insufficient_scope' ||
    outcome.failure.kind === 'refused';

  await deps.saveRecord(
    settle(claimed, provablyNotSent ? 'failed_before_dispatch' : 'outcome_unknown', deps.now(), {
      detail: outcome.failure.kind,
    }),
  );
  return provablyNotSent
    ? { ok: false, failure: outcome.failure }
    : { ok: false, refusal: { kind: 'outcome_unknown' } };
}

/**
 * What a user should be told, in the product's voice.
 *
 * Kept here so every caller says the same thing, and so no provider error text
 * or capability id reaches a person. `outcome_unknown` deliberately does not
 * offer a retry: the whole point is that we must not send again.
 */
export function refusalMessage(refusal: SendRefusal): string {
  switch (refusal.kind) {
    case 'not_connected':
      return 'Connect an email account before sending.';
    case 'authorization_expired':
      return 'Your email account needs reconnecting before this can be sent.';
    case 'insufficient_scope':
      return 'This account is connected for reading only. Reconnect it with permission to send.';
    case 'approval_missing':
      return 'This message has not been approved for sending.';
    case 'approval_expired':
      return 'That approval has expired. Review the message and approve it again.';
    case 'approval_declined':
      return 'Sending was declined.';
    case 'approval_stale':
      return `The message changed after it was approved (${refusal.changed.join(', ')}). Review it and approve again.`;
    case 'already_sent':
      return 'This message has already been sent.';
    case 'outcome_unknown':
      /*
       * The most important sentence in this file. It says what we do not know,
       * names where the truth is, and offers no button that would send twice.
       */
      return 'It is not clear whether this message was sent. Check your Sent mail before trying again.';
  }
}
