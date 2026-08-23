/**
 * The anonymous quota ledger.
 *
 * `used` is DERIVED — consumed rows plus live holds — and never stored. A stored
 * total alongside a set of rows is two sources of truth, and they drift the first
 * time a settle is lost.
 *
 * THE RESERVE IS THE WHOLE POINT. It takes `FOR UPDATE` on the quota row before
 * counting, so two concurrent turns for the same visitor serialise. Without that
 * lock both read `remaining: 1`, both insert a hold, and the visitor gets two
 * free turns — which is exactly the race a post-generation `count++` loses, moved
 * one layer down and no better for it.
 *
 * Every statement here runs inside the caller's transaction, under a declared
 * owner scope. Under FORCE row-level security an undeclared scope matches zero
 * rows and reports success, so a "quick unscoped count" would silently return 0
 * and hand out unlimited turns.
 */

import type { PoolClient } from 'pg';

export interface QuotaRow {
  anonymousSessionId: string;
  ownerScope: string;
  turnLimit: number;
  /** Derived: consumed + live holds. */
  used: number;
  createdAt: number;
  updatedAt: number;
  claimedBy?: string;
  claimedAt?: number;
}

export class QuotaLedgerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'QuotaLedgerError';
  }
}

/** Create the visitor's allowance on first sight. Idempotent. */
export async function ensureQuota(
  client: PoolClient, anonymousSessionId: string, ownerScope: string, turnLimit: number, now: number,
): Promise<void> {
  await client.query(
    `INSERT INTO anonymous_quota (anonymous_session_id, owner_scope, turn_limit, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (anonymous_session_id) DO NOTHING`,
    [anonymousSessionId, ownerScope, turnLimit, now],
  );
}

/**
 * Drop this session's expired holds.
 *
 * A hold whose turn died without settling would otherwise consume the visitor's
 * allowance forever — the browser closed mid-stream, the process was killed. Only
 * THIS session's holds are swept: a cross-scope sweep needs an owner-run
 * statement, and under FORCE row-level security that matches zero rows.
 */
export async function releaseExpired(
  client: PoolClient, anonymousSessionId: string, now: number,
): Promise<number> {
  const r = await client.query(
    `DELETE FROM anonymous_reservations
      WHERE anonymous_session_id = $1 AND state = 'held' AND expires_at <= $2`,
    [anonymousSessionId, now],
  );
  return r.rowCount ?? 0;
}

async function readQuota(
  client: PoolClient, anonymousSessionId: string, lock: boolean,
): Promise<QuotaRow | undefined> {
  const { rows } = await client.query<{
    anonymous_session_id: string; owner_scope: string; turn_limit: number;
    created_at: string; updated_at: string; claimed_by: string | null; claimed_at: string | null;
  }>(
    `SELECT * FROM anonymous_quota WHERE anonymous_session_id = $1${lock ? ' FOR UPDATE' : ''}`,
    [anonymousSessionId],
  );
  const row = rows[0];
  if (!row) return undefined;

  const { rows: counts } = await client.query<{ used: string }>(
    `SELECT count(*) AS used FROM anonymous_reservations
      WHERE anonymous_session_id = $1 AND (state = 'consumed' OR state = 'held')`,
    [anonymousSessionId],
  );

  return {
    anonymousSessionId: row.anonymous_session_id,
    ownerScope: row.owner_scope,
    turnLimit: Number(row.turn_limit),
    used: Number(counts[0]?.used ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.claimed_by === null ? {} : { claimedBy: row.claimed_by }),
    ...(row.claimed_at === null ? {} : { claimedAt: Number(row.claimed_at) }),
  };
}

/** Read without locking — for rendering. Never the authority for a decision. */
export async function getQuota(
  client: PoolClient, anonymousSessionId: string,
): Promise<QuotaRow | undefined> {
  return readQuota(client, anonymousSessionId, false);
}

export interface ReserveResult {
  ok: boolean;
  reservationId?: string;
  quota: QuotaRow;
  refusal?: 'exhausted';
}

/**
 * Take one turn's allowance, atomically.
 *
 * `FOR UPDATE` on the quota row is load-bearing: it serialises concurrent
 * reserves for the same visitor. Two tabs hitting send together both block on
 * the same row, so the second sees the first's hold and is refused.
 */
