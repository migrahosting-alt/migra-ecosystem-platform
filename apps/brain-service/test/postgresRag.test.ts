/**
 * Sub-slice 2 · Group 3 — RAG index versions, chunks, embedding cache.
 *
 * Includes the negative test for the GLOBAL-SAFE embedding cache: it must not
 * be able to expose tenant provenance, because it deliberately has no RLS.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { withScope } from '../src/engine/persistence/postgres/conversationRepo.js';
import {
  InvalidVectorError, commitSync, deleteIndex, fromVectorBytes, getEmbedding, loadChunks,
  loadIndexes, pruneOlderThan, putEmbedding, saveIndex, setApprovedVersion, setIndexState,
  toVectorBytes,
} from '../src/engine/persistence/postgres/ragRepo.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import type { PersistedChunk, PersistedIndexRecord } from '../src/engine/persistence/types.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;
let tmp: string;
let appUrl: string;

const A = { ownerScope: 'user:alice', workspaceScope: 'org:acme' };
const B = { ownerScope: 'user:bob', workspaceScope: 'org:globex' };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'brain-g3-'));
  skip = await postgresTestSkipReason();
  if (!skip) {
    pg = await startDisposablePostgres();
    const c = new PostgresConnection({ databaseUrl: pg.databaseUrl });
    await c.migrate();
    await c.close();
    appUrl = await appRoleUrl(pg.databaseUrl);
  }
}, { timeout: 180_000 });

after(async () => {
  await pg?.stop();
  rmSync(tmp, { recursive: true, force: true });
});

const conn = () => new PostgresConnection({ databaseUrl: appUrl, applicationName: 'group3' });

async function scoped<T>(scope: typeof A, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = conn();
  try {
    return await c.transaction((client) => withScope(client, scope, () => fn(client)));
  } finally {
    await c.close();
  }
}

const index = (id: string, over: Partial<PersistedIndexRecord> = {}): PersistedIndexRecord => ({
  id, workspaceId: 'ws-1', ownerScope: A.ownerScope, sourceType: 'fs', root: '/srv/x',
  state: 'ready', version: 1, embeddingModel: 'm1', embeddingVersion: 'v1',
  createdAt: 1_000, updatedAt: 1_000, ...over,
});

const chunk = (id: string, over: Partial<PersistedChunk> = {}): PersistedChunk => ({
  id, indexId: 'idx-1', workspaceId: 'ws-1', filePath: 'a.ts', language: 'ts',
  startLine: 1, endLine: 10, contentHash: `h-${id}`, embeddingModel: 'm1', embeddingVersion: 'v1',
  indexedAt: 2_000, text: `text-${id}`, vector: [0.5, -0.25, 0.125, 1], ...over,
});

// ── VECTOR ENCODING PARITY ──────────────────────────────────────────────────

test('vector encoding is bit-identical to the SQLite Float32 representation', async (t) => {
  if (skip) return t.skip(skip);

  const original = [0.5, -0.25, 0.125, 1, -0.0009765625];
  const round = fromVectorBytes(toVectorBytes(original));
  assert.deepEqual(round, original, 'exactly representable float32 values must survive unchanged');

  // A value not representable in float32 must be truncated the SAME way as SQLite.
  const lossy = [0.1];
  const viaPg = fromVectorBytes(toVectorBytes(lossy))[0]!;
  const viaF32 = new Float32Array([0.1])[0]!;
  assert.equal(viaPg, viaF32, 'float32 truncation must match');
});

test('vector validation ladder matches the SQLite adapter exactly', async (t) => {
  if (skip) return t.skip(skip);

  assert.throws(() => toVectorBytes([]), InvalidVectorError, 'empty vector');
  assert.throws(() => toVectorBytes([Number.NaN]), InvalidVectorError, 'non-finite');
  assert.throws(() => toVectorBytes([Infinity]), InvalidVectorError, 'infinite');
  assert.throws(() => fromVectorBytes(null), InvalidVectorError, 'null blob');
  assert.throws(() => fromVectorBytes(new Uint8Array(0)), InvalidVectorError, 'empty blob');
  assert.throws(() => fromVectorBytes(new Uint8Array(3)), InvalidVectorError, 'misaligned blob');
  assert.throws(
    () => fromVectorBytes(toVectorBytes([1, 2, 3]), 4),
    InvalidVectorError,
    'dimension mismatch must fail clearly',
  );
});

test('mixed-width vectors in one index version are rejected on load', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveIndex(c, index('idx-dims'), A);
    await commitSync(c, 'idx-dims', 1,
      [chunk('ch-4d', { indexId: 'idx-dims', vector: [1, 2, 3, 4] })], ['a.ts'], [], 3_000, A);
    await commitSync(c, 'idx-dims', 1,
      [chunk('ch-2d', { indexId: 'idx-dims', filePath: 'b.ts', vector: [1, 2] })], ['b.ts'], [], 3_000, A);
  });

  await assert.rejects(
    () => scoped(A, (c) => loadChunks(c, 'idx-dims', 1)),
    InvalidVectorError,
    'the first row pins the width; a differing row must fail rather than corrupt ranking',
  );
});

// ── INDEX / CHUNK SEMANTICS ─────────────────────────────────────────────────

test('loadChunks is strictly version-scoped, never across versions', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveIndex(c, index('idx-v'), A);
    await commitSync(c, 'idx-v', 1, [chunk('c-v1', { indexId: 'idx-v' })], ['a.ts'], [], 1, A);
    await commitSync(c, 'idx-v', 2, [chunk('c-v2', { indexId: 'idx-v', filePath: 'b.ts' })], ['b.ts'], [], 2, A);
  });

  const v1 = await scoped(A, (c) => loadChunks(c, 'idx-v', 1));
  const v2 = await scoped(A, (c) => loadChunks(c, 'idx-v', 2));
  assert.deepEqual(v1.map((c) => c.id), ['c-v1']);
  assert.deepEqual(v2.map((c) => c.id), ['c-v2']);
});

test('commitSync removes deleted files and is atomic on failure', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveIndex(c, index('idx-sync'), A);
    await commitSync(c, 'idx-sync', 1, [
      chunk('s-a', { indexId: 'idx-sync', filePath: 'a.ts' }),
      chunk('s-b', { indexId: 'idx-sync', filePath: 'b.ts' }),
    ], ['a.ts', 'b.ts'], [], 1, A);
  });

  await scoped(A, (c) => commitSync(c, 'idx-sync', 1, [], [], ['b.ts'], 2, A));
  const after = await scoped(A, (c) => loadChunks(c, 'idx-sync', 1));
  assert.deepEqual(after.map((c) => c.id), ['s-a'], 'deleted file chunks are gone');

  // A bad vector mid-batch must leave the previous state intact.
  await assert.rejects(() => scoped(A, (c) => commitSync(c, 'idx-sync', 1, [
    chunk('s-good', { indexId: 'idx-sync', filePath: 'c.ts' }),
    chunk('s-bad', { indexId: 'idx-sync', filePath: 'd.ts', vector: [Number.NaN] }),
  ], ['c.ts', 'd.ts'], [], 3, A)));

  const rolledBack = await scoped(A, (c) => loadChunks(c, 'idx-sync', 1));
  assert.deepEqual(rolledBack.map((c) => c.id), ['s-a'], 'partial write must not survive');
});

test('approved version is independent of lifecycle state', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => saveIndex(c, index('idx-appr', { state: 'building' }), A));
  await scoped(A, (c) => setApprovedVersion(c, 'idx-appr', 7, 10));
  await scoped(A, (c) => setIndexState(c, 'idx-appr', 'ready', 11));

  let rec = (await scoped(A, loadIndexes)).find((i) => i.id === 'idx-appr')!;
  assert.equal(rec.approvedVersion, 7, 'advancing state must not move the pointer');
  assert.equal(rec.state, 'ready');

  await scoped(A, (c) => setIndexState(c, 'idx-appr', 'building', 12));
  rec = (await scoped(A, loadIndexes)).find((i) => i.id === 'idx-appr')!;
  assert.equal(rec.approvedVersion, 7, 'demoting state must not revoke approval');

  await scoped(A, (c) => setApprovedVersion(c, 'idx-appr', null, 13));
  rec = (await scoped(A, loadIndexes)).find((i) => i.id === 'idx-appr')!;
  assert.equal(rec.approvedVersion, undefined, 'null clears the pointer');
});

test('deleteIndex cascades chunks and versions', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveIndex(c, index('idx-del'), A);
    await commitSync(c, 'idx-del', 1, [chunk('d-1', { indexId: 'idx-del' })], ['a.ts'], [], 1, A);
  });
  await scoped(A, (c) => deleteIndex(c, 'idx-del'));

  const remaining = await scoped(A, async (c) => ({
    indexes: (await loadIndexes(c)).filter((i) => i.id === 'idx-del').length,
    chunks: (await c.query('SELECT id FROM index_chunks WHERE index_id = $1', ['idx-del'])).rows.length,
    versions: (await c.query('SELECT version FROM index_versions WHERE index_id = $1', ['idx-del'])).rows.length,
  }));
  assert.deepEqual(remaining, { indexes: 0, chunks: 0, versions: 0 });
});

// ── ISOLATION ───────────────────────────────────────────────────────────────

test('knowing another tenant index and version ids grants no chunk access', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveIndex(c, index('idx-known'), A);
    await commitSync(c, 'idx-known', 3, [chunk('secret-chunk', { indexId: 'idx-known', text: 'SECRET' })], ['a.ts'], [], 1, A);
  });

  const asB = await scoped(B, (c) => loadChunks(c, 'idx-known', 3));
  assert.equal(asB.length, 0, 'exact identifiers must not be a capability');

  const bSees = await scoped(B, async (c) => {
    const r = await c.query<{ text: string }>('SELECT text FROM index_chunks');
    return JSON.stringify(r.rows);
  });
  assert.ok(!bSees.includes('SECRET'), 'unfiltered SELECT must not leak chunk text');

  assert.equal((await scoped(A, (c) => loadChunks(c, 'idx-known', 3))).length, 1, 'owner still reads it');
});

test('index versions and chunks fail closed with no scope set', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveIndex(c, index('idx-noscope'), A);
    await commitSync(c, 'idx-noscope', 1, [chunk('ns-1', { indexId: 'idx-noscope' })], ['a.ts'], [], 1, A);
  });

  const c = conn();
  try {
    const counts = await c.transaction(async (client) => ({
      chunks: (await client.query('SELECT id FROM index_chunks')).rows.length,
      versions: (await client.query('SELECT version FROM index_versions')).rows.length,
    }));
    assert.deepEqual(counts, { chunks: 0, versions: 0 });
  } finally {
    await c.close();
  }
});

test('chunks cannot be re-homed into another scope', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveIndex(c, index('idx-rehome'), A);
    await commitSync(c, 'idx-rehome', 1, [chunk('rh-1', { indexId: 'idx-rehome', text: 'A-owned' })], ['a.ts'], [], 1, A);
  });

  await assert.rejects(
    () => scoped(B, (c) => commitSync(c, 'idx-rehome', 1,
      [chunk('rh-1', { indexId: 'idx-rehome', text: 'B-stolen' })], ['a.ts'], [], 2, B)),
    'B must not claim an existing chunk id',
  );

  const stillA = await scoped(A, (c) => loadChunks(c, 'idx-rehome', 1));
  assert.equal(stillA[0]!.text, 'A-owned');
});

// ── EMBEDDING CACHE: GLOBAL-SAFE ────────────────────────────────────────────

test('embedding cache is shared across tenants by design', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => putEmbedding(c, 'm1', 'v1', 'hash-shared', [1, 2, 3]));
  const fromB = await scoped(B, (c) => getEmbedding(c, 'm1', 'v1', 'hash-shared'));
  assert.deepEqual(fromB, [1, 2, 3], 'sharing is the point of a content-hash cache');
});

test('NEGATIVE: the cache schema cannot carry tenant provenance', async (t) => {
  if (skip) return t.skip(skip);

  const columns = await scoped(A, async (c) => {
    const r = await c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'embedding_cache'`,
    );
    return r.rows.map((x) => x.column_name).sort();
  });

  assert.deepEqual(columns, ['content_hash', 'created_at', 'dims', 'model', 'vector', 'version']);

  // The justification for having no RLS: there is nowhere to put tenant identity.
  for (const forbidden of ['owner_scope', 'workspace_scope', 'workspace_id', 'index_id', 'file_path', 'text', 'source_id']) {
    assert.ok(!columns.includes(forbidden), `cache must not carry '${forbidden}'`);
  }
});

test('cache lookups are keyed strictly by (model, version, hash)', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => putEmbedding(c, 'm1', 'v1', 'hash-k', [1, 1, 1]));
  assert.equal(await scoped(A, (c) => getEmbedding(c, 'm1', 'v2', 'hash-k')), undefined, 'version must not match across');
  assert.equal(await scoped(A, (c) => getEmbedding(c, 'm2', 'v1', 'hash-k')), undefined, 'model must not match across');
  assert.deepEqual(await scoped(A, (c) => getEmbedding(c, 'm1', 'v1', 'hash-k')), [1, 1, 1]);
});

test('cache pruning removes only entries older than the cutoff', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await putEmbedding(c, 'm1', 'v1', 'hash-old', [1]);
    await c.query(`UPDATE embedding_cache SET created_at = 1000 WHERE content_hash = 'hash-old'`);
    await putEmbedding(c, 'm1', 'v1', 'hash-new', [2]);
  });

  const removed = await scoped(A, (c) => pruneOlderThan(c, 5_000));
  assert.ok(removed >= 1, 'old entry pruned');
  assert.equal(await scoped(A, (c) => getEmbedding(c, 'm1', 'v1', 'hash-old')), undefined);
  assert.deepEqual(await scoped(A, (c) => getEmbedding(c, 'm1', 'v1', 'hash-new')), [2]);
});

// ── SQLite parity for the cache ─────────────────────────────────────────────

test('embedding cache round-trip matches SQLite', async (t) => {
  if (skip) return t.skip(skip);

  const vec = [0.5, -0.25, 0.125];
  const sqlite = new SqliteDurableStore(join(tmp, 'rag.db'));
  await sqlite.putEmbedding('m1', 'v1', 'h1', vec);
  const fromSqlite = await sqlite.getEmbedding('m1', 'v1', 'h1');
  const sqliteMiss = await sqlite.getEmbedding('m1', 'v2', 'h1');
  sqlite.close();

  await scoped(A, (c) => putEmbedding(c, 'm1', 'v1', 'h1', vec));
  const fromPg = await scoped(A, (c) => getEmbedding(c, 'm1', 'v1', 'h1'));
  const pgMiss = await scoped(A, (c) => getEmbedding(c, 'm1', 'v2', 'h1'));

  assert.deepEqual(fromPg, fromSqlite);
  assert.equal(pgMiss, sqliteMiss, 'both return undefined for a version miss');
});
