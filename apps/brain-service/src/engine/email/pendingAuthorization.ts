/**
 * IN-FLIGHT CONNECTION ATTEMPTS — minted, taken once, expired.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE STATE IS HASHED BEFORE IT IS EVER STORED OR COMPARED
 *
 * The raw value goes to the browser and comes back from Google; nothing else
 * needs it. Storing only the hash means a dump of this table cannot be used to
 * resume someone's connection attempt — the same argument that seals the
 * tokens, applied to the short-lived thing that authorises storing them.
 *
 * Everything downstream — `takePending`, the comparison inside
 * `completeCallback` — therefore works in hashes. That keeps the comparison
 * REAL: one side comes from the database, the other is derived from the
 * request, and they are two independently produced values rather than one
 * value compared against itself.
 *
 * ---------------------------------------------------------------------------
 * 🚨 SINGLE-USE MUST BE ATOMIC, NOT SEQUENTIAL
 *
 * `DELETE ... RETURNING` in one statement, never read-then-delete. The latter
 * has a window in which two concurrent callbacks both find the row — and a
 * replayed callback is precisely the request that would exploit it. A
 * single-threaded test cannot tell the two implementations apart, which is why
 * the choice is written down here rather than left to look like a style
 * preference.
 */

import { createHash } from 'node:crypto';

import type { GrantKind } from './oauthConfig.js';

/** The lookup key. The raw state never reaches storage. */
export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export interface PendingRecord {
  stateHash: string;
  ownerScope: string;
  workspaceScope: string;
  provider: string;
  grants: GrantKind[];
  /** Already validated as a same-site path when it was minted. */
  returnTo: string;
  createdAt: number;
}

export interface PendingAuthorizationStore {
  put(record: PendingRecord): Promise<void>;
  /** Atomically removes and returns, or returns null. Never read-then-delete. */
  take(stateHash: string): Promise<PendingRecord | null>;
  /** Housekeeping: abandoned attempts must not accumulate forever. */
  pruneOlderThan(cutoff: number): Promise<number>;
}
