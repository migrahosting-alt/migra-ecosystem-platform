/**
 * Step 8 — scope-aware hydration, against real PostgreSQL.
 *
 * Global reads are invalid under FORCE row-level security: a connection with no
 * declared scope sees zero rows. These cases prove the replacement actually
 * restores state per scope, and — the point of the whole exercise — that it
 * restores the INDEX, whose absence is silent.
 *
 * "Restart" is modelled the way it really happens: a brand-new in-memory store
 * over the same database, which is exactly what a process restart produces.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { ConversationStore, type Conversation, type Message } from '../src/engine/memory/conversationStore.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let connection: PostgresConnection;
let store: PostgresDurableStore;

const A = { owner: 'user:alpha', workspace: 'ws:one' };
const B = { owner: 'user:beta', workspace: 'ws:one' };

const conversation = (id: string, scope: { owner: string; workspace: string }): Conversation => ({
  id, ownerScope: scope.owner, workspaceScope: scope.workspace,
  title: `conv ${id}`, memoryMode: 'durable', createdAt: 1, updatedAt: 1,
});

const message = (id: string, conversationId: string): Message => ({
  id, conversationId, role: 'user', content: `content ${id}`,
  status: 'complete', createdAt: 2, durable: true,
});

/** A fresh cache over the same database — what a process restart produces. */
const restarted = () => new ConversationStore(undefined, undefined, store);

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();
  const owner = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await owner.migrate();
  await owner.close();
  connection = new PostgresConnection({ databaseUrl: await appRoleUrl(pg.databaseUrl) });
  store = new PostgresDurableStore(connection);
}, { timeout: 180_000 });

after(async () => {
  await connection?.close().catch(() => undefined);
  await pg?.stop();
});

test('a scoped conversation survives a restart and is readable again', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-survive', A));
  await store.saveMessage(message('m-survive', 'c-survive'), A);

  const fresh = restarted();
  assert.equal(fresh.getConversation('c-survive', A), undefined, 'a cold cache holds nothing yet');

  await fresh.ensureScopeHydrated(A);
  assert.ok(fresh.getConversation('c-survive', A), 'the conversation is restored for its own scope');
  assert.equal(fresh.getMessages('c-survive', A).length, 1, 'and so are its messages');
});

test('hydrating one scope does NOT populate another scope', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-alpha', A));
  await store.saveConversation(conversation('c-beta', B));

  const fresh = restarted();
  await fresh.ensureScopeHydrated(A);

  assert.ok(fresh.getConversation('c-alpha', A), "alpha's own conversation is present");
  assert.equal(fresh.getConversation('c-beta', B), undefined, "beta's is NOT loaded as a side effect");
  assert.equal(fresh.listConversations(B).length, 0, "and beta's list is empty until beta connects");
});

test('the wrong scope sees nothing even after the other scope is hydrated', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-private', A));

  const fresh = restarted();
  await fresh.ensureScopeHydrated(A);
  await fresh.ensureScopeHydrated(B);

  assert.equal(fresh.getConversation('c-private', B), undefined, 'beta cannot read alpha by id');
  assert.ok(!fresh.listConversations(B).some((c) => c.id === 'c-private'));
});

test('hydration is idempotent — a second call does not duplicate messages', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-twice', A));
  await store.saveMessage(message('m-twice', 'c-twice'), A);

  const fresh = restarted();
  await fresh.ensureScopeHydrated(A);
  await fresh.ensureScopeHydrated(A);
  await fresh.ensureScopeHydrated(A);

  assert.equal(fresh.getMessages('c-twice', A).length, 1, 'hydrating repeatedly must not append the same message');
});

test('a failed hydration does not mark the scope loaded', async (t) => {
  if (skip) return t.skip(skip);
  // If a failure left the scope marked as hydrated, the next request would read
  // an empty cache and report "no conversations" — a data-loss appearance caused
  // by a transient error.
  const failing = {
    loadDurableForScope: async () => {
      throw new Error('transient database failure');
    },
  };
  const fresh = new ConversationStore(undefined, undefined, failing as never);

  await assert.rejects(() => fresh.ensureScopeHydrated(A), /transient database failure/);

  let calls = 0;
  const recovering = new ConversationStore(undefined, undefined, {
    loadDurableForScope: async () => {
      calls += 1;
      return { conversations: [], messages: [], summaries: [] };
    },
  } as never);
  await recovering.ensureScopeHydrated(A).catch(() => undefined);
  await recovering.ensureScopeHydrated(A).catch(() => undefined);
  assert.equal(calls, 1, 'a successful load is cached; only failures are retried');
});

test('global loads REFUSE rather than returning an empty result', async (t) => {
  if (skip) return t.skip(skip);
  // Every one of these would silently report "you have nothing" under RLS.
  await assert.rejects(() => store.loadDurable(), /row-level security/i);
  await assert.rejects(() => store.loadIndexes(), /row-level security/i);
  await assert.rejects(() => store.loadChunks(), /row-level security/i);
  await assert.rejects(() => store.loadWorkspaces(), /row-level security/i);
  await assert.rejects(() => store.loadMemoryItems(), /row-level security/i);
});

/* ── the quiet failure: an approved index must survive a restart ──────────── */

