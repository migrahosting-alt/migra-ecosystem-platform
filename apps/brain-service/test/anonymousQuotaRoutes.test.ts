/**
 * The anonymous quota HTTP surface, against real PostgreSQL.
 *
 * These are the checks the Brain makes ON ITS OWN. The consumer gateway is the
 * trust boundary and derives every scope server-side, but "it came from a
 * friend" is not a reason to skip a check the Brain can make cheaply — a
 * malformed or mismatched pair is refused here too.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import { registerAnonymousQuotaRoutes } from '../src/engine/anonymousQuotaRoutes.js';
import { anonymousLimitsFromEnv } from '../src/engine/anonymousQuotaDeps.js';
import { installJsonBodyParser } from '../src/http/jsonBodyParser.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let connection: PostgresConnection;
let store: PostgresDurableStore | undefined;
let app: FastifyInstance;
let clock = 1_000;
let ids = 0;

const LIMIT = 3;
const anon = (name: string) => ({ 'x-owner-scope': `anon:${name}`, 'x-workspace-scope': `anon:${name}` });
const account = { 'x-owner-scope': 'user:acct', 'x-workspace-scope': 'personal:acct' };

const evictions: { anonymousOwner: string; accountOwner: string; accountWorkspace: string }[] = [];

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  const owner = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await owner.migrate();
  await owner.close();
  connection = new PostgresConnection({ databaseUrl: await appRoleUrl(pg.databaseUrl), max: 6 });
  store = new PostgresDurableStore(connection);

  app = Fastify();
  installJsonBodyParser(app);
  registerAnonymousQuotaRoutes(app, {
    store: () => store,
    turnLimit: () => LIMIT,
    holdMs: () => 60_000,
    now: () => clock,
    newId: () => `res-${(ids += 1)}`,
    // Recorded, not ignored: a claim that commits and does NOT evict is the
    // production bug this argument exists to prevent.
    onClaimed: (scopes) => evictions.push(scopes),
  });
  await app.ready();
}, { timeout: 180_000 });

after(async () => {
  await app?.close();
  await connection?.close().catch(() => undefined);
  await pg?.stop();
});

const call = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url, headers: { 'content-type': 'application/json', ...headers }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });

test('a brand-new visitor is told their full allowance without a row being created',
  async (t) => {
    if (skip) return t.skip(skip);
    const res = await call('GET', '/api/ai/anonymous/quota', anon('fresh'));
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.quota.limit, LIMIT);
    assert.equal(body.quota.used, 0);
    assert.equal(body.quota.remaining, LIMIT);
    assert.equal(body.quota.allowed, true);
    // Reading a page must not cost storage.
    assert.equal(await store!.getAnonymousQuota('fresh', 'anon:fresh'), undefined);
  });

test('a NON-anonymous scope is refused on the anonymous routes', async (t) => {
  if (skip) return t.skip(skip);
  // An authenticated caller reaching these routes means the gateway sent the
  // wrong request; answering it would apply an anonymous limit to a paying user.
  const res = await call('GET', '/api/ai/anonymous/quota', account);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'NOT_ANONYMOUS');
});

test('reserve decrements, and the count is the SERVER\'s', async (t) => {
  if (skip) return t.skip(skip);
  const h = anon('reserve');
  const first = await call('POST', '/api/ai/anonymous/reserve', h, {});
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().reservation.remainingAfterReservation, LIMIT - 1);

  const seen = await call('GET', '/api/ai/anonymous/quota', h);
  assert.equal(seen.json().quota.used, 1, 'the hold counts before any answer exists');
});

test('the warning fires before exhaustion, not at it', async (t) => {
  if (skip) return t.skip(skip);
  const h = anon('warn');
  await call('POST', '/api/ai/anonymous/reserve', h, {});
  const q = (await call('GET', '/api/ai/anonymous/quota', h)).json().quota;
  assert.equal(q.remaining, 2);
  assert.equal(q.warning, true, 'a visitor must be told before the door closes');
  assert.equal(q.exhausted, false);
});

test('exhaustion returns 429 with the quota, and creates NO hold', async (t) => {
  if (skip) return t.skip(skip);
  const h = anon('exhausted');
  for (let i = 0; i < LIMIT; i += 1) {
    assert.equal((await call('POST', '/api/ai/anonymous/reserve', h, {})).statusCode, 200);
  }
  const refused = await call('POST', '/api/ai/anonymous/reserve', h, {});
  assert.equal(refused.statusCode, 429, '429, not 403 — they are out of turns, not forbidden');
  assert.equal(refused.json().code, 'QUOTA_EXHAUSTED');
  assert.equal(refused.json().quota.exhausted, true);
  assert.equal(refused.json().reservation, undefined);

  const after = (await call('GET', '/api/ai/anonymous/quota', h)).json().quota;
  assert.equal(after.used, LIMIT, 'a refused turn does not consume anything extra');
});

test('settle with producedOutput consumes; a second settle is refused', async (t) => {
  if (skip) return t.skip(skip);
  const h = anon('settle-consume');
  const r = await call('POST', '/api/ai/anonymous/reserve', h, {});
  const id = r.json().reservation.reservationId;

  const ok = await call('POST', '/api/ai/anonymous/settle', h, { reservationId: id, producedOutput: true });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().settlement, 'consume');

  const again = await call('POST', '/api/ai/anonymous/settle', h, { reservationId: id, producedOutput: true });
  assert.equal(again.statusCode, 409, 'a retried settle must not charge twice');
  assert.equal(again.json().code, 'RESERVATION_NOT_HELD');
});

test('settle without output RELEASES — our outage is not the visitor\'s cost',
  async (t) => {
    if (skip) return t.skip(skip);
    const h = anon('settle-release');
    const r = await call('POST', '/api/ai/anonymous/reserve', h, {});
    const id = r.json().reservation.reservationId;
    assert.equal((await call('GET', '/api/ai/anonymous/quota', h)).json().quota.used, 1);

    const rel = await call('POST', '/api/ai/anonymous/settle', h, {
      reservationId: id, producedOutput: false, failure: 'brain_unreachable',
    });
    assert.equal(rel.statusCode, 200);
    assert.equal(rel.json().settlement, 'release');
    assert.equal((await call('GET', '/api/ai/anonymous/quota', h)).json().quota.used, 0);
  });

test('one visitor cannot settle another visitor\'s reservation', async (t) => {
  if (skip) return t.skip(skip);
  const victim = anon('settle-victim');
  const r = await call('POST', '/api/ai/anonymous/reserve', victim, {});
  const id = r.json().reservation.reservationId;

  const attacker = anon('settle-attacker');
  const stolen = await call('POST', '/api/ai/anonymous/settle', attacker, { reservationId: id, producedOutput: true });
  assert.equal(stolen.statusCode, 409, 'not this visitor\'s hold to spend');
  assert.equal((await call('GET', '/api/ai/anonymous/quota', victim)).json().quota.used, 1, 'victim untouched');
});

test('a claim must be made AS the account, never as the visitor', async (t) => {
  if (skip) return t.skip(skip);
  const res = await call('POST', '/api/ai/anonymous/claim', anon('claimer'), {
    conversationId: 'c1', anonymousSessionId: 'claimer', anonymousOwner: 'anon:claimer',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'NOT_AUTHENTICATED_SCOPE');
});

test('a mismatched anonymous pair is refused before any row moves', async (t) => {
  if (skip) return t.skip(skip);
  // A pair that does not agree means the caller assembled it rather than
  // deriving it from one verified cookie.
  const res = await call('POST', '/api/ai/anonymous/claim', account, {
    conversationId: 'c1', anonymousSessionId: 'alice', anonymousOwner: 'anon:bob',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'ANONYMOUS_SCOPE_MISMATCH');
});

test('claiming a conversation that is not there is 404, not a leak', async (t) => {
  if (skip) return t.skip(skip);
  const res = await call('POST', '/api/ai/anonymous/claim', account, {
    conversationId: 'no-such-conversation', anonymousSessionId: 'ghost', anonymousOwner: 'anon:ghost',
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().code, 'NOT_FOUND');
  assert.match(res.json().error, /not available to claim/,
    'the message must not distinguish "does not exist" from "not yours"');
});

test('a full claim moves the conversation and keeps its id', async (t) => {
  if (skip) return t.skip(skip);
  const h = anon('full-claim');
  await store!.saveConversation({
    id: 'conv-http-claim', ownerScope: 'anon:full-claim', workspaceScope: 'anon:full-claim',
    title: 'anonymous thread', memoryMode: 'durable', createdAt: 10, updatedAt: 10,
  } as never);
  await call('POST', '/api/ai/anonymous/reserve', h, {});

  const res = await call('POST', '/api/ai/anonymous/claim', account, {
    conversationId: 'conv-http-claim', anonymousSessionId: 'full-claim', anonymousOwner: 'anon:full-claim',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().conversationId, 'conv-http-claim');
  assert.equal(res.json().claimed, true);

  const owned = await store!.loadDurableForScope({ owner: 'user:acct', workspace: 'personal:acct' });
  assert.ok(owned.conversations.some((c) => c.id === 'conv-http-claim'));

  const second = await call('POST', '/api/ai/anonymous/claim', account, {
    conversationId: 'conv-http-claim', anonymousSessionId: 'full-claim', anonymousOwner: 'anon:full-claim',
  });
  assert.equal(second.statusCode, 404, 'it is no longer in the anonymous scope to claim again');

  /*
   * AND THE CACHE WAS TOLD. The move is a direct scoped transaction — it has to
   * be — so the in-memory conversation cache learns nothing from it. Without
   * this eviction the claim commits and both sides keep serving the old world:
   * the visitor still reads a thread that is no longer theirs, the account
   * cannot see the one it was just given, and the response says `claimed: true`
   * to both. That is exactly what production did.
   */
  const last = evictions.at(-1);
  assert.ok(last, 'a committed claim must evict');
  assert.equal(last?.accountOwner, 'user:acct');
  assert.equal(last?.accountWorkspace, 'personal:acct');
  assert.match(last?.anonymousOwner ?? '', /^anon:/);
});

