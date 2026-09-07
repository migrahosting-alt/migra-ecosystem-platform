/**
 * DURABLE IDEMPOTENCY — the invariants, each pinned to the bug it prevents.
 *
 * Run against BOTH backings: the in-memory one and the real SQLite one. The
 * point of the primitive is durability, and an invariant proven only in memory
 * says nothing about the property that matters.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canTransition,
  identityMismatch,
  mayDispatch,
  reattempt,
  settle,
  verdictFor,
  type IdempotencyRecord,
  type OperationIdentity,
} from '../src/engine/tools/idempotency.js';
import {
  IdempotencyStore,
  InMemoryIdempotencyPersistence,
  type IdempotencyPersistence,
} from '../src/engine/tools/idempotencyStore.js';
import { SqliteIdempotencyPersistence } from '../src/engine/tools/sqliteIdempotency.js';

const identity = (over: Partial<OperationIdentity> = {}): OperationIdentity => ({
  idempotencyKey: 'idem_1',
  toolId: 'conversations.rename',
  actor: 'user_a',
  scope: 'owner_a/workspace_a',
  normalizedInputHash: 'sha256:aaa',
  ...over,
});

const backings: Array<[string, () => IdempotencyPersistence]> = [
  ['in-memory', () => new InMemoryIdempotencyPersistence()],
  [
    'sqlite',
    () => new SqliteIdempotencyPersistence(new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'idem-')), 'idem.db'))),
  ],
];

for (const [name, make] of backings) {
  const store = () => new IdempotencyStore({ persistence: make() });

  /* ---------------- same key, same operation ---------------- */

  test(`${name}: a new operation is claimed, and only the claim may dispatch`, async () => {
    const verdict = await store().claim(identity());
    assert.equal(verdict.kind, 'claimed');
    assert.equal(mayDispatch(verdict), true);
  });

  test(`${name}: the same key and the same operation reconciles to ONE record`, async () => {
    const s = store();
    const first = await s.claim(identity());
    const second = await s.claim(identity());
    assert.equal(first.kind, 'claimed');
    assert.equal(second.kind, 'in_flight', 'a second caller must not be handed a claim');
    assert.equal(mayDispatch(second), false);
    assert.equal(second.record.attempt, 1, 'it is the same attempt, not a new one');
  });

  /* ---------------- same key, different operation ---------------- */

  test(`${name}: same key with a DIFFERENT INPUT HASH is refused`, async () => {
    const s = store();
    await s.claim(identity());
    const verdict = await s.claim(identity({ normalizedInputHash: 'sha256:bbb' }));
    assert.equal(verdict.kind, 'refused');
    assert.equal(verdict.kind === 'refused' && verdict.mismatch, 'input-changed');
    assert.equal(mayDispatch(verdict), false);
  });

  test(`${name}: same key with a DIFFERENT TOOL is refused`, async () => {
    const s = store();
    await s.claim(identity());
    const verdict = await s.claim(identity({ toolId: 'messages.send' }));
    assert.equal(verdict.kind === 'refused' && verdict.mismatch, 'different-tool');
  });

  test(`${name}: a key belongs to its ACTOR — another actor gets their own record`, async () => {
    const s = store();
    await s.claim(identity());
    // A different actor is not a collision: it is a different operation space,
    // so they get a clean claim rather than a refusal or someone else's result.
    const verdict = await s.claim(identity({ actor: 'user_b' }));
    assert.equal(verdict.kind, 'claimed');
  });

  test(`${name}: a key belongs to its SCOPE — another workspace gets its own record`, async () => {
    const s = store();
    await s.claim(identity());
    const verdict = await s.claim(identity({ scope: 'owner_a/workspace_b' }));
    assert.equal(verdict.kind, 'claimed');
  });

  /* ---------------- states refuse to dispatch again ---------------- */

  test(`${name}: COMMITTED cannot dispatch again, and returns the durable result`, async () => {
    const s = store();
    await s.claim(identity());
    await s.commit(identity(), { title: 'Renamed once' }, { requestId: 'req_1' });

    const verdict = await s.claim(identity());
    assert.equal(verdict.kind, 'already_committed');
    assert.equal(mayDispatch(verdict), false);
    assert.deepEqual(verdict.record.result, { title: 'Renamed once' });
  });

  test(`${name}: PENDING cannot blindly dispatch again`, async () => {
    const s = store();
    await s.claim(identity());
    assert.equal(mayDispatch(await s.claim(identity())), false);
  });

  test(`${name}: 🚨 OUTCOME_UNKNOWN requires reconciliation, and never a retry`, async () => {
    const s = store();
    await s.claim(identity());
    await s.markOutcomeUnknown(identity(), 'the connection dropped after dispatch');

    const verdict = await s.claim(identity());
    assert.equal(verdict.kind, 'needs_reconciliation');
    assert.equal(mayDispatch(verdict), false, 'retrying an unknown outcome is how one send becomes two');

    await assert.rejects(() => s.reattempt(identity()), /reconcile it, never retry it/);
  });

  test(`${name}: reconciliation settles an unknown outcome with what was FOUND OUT`, async () => {
    const s = store();
    await s.claim(identity());
    await s.markOutcomeUnknown(identity(), 'unobserved');
    const settled = await s.reconcile(identity(), 'committed', {
      result: { title: 'It had landed' },
      detail: 'read back from the store',
    });
    assert.equal(settled.state, 'committed');
    assert.equal((await s.claim(identity())).kind, 'already_committed');
  });

  test(`${name}: FAILED_BEFORE_DISPATCH is retryable, explicitly and countably`, async () => {
    const s = store();
    await s.claim(identity());
    await s.failBeforeDispatch(identity(), 'authorization was refused');

    const verdict = await s.claim(identity());
    assert.equal(verdict.kind, 'retryable');
    assert.equal(mayDispatch(verdict), false, 'even a retryable state does not self-authorise');

    const next = await s.reattempt(identity());
    assert.equal(next.state, 'pending');
    assert.equal(next.attempt, 2, 'the second try is visible in the record, not erased');
    assert.equal(next.detail, undefined, 'the old failure must not read as this attempt’s outcome');
  });

  /* ---------------- monotonic, and durable ---------------- */

  test(`${name}: a committed record can never go back to pending`, async () => {
    const s = store();
    await s.claim(identity());
    await s.commit(identity(), { ok: true });
    await assert.rejects(() => s.reattempt(identity()), /NOT PERMITTED from committed/);
    await assert.rejects(() => s.commit(identity(), { ok: true }), /ILLEGAL IDEMPOTENCY TRANSITION/);
  });

  test(`${name}: provenance links the record to the invocation that produced it`, async () => {
    const s = store();
    await s.claim(identity());
    await s.commit(identity(), { ok: true }, { requestId: 'req_9', approvalId: 'appr_9', settledAt: 5 });
    const stored = await s.read(identity());
    assert.equal(stored?.provenance?.requestId, 'req_9');
    assert.equal(stored?.provenance?.approvalId, 'appr_9');
  });
}

