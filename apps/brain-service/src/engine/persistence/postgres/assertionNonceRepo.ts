import type { PoolClient } from 'pg';

/**
 * Durable replay protection for signed internal assertions.
 *
 * INSERT-OR-FAIL IS THE WHOLE CONCURRENCY STORY. The request id is the primary
 * key, so two simultaneous replays contend on one row and exactly one wins.
 * A read-then-write would let both callers observe "unused" and both proceed,
 * which is the race replay protection exists to lose.
 *
 * It is a TABLE and not a Map because a restart would otherwise reopen every
 * nonce — and a restart is exactly when someone holding a captured assertion
 * would try again.
 */

/** Records the nonce. Returns false when it has already been used. */
export async function consumeNonce(
  client: PoolClient,
  input: { requestId: string; serviceId: string; action: string; expiresAt: number; now: number },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO internal_assertion_nonces (request_id, service_id, action, consumed_at, expires_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (request_id) DO NOTHING`,
    [input.requestId, input.serviceId, input.action, input.now, input.expiresAt],
  );
  return (rowCount ?? 0) === 1;
}

/**
 * Bounded cleanup of expired rows.
 *
 * LIMITED PER CALL so maintenance cannot turn into a long table lock on a
 * deployment that has been running for a year. Returning the count lets a
 * scheduler decide whether to run again rather than guessing.
 */
export async function pruneExpiredNonces(
  client: PoolClient,
  now: number,
  limit = 1000,
): Promise<number> {
  const { rowCount } = await client.query(
    `DELETE FROM internal_assertion_nonces
      WHERE request_id IN (
        SELECT request_id FROM internal_assertion_nonces WHERE expires_at < $1 LIMIT $2
      )`,
    [now, limit],
  );
  return rowCount ?? 0;
}
