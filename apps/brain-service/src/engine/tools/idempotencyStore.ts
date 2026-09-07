/**
 * THE ONE PLACE AN OPERATION'S DURABLE STATE LIVES.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLAIM MUST BE ATOMIC, AND NOT A READ FOLLOWED BY A WRITE
 *
 * The interesting window is two identical requests arriving together — a double
 * click, a reconnect, a retrying proxy. Read-then-write loses that race: both
 * read "nothing stored", both claim, both dispatch, and the operation happens
 * twice with a perfectly clean audit trail saying it happened once.
 *
 * So `claim` is a single atomic operation. In SQL that is an INSERT that either
 * wins on a UNIQUE key or loses and re-reads; in memory it is one synchronous
 * turn. Everything else in this module is built on the assumption that exactly
 * one caller can ever receive `claimed` for a given key.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE UNIQUE KEY IS
 *
 * `(idempotencyKey, actor, scope)` — NOT the key alone, and NOT the whole
 * identity.
 *
 *   · not the key alone, because two tenants may legitimately choose the same
 *     key and neither should see the other's operation;
 *   · not the whole identity, because if the input hash were part of the key,
 *     the same key with edited input would INSERT a second row instead of
 *     colliding — and the reuse would silently succeed as a new operation,
 *     which is exactly the defect the refusal exists to catch.
 *
 * So tool and input hash are stored as ATTRIBUTES and compared on read. The
 * collision has to happen for the refusal to be possible.
 * ---------------------------------------------------------------------------
 */

import {
  reattempt,
  settle,
  verdictFor,
  type ClaimVerdict,
  type IdempotencyRecord,
  type IdempotencyState,
  type OperationIdentity,
  type OperationProvenance,
} from './idempotency.js';

/** What a durable backend must provide. Deliberately tiny. */
export interface IdempotencyPersistence {
  /**
   * Insert if absent and return null; otherwise return the stored record
   * WITHOUT modifying it. Must be atomic against concurrent callers.
   */
  insertIfAbsent(record: IdempotencyRecord): Promise<IdempotencyRecord | null>;
  read(key: string, actor: string, scope: string): Promise<IdempotencyRecord | null>;
  /** Overwrite an existing row. The state machine has already validated it. */
  write(record: IdempotencyRecord): Promise<void>;
}

export interface IdempotencyStoreOptions {
  persistence: IdempotencyPersistence;
  now?: () => number;
}

export class IdempotencyStore {
  private readonly persistence: IdempotencyPersistence;
  private readonly now: () => number;