test('persistence unavailable is 503, never an invented allowance', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * The failure that matters most: if the database is down, the honest answer is
   * "unavailable". Answering with a full allowance would hand out free inference
   * every time PostgreSQL hiccuped.
   */
  const saved = store;
  store = undefined;
  try {
    const q = await call('GET', '/api/ai/anonymous/quota', anon('down'));
    assert.equal(q.statusCode, 503);
    assert.equal(q.json().code, 'PERSISTENCE_UNAVAILABLE');

    const r = await call('POST', '/api/ai/anonymous/reserve', anon('down'), {});
    assert.equal(r.statusCode, 503, 'and no turn is granted while we cannot count it');
  } finally {
    store = saved;
  }
});

test('a mistyped limit falls back rather than becoming 0 or unlimited', () => {
  // `0` would mean no anonymous chat at all; NaN would make every comparison
  // false and mean unlimited. Both are worse than the default.
  assert.equal(anonymousLimitsFromEnv({ MIGRAPILOT_ANON_TURN_LIMIT: 'five' } as never).turnLimit, 5);
  assert.equal(anonymousLimitsFromEnv({ MIGRAPILOT_ANON_TURN_LIMIT: '0' } as never).turnLimit, 5);
  assert.equal(anonymousLimitsFromEnv({ MIGRAPILOT_ANON_TURN_LIMIT: '-3' } as never).turnLimit, 5);
  assert.equal(anonymousLimitsFromEnv({ MIGRAPILOT_ANON_TURN_LIMIT: '12' } as never).turnLimit, 12);
});
