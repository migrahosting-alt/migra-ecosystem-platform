/**
 * The anonymous quota ledger, against real PostgreSQL.
 *
 * The central claim — "two concurrent turns cannot both take the last
 * allowance" — is a claim about database locking. It cannot be demonstrated
 * with a fake: a mock would assert my own belief about `FOR UPDATE`, which is
 * the thing under test.
 *
 * Everything here runs as the NON-SUPERUSER application role, because the
 * isolation assertions are meaningless on a connection that bypasses row-level
 * security.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import { evaluateAnonymousQuota } from '@migrapilot/shared-types/anonymous-quota';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let connection: PostgresConnection;
let store: PostgresDurableStore;

const LIMIT = 5;
const HOLD = 60_000;
let seq = 0;
const session = (name: string) => ({ id: `anon-${name}`, scope: `anon:${name}` });
const rid = () => `res-${(seq += 1)}`;

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  const owner = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await owner.migrate();
  await owner.close();
  connection = new PostgresConnection({ databaseUrl: await appRoleUrl(pg.databaseUrl), max: 8 });
  store = new PostgresDurableStore(connection);
}, { timeout: 180_000 });

after(async () => {
  await connection?.close().catch(() => undefined);
  await pg?.stop();
});

const reserve = (s: { id: string; scope: string }, now = 1_000, conversationId?: string) =>
  store.reserveAnonymousTurn({
    anonymousSessionId: s.id, ownerScope: s.scope, turnLimit: LIMIT,
    reservationId: rid(), holdMs: HOLD, now, ...(conversationId ? { conversationId } : {}),
  });

test('a first-time visitor gets their full allowance', { skip: skip ?? false }, async () => {
  const s = session('first');
  const r = await reserve(s);
  assert.equal(r.ok, true);
  assert.equal(r.quota.turnLimit, LIMIT);
  assert.equal(r.quota.used, 1, 'the reservation itself counts immediately, before any answer exists');
});

test('holds count toward usage — an unsettled turn is not free', { skip: skip ?? false }, async () => {
  const s = session('holds');
  await reserve(s);
  await reserve(s);
  const q = await store.getAnonymousQuota(s.id, s.scope);
  assert.equal(q?.used, 2, 'two turns in flight consume two of the allowance');
});

test('a released reservation returns the allowance', { skip: skip ?? false }, async () => {
  const s = session('release');
  const r = await reserve(s);
  assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, 1);

  const released = await store.releaseAnonymousReservation(r.reservationId!, s.scope);
  assert.equal(released, true);
  assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, 0, 'our outage does not cost the visitor a turn');
});

test('a consumed reservation does NOT return the allowance', { skip: skip ?? false }, async () => {
  const s = session('consume');
  const r = await reserve(s);
  await store.consumeAnonymousReservation(r.reservationId!, s.scope, 2_000);
  assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, 1);

  // And it cannot be released afterwards to win the turn back.
  assert.equal(await store.releaseAnonymousReservation(r.reservationId!, s.scope), false);
  assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, 1, 'a served answer stays paid for');
});

test('consuming the same reservation twice is REFUSED', { skip: skip ?? false }, async () => {
  // Otherwise a retried settle charges the visitor twice for one answer.
  const s = session('double-consume');
  const r = await reserve(s);
  await store.consumeAnonymousReservation(r.reservationId!, s.scope, 2_000);
  await assert.rejects(
    () => store.consumeAnonymousReservation(r.reservationId!, s.scope, 3_000),
    /not in the 'held' state/,
  );
  assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, 1);
});

test('exhaustion refuses further turns', { skip: skip ?? false }, async () => {
  const s = session('exhaust');
  for (let i = 0; i < LIMIT; i += 1) {
    assert.equal((await reserve(s)).ok, true, `turn ${i + 1} of ${LIMIT} must be allowed`);
  }
  const overflow = await reserve(s);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.refusal, 'exhausted');
  assert.equal(overflow.reservationId, undefined, 'no hold is created for a refused turn');
});

test('CONCURRENT turns cannot both take the last allowance', { skip: skip ?? false }, async () => {
  /*
   * The reason this ledger exists. Two tabs press send at the same instant with
   * one turn left. Without `FOR UPDATE` both read `remaining: 1`, both insert,
   * and the visitor gets a free turn — the same race a post-generation `count++`
   * loses, moved down a layer.
   *
   * Ten concurrent attempts against a single remaining turn: exactly one wins.
   */
  const s = session('race');
  for (let i = 0; i < LIMIT - 1; i += 1) await reserve(s);
  assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, LIMIT - 1, 'one turn left');

  const attempts = await Promise.all(Array.from({ length: 10 }, () => reserve(s)));
  const won = attempts.filter((a) => a.ok);
  assert.equal(won.length, 1, `exactly one of ten concurrent turns may win, got ${won.length}`);
  assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, LIMIT, 'never over the limit');
});

