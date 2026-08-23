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

/**
 * SIGN IN, SIGN OUT, COME BACK WITH THE SAME COOKIE.
 *
 * Keeping the quota row as evidence only works if something reads the evidence.
 * `used` is derived from reservations and a claim retires none of them, so a
 * claimed session read back as a FULL allowance — five more turns of real
 * inference, and repeatable for as long as anyone cared to. Found on
 * chat.migrateck.com after the claim itself was fixed.
 */
test('a CLAIMED session cannot buy a fresh allowance', { skip: skip ?? false }, async () => {
  const s = session('claim-refresh');
  await reserve(s);
  await store.saveConversation(conversation('conv-refresh', s.scope, s.scope) as never);
  await store.claimAnonymousConversation({
    conversationId: 'conv-refresh', anonymousSessionId: s.id, anonymousOwner: s.scope,
    accountOwner: 'user:refresher', accountWorkspace: 'personal:refresher', now: 13_000,
  });

  // Every hold is long gone, so a count of live reservations says "nothing used".
  const after = await reserve(s, 14_000);
  assert.equal(after.ok, false, 'the cookie is spent because its owner signed in, not because of a count');
  assert.equal(after.quota.used, after.quota.turnLimit, 'and it reads as fully spent, so the UI says so too');

  const projection = await store.getAnonymousQuota(s.id, s.scope);
  assert.ok(projection?.claimedBy, 'the evidence is still there to be read');
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

/* ── claiming an anonymous conversation into an account ──────────────────── */

const conversation = (id: string, owner: string, workspace: string) => ({
  id, ownerScope: owner, workspaceScope: workspace,
  title: 'anonymous thread', memoryMode: 'durable' as const, createdAt: 10, updatedAt: 10,
  groundingFiles: ['notes.md'],
});

const message = (id: string, conversationId: string, content: string) => ({
  id, conversationId, role: 'user' as const, content,
  status: 'complete' as const, createdAt: 20, durable: true,
});

test('signing in moves the conversation, keeping its ID and content', { skip: skip ?? false }, async () => {
  const s = session('claim-move');
  const ACCOUNT = { owner: 'user:claimer', workspace: 'personal:claimer' };
  const anonScope = { owner: s.scope, workspace: s.scope };

  await store.saveConversation(conversation('conv-claimed', s.scope, s.scope) as never);
  await store.saveMessage(message('m-1', 'conv-claimed', 'ANONYMOUS TURN ONE') as never, anonScope);
  await store.saveMessage(message('m-2', 'conv-claimed', 'ANONYMOUS TURN TWO') as never, anonScope);
  await reserve(s);

  const outcome = await store.claimAnonymousConversation({
    conversationId: 'conv-claimed', anonymousSessionId: s.id, anonymousOwner: s.scope,
    accountOwner: ACCOUNT.owner, accountWorkspace: ACCOUNT.workspace, now: 7_000,
  });
  assert.equal(outcome.conversationId, 'conv-claimed', 'the SAME id — the person is looking at this thread');
  assert.equal(outcome.messages, 2);

  const owned = await store.loadDurableForScope({ owner: ACCOUNT.owner, workspace: ACCOUNT.workspace });
  const conv = owned.conversations.find((c) => c.id === 'conv-claimed');
  assert.ok(conv, 'the account now owns it');
  assert.deepEqual(conv?.groundingFiles, ['notes.md'], 'grounding came with it');
  assert.deepEqual(
    owned.messages.filter((m) => m.conversationId === 'conv-claimed').map((m) => m.content),
    ['ANONYMOUS TURN ONE', 'ANONYMOUS TURN TWO'],
    'both turns, in order',
  );
});

test('the old anonymous token CANNOT read the conversation back', { skip: skip ?? false }, async () => {
  /*
   * The whole security point of the claim. Whoever still holds the anonymous
   * cookie — including someone who stole it — must not be able to keep reading
   * a thread that now belongs to a signed-in person.
   */
  const stillAnon = await store.loadDurableForScope({ owner: 'anon:claim-move', workspace: 'anon:claim-move' });
  assert.equal(stillAnon.conversations.some((c) => c.id === 'conv-claimed'), false,
    'the anonymous scope must no longer see it');
  assert.equal(stillAnon.messages.some((m) => m.conversationId === 'conv-claimed'), false,
    'nor its messages');
});

test('a second account cannot claim the same anonymous session', { skip: skip ?? false }, async () => {
  await store.saveConversation(conversation('conv-second', 'anon:claim-move', 'anon:claim-move') as never);
  await assert.rejects(
    () => store.claimAnonymousConversation({
      conversationId: 'conv-second', anonymousSessionId: 'anon-claim-move', anonymousOwner: 'anon:claim-move',
      accountOwner: 'user:thief', accountWorkspace: 'personal:thief', now: 8_000,
    }),
    /already claimed/,
  );
});

test('a FAILED claim moves nothing — the conversation stays where it was', { skip: skip ?? false }, async () => {
  /*
   * The rejection above happens AFTER the rows were moved inside the same
   * transaction. If that transaction did not roll back, the conversation would
   * be gone from the anonymous scope and sitting in an account that was refused.
   */
  const stillAnon = await store.loadDurableForScope({ owner: 'anon:claim-move', workspace: 'anon:claim-move' });
  assert.ok(stillAnon.conversations.some((c) => c.id === 'conv-second'),
    'the refused claim rolled back and left the conversation with the visitor');

  const thief = await store.loadDurableForScope({ owner: 'user:thief', workspace: 'personal:thief' });
  assert.equal(thief.conversations.length, 0, 'and nothing landed in the refused account');
});

test('claiming a conversation that is not yours reports NOT_FOUND, not someone else\'s data',
  { skip: skip ?? false }, async () => {
    const other = session('claim-other');
    await store.saveConversation(conversation('conv-elsewhere', other.scope, other.scope) as never);
    await reserve(other);

    const attacker = session('claim-attacker');
    await reserve(attacker);
    await assert.rejects(
      () => store.claimAnonymousConversation({
        conversationId: 'conv-elsewhere', anonymousSessionId: attacker.id, anonymousOwner: attacker.scope,
        accountOwner: 'user:attacker', accountWorkspace: 'personal:attacker', now: 9_000,
      }),
      /not visible to this anonymous session/,
    );

    const victim = await store.loadDurableForScope({ owner: other.scope, workspace: other.scope });
    assert.ok(victim.conversations.some((c) => c.id === 'conv-elsewhere'), 'the victim keeps their thread');
  });

/**
 * THE BUG THIS PINS COST A VISITOR EVERYTHING THEY HAD WRITTEN.
 *
 * The quota row is per anonymous SESSION; a claim is per CONVERSATION. A visitor
 * who used their allowance has several conversations, and `markClaimed` shared a
 * transaction with the move while insisting on `claimed_by IS NULL`. So the
 * first conversation marked the row, every later one was refused ALREADY_CLAIMED,
 * and — because the refusal happened inside the transaction — each refusal ROLLED
 * BACK its own move. Signing in kept one thread and abandoned the rest in a scope
 * whose cookie had just been revoked.
 *
 * Measured on chat.migrateck.com before the fix: three conversations in, one
 * reported "claimed", none actually moved.
 */
test('a visitor with SEVERAL conversations keeps all of them', { skip: skip ?? false }, async () => {
  const s = session('claim-many');
  const ACCOUNT = { owner: 'user:many', workspace: 'personal:many' };
  const anonScope = { owner: s.scope, workspace: s.scope };
  const ids = ['conv-many-1', 'conv-many-2', 'conv-many-3'];

  for (const id of ids) {
    await store.saveConversation(conversation(id, s.scope, s.scope) as never);
    await store.saveMessage(message(`m-${id}`, id, `TURN IN ${id}`) as never, anonScope);
  }
  await reserve(s);

  for (const id of ids) {
    const outcome = await store.claimAnonymousConversation({
      conversationId: id, anonymousSessionId: s.id, anonymousOwner: s.scope,
      accountOwner: ACCOUNT.owner, accountWorkspace: ACCOUNT.workspace, now: 11_000,
    });
    assert.equal(outcome.conversationId, id, `${id} keeps its id`);
  }

  const owned = await store.loadDurableForScope(ACCOUNT);
  assert.deepEqual(
    owned.conversations.filter((c) => ids.includes(c.id)).map((c) => c.id).sort(),
    [...ids].sort(),
    'every conversation came with the visitor, not just the first',
  );

  const left = await store.loadDurableForScope(anonScope);
  assert.deepEqual(
    left.conversations.filter((c) => ids.includes(c.id)),
    [],
    'and none is still sitting in the abandoned anonymous scope',
  );
});

test('a DIFFERENT account is still refused after the first has claimed', { skip: skip ?? false }, async () => {
  // The idempotency above must not have opened the door: re-asserting the SAME
  // account is a retry, a different one is a theft.
  await store.saveConversation(conversation('conv-many-4', 'anon:claim-many', 'anon:claim-many') as never);
  await assert.rejects(
    () => store.claimAnonymousConversation({
      conversationId: 'conv-many-4', anonymousSessionId: 'anon-claim-many', anonymousOwner: 'anon:claim-many',
      accountOwner: 'user:someone-else', accountWorkspace: 'personal:someone-else', now: 12_000,
    }),
    /already claimed/,
  );

  const stillAnon = await store.loadDurableForScope({ owner: 'anon:claim-many', workspace: 'anon:claim-many' });
  assert.ok(
    stillAnon.conversations.some((c) => c.id === 'conv-many-4'),
    'the refused claim rolled back — the conversation stayed with the visitor',
  );
});
