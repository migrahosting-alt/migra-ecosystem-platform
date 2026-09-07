/**
 * DURABLE IDEMPOTENCY — the platform's answer to one question, and only one:
 *
 *   Has this exact operation already been attempted or committed, and what
 *   durable outcome is known?
 *
 * ---------------------------------------------------------------------------
 * ONE AUTHORITY, NOT A RENAME FEATURE
 *
 * Every tool that can send, create, charge, deploy or destroy needs this, and
 * each one that grows its own version gets the edge cases subtly wrong in its
 * own way — which is invisible until two of them disagree about whether an
 * operation happened. So this module owns the question outright, and no tool
 * may keep a private "did I already do this" flag beside it.
 *
 * It is deliberately storage-free. The state machine and the identity rules are
 * pure and total here; `IdempotencyStore` is the port that makes them durable.
 * That split is what lets SQLite back it today and Postgres back it later
 * without the rules moving.
 *
 * ---------------------------------------------------------------------------
 * WHY THE KEY IS NOT ENOUGH ON ITS OWN
 *
 * An idempotency key is a CLAIM by the caller that two requests are the same
 * operation. Trusting it alone is how a retry with an edited body silently
 * overwrites the first one's meaning, or how one client's key collides with
 * another's and returns someone else's result.
 *
 * So the key is checked against the whole operation identity — tool, actor,
 * scope and the normalized input hash. Same key with anything else different is
 * REFUSED rather than reconciled, because there is no honest answer: the caller
 * has told us two different operations are the same one, and only they can say
 * which they meant.
 *
 * ---------------------------------------------------------------------------
 * 🚨 `outcome_unknown` IS NOT A RETRY STATE
 *
 * It is the state where a dispatch happened and the result could not be
 * observed. Retrying is precisely the wrong move — it is how one send becomes
 * two — and so is treating it as failed. It requires RECONCILIATION: going and
 * finding out what actually happened. This module will not hand back permission
 * to dispatch from that state, and there is no flag to make it.
 * ---------------------------------------------------------------------------
 */

/** The four durable states. Ordered by how settled they are; see `RANK`. */
export type IdempotencyState =
  | 'pending'
  | 'committed'
  | 'failed_before_dispatch'
  | 'outcome_unknown';

/**
 * What makes two requests THE SAME OPERATION.
 *
 * All five fields, always. Dropping any one of them turns a collision into a
 * wrong answer rather than a refusal.
 */
export interface OperationIdentity {
  idempotencyKey: string;
  toolId: string;
  /** Who is acting. A key is scoped to its actor; two users cannot share one. */
  actor: string;
  /** Serialized owner/workspace. Cross-scope reuse is a refusal, not a hit. */
  scope: string;
  /** Hash of the CANONICAL normalized input — never the raw request body. */
  normalizedInputHash: string;
}

export interface IdempotencyRecord {
  identity: OperationIdentity;
  state: IdempotencyState;
  /** Increments only when a fresh attempt is explicitly permitted. */
  attempt: number;
  createdAt: number;
  updatedAt: number;
  /** Set once the outcome is durable. Opaque to this module. */
  result?: unknown;
  /** Why it failed or could not be observed. A sentence, not a code. */
  detail?: string;
  /** Links this record to the invocation that produced it. */
  provenance?: OperationProvenance;
}

/** The trail that ties a durable record to what actually ran. */
export interface OperationProvenance {
  requestId: string;
  /** The consent that authorised it, when the operation required one. */
  approvalId?: string;
  dispatchedAt?: number;
  settledAt?: number;
}

/** Why a key was refused. Each is a caller error, never a transient condition. */
export type IdentityMismatch =
  | 'input-changed'
  | 'different-tool'
  | 'different-actor'
  | 'different-scope';

/** What a caller may do, having asked about this operation. */
export type ClaimVerdict =
  /** No record existed. This caller now owns the attempt and MAY dispatch. */
  | { kind: 'claimed'; record: IdempotencyRecord }
  /** Already done. Return the durable result; dispatching again is a duplicate. */
  | { kind: 'already_committed'; record: IdempotencyRecord }
  /** Someone holds this attempt. Do NOT dispatch; wait or reconcile. */
  | { kind: 'in_flight'; record: IdempotencyRecord }
  /** Dispatched, unobserved. Reconcile — never retry. */
  | { kind: 'needs_reconciliation'; record: IdempotencyRecord }
  /** Failed before anything ran. A fresh attempt is safe, under `reattempt`. */
  | { kind: 'retryable'; record: IdempotencyRecord }
  /** The key names a different operation. Only the caller can resolve this. */
  | { kind: 'refused'; mismatch: IdentityMismatch; record: IdempotencyRecord; message: string };

const MISMATCH_MESSAGE: Record<IdentityMismatch, string> = {
  'input-changed':
    'This request reuses an idempotency key with different input. Use a new key for a different operation.',
  'different-tool':
    'This idempotency key belongs to a different operation. Use a new key.',
  'different-actor':
    'This idempotency key belongs to another user. Keys are not shared.',
  'different-scope':
    'This idempotency key belongs to another workspace. Keys are not shared across workspaces.',
};