  constructor(options: IdempotencyStoreOptions) {
    this.persistence = options.persistence;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Ask about an operation, claiming it if it is new.
   *
   * The ONLY verdict that permits dispatch is `claimed`, and it is returned to
   * exactly one caller per key. Everything else describes a durable fact the
   * caller must respect rather than work around.
   */
  async claim(identity: OperationIdentity): Promise<ClaimVerdict> {
    const now = this.now();
    const fresh: IdempotencyRecord = {
      identity,
      state: 'pending',
      attempt: 1,
      createdAt: now,
      updatedAt: now,
    };

    const existing = await this.persistence.insertIfAbsent(fresh);
    if (existing === null) return { kind: 'claimed', record: fresh };

    // Something was already there. The pure layer decides what that means; this
    // layer never interprets a state itself.
    return verdictFor(existing, identity, now);
  }

  /** The operation completed and its result is durable. Terminal. */
  async commit(
    identity: OperationIdentity,
    result: unknown,
    provenance?: OperationProvenance,
  ): Promise<IdempotencyRecord> {
    return this.transition(identity, 'committed', { result, ...(provenance ? { provenance } : {}) });
  }

  /** Nothing was dispatched. A fresh attempt may be permitted later. */
  async failBeforeDispatch(
    identity: OperationIdentity,
    detail: string,
    provenance?: OperationProvenance,
  ): Promise<IdempotencyRecord> {
    return this.transition(identity, 'failed_before_dispatch', {
      detail,
      ...(provenance ? { provenance } : {}),
    });
  }

  /**
   * Dispatched, and the result could not be observed.
   *
   * 🚨 This is not a failure and not a success. Inability to observe state is
   * not evidence of state, and this record will never again permit a dispatch.
   */
  async markOutcomeUnknown(
    identity: OperationIdentity,
    detail: string,
    provenance?: OperationProvenance,
  ): Promise<IdempotencyRecord> {
    return this.transition(identity, 'outcome_unknown', {
      detail,
      ...(provenance ? { provenance } : {}),
    });
  }

  /**
   * Resolve an unknown outcome by having FOUND OUT what happened.
   *
   * Separate from `commit`/`failBeforeDispatch` because the caller must have
   * done the finding out. There is no path from `outcome_unknown` that does not
   * come through here, and none of them is a retry.
   */
  async reconcile(
    identity: OperationIdentity,
    settled: 'committed' | 'failed_before_dispatch',
    evidence: { result?: unknown; detail: string },
  ): Promise<IdempotencyRecord> {
    const stored = await this.mustRead(identity);
    if (stored.state !== 'outcome_unknown') {
      throw new Error(
        `RECONCILIATION APPLIES ONLY TO AN UNKNOWN OUTCOME; ${identity.idempotencyKey} is ${stored.state}.`,
      );
    }
    return this.transition(identity, settled, evidence);
  }

  /**
   * Begin a NEW attempt after a failure that never dispatched.
   *
   * Explicit by design: nothing retries on its own, and the attempt counter
   * makes the second try visible in the record rather than erasing the first.
   */
  async reattempt(identity: OperationIdentity): Promise<IdempotencyRecord> {
    const stored = await this.mustRead(identity);
    const next = reattempt(stored, this.now());
    await this.persistence.write(next);
    return next;
  }

  async read(identity: OperationIdentity): Promise<IdempotencyRecord | null> {
    return this.persistence.read(identity.idempotencyKey, identity.actor, identity.scope);
  }

  private async mustRead(identity: OperationIdentity): Promise<IdempotencyRecord> {
    const stored = await this.read(identity);
    if (!stored) {
      throw new Error(`NO IDEMPOTENCY RECORD for ${identity.idempotencyKey}; nothing to settle.`);
    }
    const verdict = verdictFor(stored, identity, this.now());
    if (verdict.kind === 'refused') {
      throw new Error(`IDENTITY MISMATCH settling ${identity.idempotencyKey}: ${verdict.message}`);
    }
    return stored;
  }

  private async transition(
    identity: OperationIdentity,
    to: IdempotencyState,
    extra: { result?: unknown; detail?: string; provenance?: OperationProvenance },
  ): Promise<IdempotencyRecord> {
    const stored = await this.mustRead(identity);
    const next = settle(stored, to, this.now(), extra);
    await this.persistence.write(next);
    return next;
  }
}

/**
 * In-memory persistence.
 *
 * Real for tests and for a single-process dev engine; NOT durable across a
 * restart, which is the one property the primitive exists to provide. The
 * SQLite adapter is the durable one — see `sqliteIdempotency.ts`.
 */
export class InMemoryIdempotencyPersistence implements IdempotencyPersistence {
  private readonly rows = new Map<string, IdempotencyRecord>();

  private static id(key: string, actor: string, scope: string): string {
    // The unique key, spelled out. See the header for why it is these three.
    return JSON.stringify([key, actor, scope]);
  }

  async insertIfAbsent(record: IdempotencyRecord): Promise<IdempotencyRecord | null> {
    const id = InMemoryIdempotencyPersistence.id(
      record.identity.idempotencyKey,
      record.identity.actor,
      record.identity.scope,
    );
    const existing = this.rows.get(id);
    if (existing) return existing;
    this.rows.set(id, record);
    return null;
  }

  async read(key: string, actor: string, scope: string): Promise<IdempotencyRecord | null> {
    return this.rows.get(InMemoryIdempotencyPersistence.id(key, actor, scope)) ?? null;
  }

  async write(record: IdempotencyRecord): Promise<void> {
    this.rows.set(
      InMemoryIdempotencyPersistence.id(
        record.identity.idempotencyKey,
        record.identity.actor,
        record.identity.scope,
      ),
      record,
    );
  }
}