export async function reserveTurn(
  client: PoolClient,
  input: {
    anonymousSessionId: string; ownerScope: string; turnLimit: number;
    reservationId: string; holdMs: number; now: number; conversationId?: string;
  },
): Promise<ReserveResult> {
  await ensureQuota(client, input.anonymousSessionId, input.ownerScope, input.turnLimit, input.now);
  await releaseExpired(client, input.anonymousSessionId, input.now);

  // Lock FIRST, then count. Counting before locking reads a number that another
  // transaction is already invalidating.
  const quota = await readQuota(client, input.anonymousSessionId, true);
  if (!quota) {
    throw new QuotaLedgerError(
      'QUOTA_ROW_MISSING',
      `anonymous quota row for '${input.anonymousSessionId}' vanished between ensure and read — ` +
        'this means the declared scope does not match the row, not that the visitor is new',
    );
  }

  /*
   * A CLAIMED SESSION HAS NO ALLOWANCE LEFT, whatever the reservations say.
   *
   * `used` is derived from live and consumed reservations, and a claim retires
   * neither — so after signing in, this row read back as a FULL allowance. The
   * loop that opens is short and repeatable: sign in, sign out, present the same
   * cookie, take another five turns of real inference, forever. Keeping the row
   * as evidence only works if something reads the evidence.
   *
   * The allowance is reported as fully spent rather than as a distinct refusal,
   * so every surface that already handles "out of turns" handles this too — and
   * what it tells the visitor, "sign in to keep going", is exactly right for
   * someone who demonstrably has an account.
   */
  if (quota.claimedBy) {
    return { ok: false, quota: { ...quota, used: quota.turnLimit }, refusal: 'exhausted' };
  }

  if (quota.used >= quota.turnLimit) {
    return { ok: false, quota, refusal: 'exhausted' };
  }

  await client.query(
    `INSERT INTO anonymous_reservations
       (reservation_id, anonymous_session_id, owner_scope, state, created_at, expires_at, conversation_id)
     VALUES ($1,$2,$3,'held',$4,$5,$6)`,
    [
      input.reservationId, input.anonymousSessionId, input.ownerScope,
      input.now, input.now + input.holdMs, input.conversationId ?? null,
    ],
  );

  return { ok: true, reservationId: input.reservationId, quota: { ...quota, used: quota.used + 1 } };
}

/**
 * The turn produced output. The hold becomes a spend.
 *
 * Zero rows is an error, not a no-op: it means the reservation was never taken,
 * was already settled, or belongs to another scope — and in every one of those
 * cases the caller's belief about what it just charged for is wrong.
 */
export async function consumeReservation(
  client: PoolClient, reservationId: string, now: number,
): Promise<void> {
  const r = await client.query(
    `UPDATE anonymous_reservations SET state = 'consumed', settled_at = $2
      WHERE reservation_id = $1 AND state = 'held'`,
    [reservationId, now],
  );
  if (!r.rowCount) {
    throw new QuotaLedgerError(
      'RESERVATION_NOT_HELD',
      `reservation '${reservationId}' could not be consumed: it is not in the 'held' state for this scope. ` +
        'It was never taken, was already settled, or belongs to a different visitor.',
    );
  }
}

/**
 * Infrastructure failed before useful output. The allowance returns.
 *
 * Deleted rather than marked, so no derived count has to remember to exclude a
 * "released" state. One query forgetting that filter is a permanently wrong quota.
 *
 * Absence is NOT an error here, unlike consume: a release racing an expiry sweep
 * is a legitimate way for the row to already be gone, and turning that into a
 * 500 would fail a request whose only remaining job is to hand the user back
 * something they already own.
 */
export async function releaseReservation(
  client: PoolClient, reservationId: string,
): Promise<boolean> {
  const r = await client.query(
    `DELETE FROM anonymous_reservations WHERE reservation_id = $1 AND state = 'held'`,
    [reservationId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Record that the visitor signed in and took this session's history with them.
 *
 * The quota row is kept, not deleted: it is the evidence that this anonymous id
 * has already been used. Deleting it would let the same browser present the same
 * cookie and get a fresh allowance.
 *
 * IDEMPOTENT FOR THE SAME ACCOUNT, CLOSED TO ANY OTHER. The quota row is per
 * anonymous SESSION while a claim is per CONVERSATION, and a visitor who filled
 * their allowance has several. `claimed_by IS NULL` alone meant the first
 * conversation marked the row and every later one was refused ALREADY_CLAIMED —
 * which, because the mark shares the transaction with the move, ROLLED BACK the
 * transfer. Signing in silently kept one conversation and abandoned the rest in
 * a scope whose cookie had just been revoked. Measured on production: three
 * conversations in, one "claimed", none actually moved.
 *
 * Re-asserting the SAME account is therefore allowed, and a DIFFERENT account is
 * still refused — which is the property that matters, and the one the
 * second-account test pins.
 */
export async function markClaimed(
  client: PoolClient, anonymousSessionId: string, claimedBy: string, now: number,
): Promise<void> {
  const r = await client.query(
    `UPDATE anonymous_quota SET claimed_by = $2, claimed_at = $3, updated_at = $3
      WHERE anonymous_session_id = $1 AND (claimed_by IS NULL OR claimed_by = $2)`,
    [anonymousSessionId, claimedBy, now],
  );
  if (!r.rowCount) {
    throw new QuotaLedgerError(
      'ALREADY_CLAIMED',
      `anonymous session '${anonymousSessionId}' is already claimed by a different account, ` +
        'or is not visible in this scope',
    );
  }
}