/* ------------------------------------------------------------------ *
 * Durability across a restart — the whole point, so it gets a real one
 * ------------------------------------------------------------------ */

test('a committed record survives closing and reopening the database', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'idem-restart-')), 'idem.db');

  const first = new DatabaseSync(path);
  const before = new IdempotencyStore({ persistence: new SqliteIdempotencyPersistence(first) });
  await before.claim(identity());
  await before.commit(identity(), { title: 'Durable' }, { requestId: 'req_restart' });
  first.close();

  // A new process would see exactly this: a fresh handle to the same file.
  const second = new DatabaseSync(path);
  const after = new IdempotencyStore({ persistence: new SqliteIdempotencyPersistence(second) });
  const verdict = await after.claim(identity());

  assert.equal(verdict.kind, 'already_committed', 'a restart must not make a committed operation dispatchable');
  assert.deepEqual(verdict.record.result, { title: 'Durable' });
  assert.equal(verdict.record.provenance?.requestId, 'req_restart');
  second.close();
});

test('an unknown outcome survives a restart still needing reconciliation', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'idem-unknown-')), 'idem.db');
  const first = new DatabaseSync(path);
  const before = new IdempotencyStore({ persistence: new SqliteIdempotencyPersistence(first) });
  await before.claim(identity());
  await before.markOutcomeUnknown(identity(), 'connection lost after dispatch');
  first.close();

  const second = new DatabaseSync(path);
  const after = new IdempotencyStore({ persistence: new SqliteIdempotencyPersistence(second) });
  const verdict = await after.claim(identity());
  assert.equal(verdict.kind, 'needs_reconciliation');
  assert.equal(mayDispatch(verdict), false, 'a restart is not a reconciliation');
  second.close();
});