/**
 * Compare two identities that share a key.
 *
 * Order matters only for the message the caller reads: the most specific true
 * difference is reported, so "you changed the input" is not hidden behind a
 * generic collision.
 */
export function identityMismatch(
  stored: OperationIdentity,
  incoming: OperationIdentity,
): IdentityMismatch | null {
  if (stored.toolId !== incoming.toolId) return 'different-tool';
  if (stored.actor !== incoming.actor) return 'different-actor';
  if (stored.scope !== incoming.scope) return 'different-scope';
  if (stored.normalizedInputHash !== incoming.normalizedInputHash) return 'input-changed';
  return null;
}

/**
 * How settled a state is. A transition may never move DOWN this ladder.
 *
 * `committed` is terminal and outranks everything: a record that has committed
 * cannot be walked back to pending by a late-arriving write, which is the
 * out-of-order-update bug that makes a completed charge look retryable.
 */
const RANK: Record<IdempotencyState, number> = {
  pending: 0,
  outcome_unknown: 1,
  failed_before_dispatch: 1,
  committed: 2,
};

/**
 * Which transitions exist at all.
 *
 * `failed_before_dispatch → pending` is absent ON PURPOSE. A fresh attempt is
 * not a transition of the old attempt; it is a NEW attempt, and `reattempt`
 * mints it with an incremented counter so the two are distinguishable in the
 * provenance trail forever.
 */
const ALLOWED: Record<IdempotencyState, IdempotencyState[]> = {
  pending: ['committed', 'failed_before_dispatch', 'outcome_unknown'],
  // Only reconciliation moves this, and only to a settled truth.
  outcome_unknown: ['committed', 'failed_before_dispatch'],
  failed_before_dispatch: [],
  committed: [],
};

export function canTransition(from: IdempotencyState, to: IdempotencyState): boolean {
  if (from === to) return false;
  if (RANK[to] < RANK[from]) return false;
  return ALLOWED[from].includes(to);
}

/** Decide what a caller may do, given what is stored. Pure. */
export function verdictFor(
  stored: IdempotencyRecord | null,
  incoming: OperationIdentity,
  now: number,
): ClaimVerdict {
  if (!stored) {
    return {
      kind: 'claimed',
      record: {
        identity: incoming,
        state: 'pending',
        attempt: 1,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  /*
   * IDENTITY IS CHECKED BEFORE STATE, ALWAYS. A committed record whose key was
   * reused for different input must report the REUSE, not report success — that
   * would hand the caller someone else's outcome for their own operation.
   */
  const mismatch = identityMismatch(stored.identity, incoming);
  if (mismatch) {
    return { kind: 'refused', mismatch, record: stored, message: MISMATCH_MESSAGE[mismatch] };
  }

  switch (stored.state) {
    case 'committed':
      return { kind: 'already_committed', record: stored };
    case 'outcome_unknown':
      return { kind: 'needs_reconciliation', record: stored };
    case 'failed_before_dispatch':
      return { kind: 'retryable', record: stored };
    case 'pending':
      return { kind: 'in_flight', record: stored };
  }
}

/** May this verdict dispatch? Exactly one may, and it is not a judgement call. */
export function mayDispatch(verdict: ClaimVerdict): boolean {
  return verdict.kind === 'claimed';
}

/**
 * Settle a record. Refuses any transition the machine does not permit, rather
 * than writing it and leaving the store to be the last line of defence.
 */
export function settle(
  record: IdempotencyRecord,
  to: IdempotencyState,
  now: number,
  extra: { result?: unknown; detail?: string; provenance?: OperationProvenance } = {},
): IdempotencyRecord {
  if (!canTransition(record.state, to)) {
    throw new Error(
      `ILLEGAL IDEMPOTENCY TRANSITION ${record.state} → ${to} for ${record.identity.idempotencyKey}. ` +
        'State is monotonic: a settled operation never becomes unsettled.',
    );
  }
  return {
    ...record,
    state: to,
    updatedAt: now,
    ...(extra.result !== undefined ? { result: extra.result } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra.provenance ? { provenance: { ...record.provenance, ...extra.provenance } } : {}),
  };
}

/**
 * A NEW attempt on a record that failed before anything was dispatched.
 *
 * The only path back to `pending`, and it is deliberately not a transition: the
 * attempt counter increments, so "this is the second time we tried" survives in
 * the record rather than being erased by a reset.
 *
 * Permitted from `failed_before_dispatch` alone. Not from `outcome_unknown` —
 * that is the whole point of the state — and not from `committed`.
 */
export function reattempt(record: IdempotencyRecord, now: number): IdempotencyRecord {
  if (record.state !== 'failed_before_dispatch') {
    throw new Error(
      `A FRESH ATTEMPT IS NOT PERMITTED from ${record.state} for ${record.identity.idempotencyKey}. ` +
        (record.state === 'outcome_unknown'
          ? 'The outcome is unknown: reconcile it, never retry it — that is how one send becomes two.'
          : 'Only an operation that failed BEFORE dispatch may be attempted again.'),
    );
  }
  return {
    ...record,
    state: 'pending',
    attempt: record.attempt + 1,
    updatedAt: now,
    // The previous failure's detail must not read as this attempt's outcome.
    detail: undefined,
  };
}
