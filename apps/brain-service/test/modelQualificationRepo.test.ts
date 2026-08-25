/**
 * Governed qualification, against a REAL PostgreSQL.
 *
 * Every behaviour that matters here is enforced by the database — a partial
 * unique index, a primary-key conflict, a conditional UPDATE's row count. A mock
 * would assert that my mental model of Postgres agrees with itself, which is the
 * one thing that cannot go wrong. If no database is available this SKIPS with a
 * stated reason rather than passing on zero assertions.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import {
  insertEvidenceRun, getEvidenceRun, insertDecision, effectiveApproval,
  approvedForCapability, revokeApproval, decisionHistory,
} from '../src/engine/persistence/postgres/modelQualificationRepo.js';
import { consumeNonce, pruneExpiredNonces } from '../src/engine/persistence/postgres/assertionNonceRepo.js';
import {
  postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;
let conn: PostgresConnection | undefined;

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  conn = new PostgresConnection({ databaseUrl: pg.databaseUrl, applicationName: 'qual-test' });
  await conn.migrate();
}, { timeout: 180_000 });

after(async () => {
  await conn?.close();
  await pg?.stop();
});

/* Each call runs in its own transaction on its own client, which is also what
 * makes the concurrency test meaningful — two genuinely separate sessions. */
const withClient = async <T>(fn: (c: never) => Promise<T>): Promise<T> =>
  conn!.transaction(fn as never) as Promise<T>;

const evidence = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), modelId: 'qwen2.5vl:7b', provider: 'local', capability: 'vision' as const,
  suite: 'vision-battery-v1', results: { ocr: 'pass' }, passed: true,
  createdAt: Date.now(), license: 'Apache-2.0', modelDigest: 'sha256:aaa', ...over,
});

const decision = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), modelId: 'qwen2.5vl:7b', capability: 'vision' as const,
  state: 'approved' as const, decidedAt: Date.now(),
  approverUserId: 'user:4fe95869', callingService: 'migrapilot-command-center',
  requestId: randomUUID(), modelDigest: 'sha256:aaa', ...over,
});

test('an approval is derived from the live decision, and revocation ends it', async (t) => {
  if (skip) return t.skip(skip);
  await withClient(async (c: never) => {
    const run = evidence();
    await insertEvidenceRun(c, run as never);
    await insertDecision(c, { ...decision(), evidenceRunId: run.id } as never);

    const live = await effectiveApproval(c, 'qwen2.5vl:7b', 'vision');
    assert.equal(live?.state, 'approved');
    assert.equal(live?.approverUserId, 'user:4fe95869');
    /* Chain of custody: the human AND the service that carried the request. */
    assert.equal(live?.callingService, 'migrapilot-command-center');
    assert.ok(live?.evidenceRunId, 'a decision points at the evidence that justified it');

    assert.equal(await revokeApproval(c, {
      modelId: 'qwen2.5vl:7b', capability: 'vision',
      revokedByUserId: 'user:4fe95869', reason: 'superseded', at: Date.now(),
    }), true);

    /* The NEXT read sees it gone — no cache to outlive the revocation. */
    assert.equal(await effectiveApproval(c, 'qwen2.5vl:7b', 'vision'), null);
    assert.equal((await approvedForCapability(c, 'vision')).length, 0);
  });
});

test('revoking twice is not success twice', async (t) => {
  if (skip) return t.skip(skip);
  await withClient(async (c: never) => {
    const again = await revokeApproval(c, {
      modelId: 'qwen2.5vl:7b', capability: 'vision',
      revokedByUserId: 'user:x', reason: 'again', at: Date.now(),
    });
    assert.equal(again, false, 'an UPDATE that matched nothing is not a revocation that happened');
  });
});

test('history survives revocation and re-approval', async (t) => {
  if (skip) return t.skip(skip);
  await withClient(async (c: never) => {
    const run = evidence({ id: randomUUID() });
    await insertEvidenceRun(c, run as never);
    await insertDecision(c, { ...decision(), evidenceRunId: run.id } as never);

    const history = await decisionHistory(c, 'qwen2.5vl:7b', 'vision');
    assert.ok(history.length >= 2, 'the revoked decision is still there');
    assert.ok(history.some((d) => d.revokedAt !== undefined), 'revocation is recorded, not deleted');
    assert.ok(history.some((d) => d.revokedAt === undefined), 'and the new approval is live');
  });
});

test('only one live approval per model+capability', async (t) => {
  if (skip) return t.skip(skip);
  await withClient(async (c: never) => {
    await assert.rejects(
      () => insertDecision(c, { ...decision(), id: randomUUID(), requestId: randomUUID() } as never),
      /duplicate key|unique/i,
      'the partial unique index must refuse a second live approval',
    );
  });
});

test('evidence is retrievable and carries its licence and identity', async (t) => {
  if (skip) return t.skip(skip);
  await withClient(async (c: never) => {
    const run = evidence({ id: randomUUID(), modelVersion: '7b-q4', license: 'Apache-2.0' });
    await insertEvidenceRun(c, run as never);
    const back = await getEvidenceRun(c, run.id);
    assert.equal(back?.license, 'Apache-2.0');
    assert.equal(back?.modelVersion, '7b-q4');
    assert.equal(back?.modelDigest, 'sha256:aaa');
    assert.equal(back?.passed, true);
  });
});

test('a request id can be consumed exactly once, even concurrently', async (t) => {
  if (skip) return t.skip(skip);
  const id = randomUUID();
  const now = Date.now();

  /*
   * Two attempts at the same moment, on separate connections. Insert-or-fail
   * means they contend on one row; a read-then-write would let both see
   * "unused" and both proceed.
   */
  const results = await Promise.all([
    withClient((c: never) => consumeNonce(c, { requestId: id, serviceId: 's', action: 'a', expiresAt: now + 60_000, now })),
    withClient((c: never) => consumeNonce(c, { requestId: id, serviceId: 's', action: 'a', expiresAt: now + 60_000, now })),
  ]);
  assert.equal(results.filter(Boolean).length, 1, 'exactly one may win');
});

test('a consumed nonce stays consumed across a new connection', async (t) => {
  if (skip) return t.skip(skip);
  const id = randomUUID();
  const now = Date.now();
  assert.equal(await withClient((c: never) => consumeNonce(c, { requestId: id, serviceId: 's', action: 'a', expiresAt: now + 60_000, now })), true);
  /* A fresh connection stands in for a restart: process memory would have
   * reopened this nonce, which is why it is a table. */
  assert.equal(await withClient((c: never) => consumeNonce(c, { requestId: id, serviceId: 's', action: 'a', expiresAt: now + 60_000, now })), false);
});

test('expired nonces are pruned, and live ones are not', async (t) => {
  if (skip) return t.skip(skip);
  const now = Date.now();
  const stale = randomUUID();
  const live = randomUUID();
  await withClient(async (c: never) => {
    await consumeNonce(c, { requestId: stale, serviceId: 's', action: 'a', expiresAt: now - 1, now });
    await consumeNonce(c, { requestId: live, serviceId: 's', action: 'a', expiresAt: now + 60_000, now });
    const removed = await pruneExpiredNonces(c, now);
    assert.ok(removed >= 1);
    /* The live one is untouched, so pruning cannot reopen a valid window. */
    assert.equal(await consumeNonce(c, { requestId: live, serviceId: 's', action: 'a', expiresAt: now + 60_000, now }), false);
  });
});
