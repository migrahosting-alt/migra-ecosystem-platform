/**
 * Readiness must survive a restart, and must stay scoped to its owner.
 *
 * The whole reason this state is in the database is that a scanned book takes
 * minutes: the browser closes, the service restarts, and the answer to "is this
 * readable yet" still has to be right.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { withScope } from '../src/engine/persistence/postgres/conversationRepo.js';
import {
  recordReadiness, readReadiness, listReadiness, findInterrupted, deleteReadiness,
} from '../src/engine/persistence/postgres/documentProcessingRepo.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;
let appUrl: string;

const A = { ownerScope: 'user:alice', workspaceScope: 'org:acme' };
const B = { ownerScope: 'user:bob', workspaceScope: 'org:globex' };

before(async () => {
  skip = await postgresTestSkipReason();
  if (!skip) {
    pg = await startDisposablePostgres();
    const c = new PostgresConnection({ databaseUrl: pg.databaseUrl });
    await c.migrate();
    await c.close();
    appUrl = await appRoleUrl(pg.databaseUrl);
  }
}, { timeout: 180_000 });

after(async () => { await pg?.stop(); });

async function scoped<T>(scope: typeof A, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = new PostgresConnection({ databaseUrl: appUrl });
  try {
    return await c.transaction((client) => withScope(client, scope, () => fn(client)));
  } finally {
    await c.close();
  }
}

test('readiness survives a fresh connection — the point of storing it', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => recordReadiness(c, A, {
    fileName: 'book.pdf', state: 'processing', stage: 'reading_text',
    detail: 'page 18 of 56', pagesTotal: 56, pagesDone: 18, startedAt: 1_000,
  }, 2_000));

  // A completely separate connection, as after a restart.
  const seen = await scoped(A, (c) => readReadiness(c, A, 'book.pdf'));
  assert.equal(seen?.state, 'processing');
  assert.equal(seen?.stage, 'reading_text');
  assert.equal(seen?.detail, 'page 18 of 56');
  assert.equal(seen?.pagesDone, 18);
  assert.equal(seen?.startedAt, 1_000, 'the original start time is not overwritten by a progress write');
});

test('progress updates replace state without losing when it started', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => recordReadiness(c, A, {
    fileName: 'progress.pdf', state: 'processing', stage: 'rendering_pages', startedAt: 500,
  }, 600));
  await scoped(A, (c) => recordReadiness(c, A, {
    fileName: 'progress.pdf', state: 'processing', stage: 'indexing',
  }, 900));

  const seen = await scoped(A, (c) => readReadiness(c, A, 'progress.pdf'));
  assert.equal(seen?.stage, 'indexing');
  assert.equal(seen?.startedAt, 500, 'COALESCE keeps the first start time');
  assert.equal(seen?.updatedAt, 900);
});

test('sequence completeness is STORED, not inferred later', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => recordReadiness(c, A, {
    fileName: 'partial.pdf', state: 'ready_with_unplaced_pages',
    orderedPages: 21, unplacedPages: 3, sequenceComplete: false,
  }, 1_500));

  const seen = await scoped(A, (c) => readReadiness(c, A, 'partial.pdf'));
  assert.equal(seen?.state, 'ready_with_unplaced_pages');
  assert.equal(seen?.sequenceComplete, false, 'retrieval must read this, never deduce it from prose');
  assert.equal(seen?.unplacedPages, 3);
});

test('one tenant cannot see another tenant\'s document state', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => recordReadiness(c, A, { fileName: 'alice-only.pdf', state: 'ready' }, 1_000));
  const bobSees = await scoped(B, (c) => readReadiness(c, B, 'alice-only.pdf'));
  assert.equal(bobSees, undefined, 'row-level security must hide it entirely');

  const bobList = await scoped(B, (c) => listReadiness(c, B));
  assert.equal(bobList.some((r) => r.fileName === 'alice-only.pdf'), false);
});

test('interrupted jobs are findable after a crash', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => recordReadiness(c, A, { fileName: 'crashed.pdf', state: 'processing', stage: 'reading_text' }, 1_000));
  await scoped(A, (c) => recordReadiness(c, A, { fileName: 'done.pdf', state: 'ready' }, 1_000));

  const stuck = await scoped(A, (c) => findInterrupted(c, A));
  const names = stuck.map((r) => r.fileName);
  assert.ok(names.includes('crashed.pdf'), 'a job nothing is working on must be discoverable');
  assert.equal(names.includes('done.pdf'), false, 'a finished document is not interrupted');
});

test('deleting a document removes its readiness', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => recordReadiness(c, A, { fileName: 'gone.pdf', state: 'ready' }, 1_000));
  await scoped(A, (c) => deleteReadiness(c, A, 'gone.pdf'));
  assert.equal(await scoped(A, (c) => readReadiness(c, A, 'gone.pdf')), undefined);
});