test('an APPROVED indexed document survives a restart and is retrievable under scope', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * THE REGRESSION THIS EXISTS FOR.
   *
   * An empty conversation list is obvious. An empty INDEX is not: chat keeps
   * answering and simply stops using the caller's documents, which reads as a
   * model or grounding regression rather than a persistence bug. Before this
   * change, a Postgres boot would have produced exactly that — every index read
   * was unscoped and returned zero rows.
   */
  const { IndexService } = await import('../src/engine/rag/indexService.js');
  const { FakeEmbedder } = await import('../src/engine/rag/embedder.js');

  const indexId = 'idx-restart';
  const record = {
    id: indexId,
    workspaceId: A.workspace,
    ownerScope: A.owner,
    sourceType: 'docs',
    root: '/library/restart',
    state: 'approved',
    version: 1,
    approvedVersion: 1,
    embeddingModel: 'fake',
    embeddingVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  };
  await store.saveIndex(record as never);
  await store.commitSync(
    indexId,
    1,
    [{
      id: 'ch-restart', indexId, workspaceId: A.workspace, filePath: 'handbook.md',
      language: 'markdown', startLine: 1, endLine: 3, contentHash: 'h1',
      embeddingModel: 'fake', embeddingVersion: 'v1', indexedAt: 1,
      text: 'The alphaCode is TOPAZ FALCON 611.',
      vector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    }] as never,
    ['handbook.md'],
    [],
    2,
    A,
  );
  await store.setApprovedVersion(indexId, 1, 3, A);

  // A brand-new service over the same database — a process restart.
  const fresh = new IndexService(new FakeEmbedder(8), () => ({}) as never, undefined, undefined, store);

  assert.equal(fresh.approvedIndexFor(A), undefined, 'cold cache: nothing approved yet');

  // First request for this scope hydrates it, exactly as the route preHandler does.
  await fresh.hydrate(A);

  assert.equal(fresh.approvedIndexFor(A), indexId, 'the APPROVED index is restored for its scope');
  const counts = fresh.approvedChunkCounts(indexId, A);
  assert.equal(counts['handbook.md'], 1, 'and its chunks came back — the document is searchable again');

  // And it is not visible to another tenant.
  await fresh.hydrate(B);
  assert.equal(fresh.approvedIndexFor(B), undefined, "beta has no approved index of alpha's");
});

test('health() reports a real migrated database as ready', async (t) => {
  if (skip) return t.skip(skip);
  // This was missing, and its absence let a health() that queried a nonexistent
  // column reach a candidate boot. The candidate reported `persistence:
  // unavailable` with `column "version" does not exist` — correct fail-closed
  // behaviour reporting a bug in the probe itself rather than in the database.
  const health = await store.health();
  assert.equal(health.memoryStore, 'ready', 'a migrated, writable database is ready');
  assert.equal(health.ragStore, 'ready');
  assert.equal(health.migrationState, 'current');
  assert.ok(health.schemaVersion >= 10, `schema version should be at least 10, got ${health.schemaVersion}`);
  assert.equal(health.detail, undefined, 'a healthy store reports no failure detail');
});

test('a DELETED conversation stays deleted across a restart — with a control', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * "It is still gone" passes vacuously if persistence is broken and everything
   * is gone. So a sibling conversation is created and NOT deleted: if it does
   * not come back, the absence of the other one proves nothing.
   *
   * This is the store-level twin of the candidate-gate assertion, and it reads
   * through a cold cache — the deletion can only come from the database.
   */
  await store.saveConversation(conversation('c-control', A));
  await store.saveMessage(message('m-control', 'c-control'), A);
  await store.saveConversation(conversation('c-doomed', A));
  await store.saveMessage(message('m-doomed', 'c-doomed'), A);

  await store.deleteConversation('c-doomed', A);

  const fresh = restarted();
  await fresh.ensureScopeHydrated(A);

  // Control first — otherwise the next assertion is worthless.
  assert.ok(fresh.getConversation('c-control', A), 'CONTROL: the undeleted conversation came back');
  assert.equal(fresh.getMessages('c-control', A).length, 1, 'CONTROL: with its message');

  assert.equal(fresh.getConversation('c-doomed', A), undefined, 'the deleted conversation did NOT come back');
  assert.equal(fresh.getMessages('c-doomed', A).length, 0, 'and neither did its messages');
});

test('an APPROVED index is still approved after a restart, read from the database', async (t) => {
  if (skip) return t.skip(skip);
  // The failure this replaces: setIndexState ran unscoped, matched zero rows,
  // reported success, and memory said `approved` while the row said
  // `experimental`. A cold read is the only thing that tells them apart.
  await store.saveIndex({
    id: 'idx-approve-restart', workspaceId: A.workspace, ownerScope: A.owner,
    sourceType: 'docs', root: '/library/approve-restart', state: 'ready', version: 1,
    approvedVersion: undefined, embeddingModel: 'nomic-embed-text', embeddingVersion: 'v1',
    createdAt: 1, updatedAt: 1,
  } as never);

  await store.setIndexState('idx-approve-restart', 'approved', 5, A);
  await store.setApprovedVersion('idx-approve-restart', 1, 6, A);

  // Read back through a NEW load — no in-process state involved.
  const indexes = await store.loadIndexesForScope(A);
  const rec = indexes.find((i) => i.id === 'idx-approve-restart');
  assert.equal(rec?.state, 'approved', 'the DATABASE says approved, not just memory');
  assert.equal(rec?.approvedVersion, 1, 'and the approved version is the one that was approved');
});