test('an EXPIRED hold is reclaimed — a dead turn does not cost forever',
  { skip: skip ?? false }, async () => {
    // The browser closed mid-stream and nothing ever settled.
    const s = session('expiry');
    await store.reserveAnonymousTurn({
      anonymousSessionId: s.id, ownerScope: s.scope, turnLimit: LIMIT,
      reservationId: rid(), holdMs: 1, now: 1_000,
    });
    assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, 1);

    // A later reserve sweeps this session's expired holds first.
    const later = await reserve(s, 9_999_999);
    assert.equal(later.ok, true);
    assert.equal(later.quota.used, 1, 'the dead hold was reclaimed, not stacked on top of');
  });

test('one visitor cannot see or spend another visitor\'s allowance', { skip: skip ?? false }, async () => {
  const a = session('iso-a');
  const b = session('iso-b');
  const ra = await reserve(a);
  await reserve(b);

  assert.equal((await store.getAnonymousQuota(a.id, a.scope))?.used, 1);
  assert.equal(await store.getAnonymousQuota(a.id, b.scope), undefined,
    "B's scope cannot even see A's quota row");

  await assert.rejects(
    () => store.consumeAnonymousReservation(ra.reservationId!, b.scope, 2_000),
    /not in the 'held' state/,
    "B must not be able to spend A's reservation",
  );
  assert.equal(await store.releaseAnonymousReservation(ra.reservationId!, b.scope), false,
    "nor release it to grief A's allowance");
  assert.equal((await store.getAnonymousQuota(a.id, a.scope))?.used, 1, 'A is untouched');
});

test('the ledger and the render-time projection agree', { skip: skip ?? false }, async () => {
  /*
   * `evaluateAnonymousQuota` is what the UI renders; the ledger is what decides.
   * If they disagree the user is told one thing and charged another — warning
   * banners that never appear, or a refusal with "3 messages left" on screen.
   */
  const s = session('projection');
  for (let i = 0; i < 3; i += 1) await reserve(s);
  const row = (await store.getAnonymousQuota(s.id, s.scope))!;
  const projected = evaluateAnonymousQuota({ limit: row.turnLimit, used: row.used });

  assert.equal(projected.remaining, 2);
  assert.equal(projected.warning, true, 'two left is inside the warning threshold');
  assert.equal(projected.exhausted, false);
  assert.equal(projected.allowed, true);

  await reserve(s);
  await reserve(s);
  const full = (await store.getAnonymousQuota(s.id, s.scope))!;
  const atLimit = evaluateAnonymousQuota({ limit: full.turnLimit, used: full.used });
  assert.equal(atLimit.remaining, 0);
  assert.equal(atLimit.exhausted, true);
  assert.equal(atLimit.allowed, false);
  assert.equal((await reserve(s)).ok, false, 'and the ledger refuses, matching what the UI showed');
});

test('claiming records the account and cannot be repeated', { skip: skip ?? false }, async () => {
  const s = session('claim');
  await reserve(s);
  await store.markAnonymousClaimed(s.id, s.scope, 'user:real-account', 5_000);

  const q = await store.getAnonymousQuota(s.id, s.scope);
  assert.equal(q?.claimedBy, 'user:real-account');
  assert.equal(q?.claimedAt, 5_000);

  await assert.rejects(
    () => store.markAnonymousClaimed(s.id, s.scope, 'user:someone-else', 6_000),
    /already claimed/,
    'a second account must not be able to take the same anonymous history',
  );
});

test('a claimed session keeps its spent allowance — no fresh quota by re-presenting the cookie',
  { skip: skip ?? false }, async () => {
    const s = session('claim-quota');
    for (let i = 0; i < LIMIT; i += 1) await reserve(s);
    await store.markAnonymousClaimed(s.id, s.scope, 'user:acct', 5_000);

    const after = await reserve(s);
    assert.equal(after.ok, false, 'the allowance is spent and stays spent');
    assert.equal((await store.getAnonymousQuota(s.id, s.scope))?.used, LIMIT);
  });
