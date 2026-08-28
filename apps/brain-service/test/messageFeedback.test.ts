import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import { postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres } from './support/disposablePostgres.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;
let store: PostgresDurableStore;
let connection: PostgresConnection;

const A = { owner: 'user:alice', workspace: 'org:acme' };
const B = { owner: 'user:bob', workspace: 'org:globex' };

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  connection = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await connection.migrate();
  store = new PostgresDurableStore(connection);
}, { timeout: 180_000 });

after(async () => {
  await connection?.close();
  await pg?.stop();
});

test('a vote is recorded and read back', async (t) => {
  if (skip) return t.skip(skip);
  await store.putMessageFeedback(A, {
    conversationId: 'conv-1', messageId: 'msg-1', rating: 'up',
    requestId: 'req-1', modelId: 'qwen3:8b', providerId: 'local',
    turnContext: { grounded: true },
  }, 1000);

  const [f] = await store.listMessageFeedback(A, 'conv-1');
  assert.equal(f?.rating, 'up');
  assert.equal(f?.requestId, 'req-1');
  assert.equal(f?.turnContext?.grounded, true, 'turn provenance survives the round trip');
});

/*
 * The property the primary key exists for. Changing your mind must REPLACE the
 * opinion — an append-only table would leave two contradictory rows and push the
 * reconciliation onto whoever reads them later.
 */
test('changing a vote updates in place — never a second row', async (t) => {
  if (skip) return t.skip(skip);
  await store.putMessageFeedback(A, { conversationId: 'c2', messageId: 'm1', rating: 'up' }, 1000);
  await store.putMessageFeedback(A, {
    conversationId: 'c2', messageId: 'm1', rating: 'down', reason: 'incorrect', detail: 'wrong total',
  }, 2000);

  const rows = await store.listMessageFeedback(A, 'c2');
  assert.equal(rows.length, 1, 'one row, not two');
  assert.equal(rows[0]?.rating, 'down');
  assert.equal(rows[0]?.reason, 'incorrect');
  assert.equal(rows[0]?.detail, 'wrong total');
});

test('created_at survives an update; updated_at moves', async (t) => {
  if (skip) return t.skip(skip);
  await store.putMessageFeedback(A, { conversationId: 'c3', messageId: 'm1', rating: 'up' }, 1000);
  await store.putMessageFeedback(A, { conversationId: 'c3', messageId: 'm1', rating: 'down' }, 5000);
  const [f] = await store.listMessageFeedback(A, 'c3');
  // When someone FIRST reacted and when they last changed their mind are
  // different facts, and an evaluation pipeline will want both.
  assert.equal(f?.createdAt, 1000);
  assert.equal(f?.updatedAt, 5000);
});

test('retracting removes the record entirely', async (t) => {
  if (skip) return t.skip(skip);
  await store.putMessageFeedback(A, { conversationId: 'c4', messageId: 'm1', rating: 'down' }, 1000);
  assert.equal(await store.removeMessageFeedback(A, 'c4', 'm1'), true);
  assert.deepEqual(await store.listMessageFeedback(A, 'c4'), [], 'no tombstone left behind');
  // Withdrawing a vote you never cast is not an error — you end up in the state
  // you asked for either way.
  assert.equal(await store.removeMessageFeedback(A, 'c4', 'm1'), false);
});

/*
 * Feedback names a specific answer in a specific conversation. Leaking it across
 * tenants would leak both, so this is asserted like any other tenant-owned table.
 */
test('one tenant cannot see another tenant\'s feedback', async (t) => {
  if (skip) return t.skip(skip);
  await store.putMessageFeedback(A, { conversationId: 'shared-id', messageId: 'm1', rating: 'up' }, 1000);
  const seen = await store.listMessageFeedback(B, 'shared-id');
  assert.deepEqual(seen, [], 'a different owner sees nothing, even with the same conversation id');
});

test('a long note is bounded rather than rejected', async (t) => {
  if (skip) return t.skip(skip);
  // Losing someone's whole complaint because it was long would be worse than
  // storing the first part of it.
  await store.putMessageFeedback(A, {
    conversationId: 'c5', messageId: 'm1', rating: 'down', detail: 'x'.repeat(5000),
  }, 1000);
  const [f] = await store.listMessageFeedback(A, 'c5');
  assert.equal(f?.detail?.length, 2000);
});