/* ------------------------------------------------------------------ *
 * The atomic claim — the race the primitive exists for
 * ------------------------------------------------------------------ */

test('🚨 two identical claims racing: exactly ONE may dispatch', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'idem-race-')), 'idem.db');
  const db = new DatabaseSync(path);
  const persistence = new SqliteIdempotencyPersistence(db);
  const a = new IdempotencyStore({ persistence });
  const b = new IdempotencyStore({ persistence });

  const [first, second] = await Promise.all([a.claim(identity()), b.claim(identity())]);
  const dispatchers = [first, second].filter(mayDispatch);
  assert.equal(
    dispatchers.length,
    1,
    'both callers were allowed to dispatch — this is the duplicate send, with a clean audit trail',
  );
  db.close();
});

/* ------------------------------------------------------------------ *
 * The pure layer, directly
 * ------------------------------------------------------------------ */

test('identity comparison reports the most specific difference', () => {
  const base = identity();
  assert.equal(identityMismatch(base, base), null);
  assert.equal(identityMismatch(base, identity({ toolId: 'x' })), 'different-tool');
  assert.equal(identityMismatch(base, identity({ actor: 'x' })), 'different-actor');
  assert.equal(identityMismatch(base, identity({ scope: 'x' })), 'different-scope');
  assert.equal(identityMismatch(base, identity({ normalizedInputHash: 'x' })), 'input-changed');
});

test('identity is checked BEFORE state, so a reused key never returns a stranger’s result', () => {
  const committed: IdempotencyRecord = {
    identity: identity(),
    state: 'committed',
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
    result: { secret: 'someone else’s outcome' },
  };
  const verdict = verdictFor(committed, identity({ normalizedInputHash: 'different' }), 2);
  assert.equal(verdict.kind, 'refused', 'a committed record with a reused key must report the REUSE');
});

test('the state ladder is monotonic in both directions it could break', () => {
  assert.equal(canTransition('pending', 'committed'), true);
  assert.equal(canTransition('pending', 'outcome_unknown'), true);
  assert.equal(canTransition('outcome_unknown', 'committed'), true);
  assert.equal(canTransition('committed', 'pending'), false);
  assert.equal(canTransition('committed', 'outcome_unknown'), false);
  assert.equal(canTransition('outcome_unknown', 'pending'), false);
  assert.equal(canTransition('failed_before_dispatch', 'committed'), false);
  assert.equal(canTransition('pending', 'pending'), false);
});

test('settle refuses an illegal transition rather than writing it', () => {
  const record: IdempotencyRecord = {
    identity: identity(),
    state: 'committed',
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  assert.throws(() => settle(record, 'pending', 2), /ILLEGAL IDEMPOTENCY TRANSITION/);
  assert.throws(() => reattempt(record, 2), /NOT PERMITTED from committed/);
});
