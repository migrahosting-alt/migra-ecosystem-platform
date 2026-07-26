import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';
import { VectorIndex } from '../src/engine/rag/vectorIndex.js';

/**
 * Vector persistence and hydration must FAIL SAFE.
 *
 * The defect these tests pin, reproduced end to end on a real database file:
 *
 *   1. an `undefined` vector reached a chunk
 *   2. `toBlob(undefined)` did not throw — `new Float32Array(undefined)` is
 *      length 0, so it produced a 0-byte view
 *   3. a 0-length view over a 0-LENGTH BUFFER binds through `node:sqlite` as SQL
 *      **NULL** (unlike `new Uint8Array(0)`, which binds as `blob(0)`)
 *   4. the transaction COMMITTED — the transaction was never the problem
 *   5. `approxBytes()` then threw on `vector.length`, AFTER the commit
 *   6. the catch marked the index degraded IN MEMORY ONLY
 *   7. next startup: `fromBlob(null)` threw "Cannot read properties of null
 *      (reading 'buffer')" as an unhandled rejection — the Brain would not boot
 *      until the database was deleted
 *
 * So: reject at the write boundary, classify at the read boundary, validate the
 * whole candidate before BEGIN, and quarantine a damaged index instead of dying.
 */

const A: Scope = { owner: 'o', workspace: '/repo/a' };

/** These tests drive persistence directly; no file source is ever walked. */
const noSource = (): FileSource => ({ files: async () => [] });

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-vec-')), 'state.db');
}

/** The production column order, so binding behaviour is exercised exactly. */
const INSERT_CHUNK =
  `INSERT INTO index_chunks(id,index_id,workspace_id,file_path,language,symbol,start_line,end_line,content_hash,embedding_model,embedding_version,indexed_at,text,vector,index_version)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

/**
 * Write a chunk row with an arbitrary raw vector value, bypassing the guards —
 * the only way to simulate a database damaged by the OLD code.
 */
function insertRawChunk(dbPath: string, indexId: string, rawVector: unknown, indexVersion = 0): void {
  const db = new DatabaseSync(dbPath);
  db.prepare(INSERT_CHUNK).run(
    `${indexId}:v${indexVersion}:src/a.ts#1`, indexId, A.workspace, 'src/a.ts', 'ts', null, 1, 9,
    'hash', 'fake-embed', 'v0', 1, 'export const a = 1;', rawVector as never, indexVersion,
  );
  db.close();
}

function mkIndex(store: SqliteDurableStore): { svc: IndexService; id: string } {
  const svc = new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, store);
  const rec = svc.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });
  return { svc, id: rec.id };
}

// ── R1: serialization refuses every invalid vector ───────────────────────────

test('an invalid vector is refused before it can be written', (t) => {
  const dbPath = tmpDb();
  const store = new SqliteDurableStore(dbPath);
  t.after(() => store.close());
  const { id } = mkIndex(store);

  const base = {
    id: 'c1', indexId: id, workspaceId: A.workspace, filePath: 'src/a.ts', language: 'ts',
    symbol: undefined, startLine: 1, endLine: 9, contentHash: 'h',
    embeddingModel: 'fake-embed', embeddingVersion: 'v0', indexedAt: 1, text: 'x',
  };
  const invalid: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['empty array', []],
    ['not an array', 'not-a-vector'],
    ['object', { 0: 1 }],
    ['NaN', [1, Number.NaN, 3]],
    ['Infinity', [1, Number.POSITIVE_INFINITY]],
    ['-Infinity', [Number.NEGATIVE_INFINITY, 2]],
    ['non-numeric member', [1, 'two', 3]],
    ['overflows float32', [1e39]],
  ];

  for (const [label, vector] of invalid) {
    assert.throws(
      () => store.commitSync(id, 1, [{ ...base, vector } as never], ['src/a.ts'], [], 1),
      /invalid vector/,
      `must refuse ${label}`,
    );
  }

  // THE POINT: refusal happened before BEGIN, so nothing is durable.
  const db = new DatabaseSync(dbPath);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM index_chunks').get() as { n: number };
  db.close();
  assert.equal(n, 0, 'a rejected candidate must write no rows at all');
});

test('a mixed-width candidate is refused (one index, one vector width)', (t) => {
  const store = new SqliteDurableStore(tmpDb());
  t.after(() => store.close());
  const { id } = mkIndex(store);
  const chunk = (line: number, vector: number[]) => ({
    id: `c${line}`, indexId: id, workspaceId: A.workspace, filePath: 'src/a.ts', language: 'ts',
    symbol: undefined, startLine: line, endLine: line, contentHash: `h${line}`,
    embeddingModel: 'fake-embed', embeddingVersion: 'v0', indexedAt: 1, text: 'x', vector,
  });

  assert.throws(
    () => store.commitSync(id, 1, [chunk(1, [1, 2, 3, 4]), chunk(2, [1, 2])], ['src/a.ts'], [], 1),
    /wrong-dims/,
    'a narrower vector in the same index corrupts similarity silently — refuse it',
  );
});

test('a valid vector still round-trips exactly', (t) => {
  const store = new SqliteDurableStore(tmpDb());
  t.after(() => store.close());
  const { id } = mkIndex(store);
  const vector = [0.5, -0.25, 0, 1];

  store.commitSync(id, 1, [{
    id: 'c1', indexId: id, workspaceId: A.workspace, filePath: 'src/a.ts', language: 'ts',
    symbol: undefined, startLine: 1, endLine: 9, contentHash: 'h',
    embeddingModel: 'fake-embed', embeddingVersion: 'v0', indexedAt: 1, text: 'x', vector,
  }], ['src/a.ts'], [], 1);

  const [loaded] = store.loadChunks(id, 1);
  assert.deepEqual(loaded!.vector, vector, 'float32-exact values survive the round trip');
});

// ── R2: decode classifies every damaged shape ────────────────────────────────

test('every damaged blob shape is classified, not crashed on', (t) => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['SQL NULL', null, /null-blob/],
    ['the exact 0-length-buffer form that binds as NULL', new Uint8Array(new Float32Array(undefined as never).buffer), /null-blob/],
    ['empty blob', new Uint8Array(0), /empty-blob/],
    ['byte length not divisible by four', new Uint8Array([1, 2, 3]), /misaligned-blob/],
    ['non-finite decoded value', new Uint8Array(new Float32Array([Number.NaN]).buffer), /non-finite/],
  ];

  for (const [label, raw, expected] of cases) {
    const dbPath = tmpDb();
    const store = new SqliteDurableStore(dbPath);
    const { id } = mkIndex(store);
    store.close();
    insertRawChunk(dbPath, id, raw);

    const reopened = new SqliteDurableStore(dbPath);
    t.after(() => reopened.close());
    assert.throws(() => reopened.loadChunks(id, 0), expected, `must classify ${label}`);
  }
});

test('a classified fault names the chunk but never its source text', (t) => {
  const dbPath = tmpDb();
  const store = new SqliteDurableStore(dbPath);
  const { id } = mkIndex(store);
  store.close();
  insertRawChunk(dbPath, id, null);

  const reopened = new SqliteDurableStore(dbPath);
  t.after(() => reopened.close());
  try {
    reopened.loadChunks(id, 0);
    assert.fail('expected a classified fault');
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /src\/a\.ts#1/, 'identifies the offending chunk');
    assert.ok(!message.includes('export const a = 1;'), 'must never quote indexed source');
  }
});

// ── R2b: hydration quarantines instead of terminating the Brain ──────────────

test('a damaged index is quarantined at startup and the Brain keeps running', (t) => {
  const dbPath = tmpDb();
  const store = new SqliteDurableStore(dbPath);
  const good = new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, store);
  const damaged = good.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });
  const healthy = good.createIndex(A, { sourceType: 'workspace', root: '/repo/b' });
  const vector = [1, 2, 3, 4];
  store.commitSync(healthy.id, 1, [{
    id: 'h1', indexId: healthy.id, workspaceId: A.workspace, filePath: 'src/b.ts', language: 'ts',
    symbol: undefined, startLine: 1, endLine: 2, contentHash: 'hb',
    embeddingModel: 'fake-embed', embeddingVersion: 'v0', indexedAt: 1, text: 'b', vector,
  }], ['src/b.ts'], [], 1);
  store.setApprovedVersion(damaged.id, 0, 1);
  store.setIndexState(damaged.id, 'approved', 1);
  store.close();

  insertRawChunk(dbPath, damaged.id, null); // the row that used to kill startup

  const reopened = new SqliteDurableStore(dbPath);
  t.after(() => reopened.close());
  const svc = new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, reopened);

  // THE REGRESSION: this used to throw straight out of startup.
  assert.doesNotThrow(() => svc.hydrate(), 'hydration must never crash the Brain');

  const bad = svc.status(damaged.id, A);
  assert.ok(bad, 'the damaged index stays VISIBLE so health can report it');
  assert.equal(bad!.state, 'degraded', 'and is demoted, so it cannot serve as approved');
  assert.equal(bad!.stats.chunks, 0, 'quarantined empty — never partially loaded');
  assert.match(bad!.stats.lastError ?? '', /null-blob/, 'with a classified reason');

  const ok = svc.status(healthy.id, A);
  assert.equal(ok!.stats.chunks, 1, 'an unrelated healthy index still hydrates');
});

test('quarantine is durable — a restart cannot resurrect it as approved', (t) => {
  const dbPath = tmpDb();
  const store = new SqliteDurableStore(dbPath);
  const svc = new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, store);
  const rec = svc.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });
  store.setApprovedVersion(rec.id, 0, 1);
  store.setIndexState(rec.id, 'approved', 1);
  store.close();
  insertRawChunk(dbPath, rec.id, null);

  const second = new SqliteDurableStore(dbPath);
  new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, second).hydrate();
  second.close();

  // A THIRD boot must still see it degraded, not the stale `approved` string.
  const third = new SqliteDurableStore(dbPath);
  t.after(() => third.close());
  const persisted = third.loadIndexes().find((r) => r.id === rec.id);
  assert.equal(persisted?.state, 'degraded', 'the demotion was written, not just remembered');
});

test('a quarantined index refuses approved retrieval', async (t) => {
  const dbPath = tmpDb();
  const store = new SqliteDurableStore(dbPath);
  const svc0 = new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, store);
  const rec = svc0.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });
  store.setApprovedVersion(rec.id, 0, 1);
  store.setIndexState(rec.id, 'approved', 1);
  store.close();
  insertRawChunk(dbPath, rec.id, null);

  const reopened = new SqliteDurableStore(dbPath);
  t.after(() => reopened.close());
  const svc = new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, reopened);
  svc.hydrate();

  const result = await svc.retrieve(rec.id, A, 'anything', { requireApproved: true });
  assert.equal(result.ok, false, 'damaged content must never back production retrieval');
  assert.equal((result as { code: string }).code, 'NOT_APPROVED');
});

// ── R3: no failure window after the commit ───────────────────────────────────

test('approxBytes cannot be the thing that fails after a commit', () => {
  const index = new VectorIndex();
  // A chunk whose vector is missing entirely — the shape that used to throw here
  // AFTER commitSync had already succeeded.
  index.replaceFile('src/a.ts', [{
    id: 'c1', workspaceId: A.workspace, filePath: 'src/a.ts', language: 'ts', symbol: undefined,
    startLine: 1, endLine: 2, contentHash: 'h', embeddingModel: 'm', embeddingVersion: 'v1',
    indexedAt: 1, text: 'abc', vector: undefined as never,
  }]);

  assert.doesNotThrow(() => index.approxBytes(), 'stats must never convert a committed sync into a failure');
  assert.equal(index.approxBytes(), 3, 'a missing vector contributes nothing rather than throwing');
});

// ── R4/R5: candidate content must never touch approved content ───────────────

/** A file source whose contents the test mutates between syncs. */
function mutableSource(files: Map<string, string>): () => FileSource {
  return () => ({ files: async () => [...files].map(([relPath, content]) => ({ relPath, content })) });
}

/** Chunk rows for one version, as (file → text) pairs. */
function rowsAt(dbPath: string, indexId: string, indexVersion: number): string[] {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare('SELECT text FROM index_chunks WHERE index_id=? AND index_version=? ORDER BY id')
    .all(indexId, indexVersion) as Array<{ text: string }>;
  db.close();
  return rows.map((r) => r.text);
}

function pointers(dbPath: string, indexId: string): { version: number; approved: number | null } {
  const db = new DatabaseSync(dbPath);
  const r = db.prepare('SELECT version, approved_version FROM workspace_indexes WHERE id=?').get(indexId) as
    { version: number; approved_version: number | null };
  db.close();
  return { version: r.version, approved: r.approved_version };
}

test('a v5 database upgrades to v6 with its approved index preserved and no re-index', (t) => {
  const dbPath = tmpDb();

  // Build a v5-shaped database: chunks with NO index_version, state 'approved',
  // and no approved_version column — exactly what the live Brain looks like.
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO schema_meta(key,value) VALUES('schema_version','5');
    CREATE TABLE workspace_indexes (
      id TEXT PRIMARY KEY, workspace_id TEXT, owner_scope TEXT, source_type TEXT, root TEXT,
      state TEXT, version INTEGER, embedding_model TEXT, embedding_version TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE index_chunks (
      id TEXT PRIMARY KEY, index_id TEXT, workspace_id TEXT, file_path TEXT, language TEXT, symbol TEXT,
      start_line INTEGER, end_line INTEGER, content_hash TEXT, embedding_model TEXT, embedding_version TEXT,
      indexed_at INTEGER, text TEXT, vector BLOB);
    INSERT INTO workspace_indexes VALUES
      ('idx_live','/repo/a','o','workspace','/repo/a','approved',5,'fake-embed','v0',1,1);
  `);
  const legacyVector = new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer);
  raw.prepare(
    `INSERT INTO index_chunks(id,index_id,workspace_id,file_path,language,symbol,start_line,end_line,content_hash,embedding_model,embedding_version,indexed_at,text,vector)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('idx_live:src/a.ts#1', 'idx_live', '/repo/a', 'src/a.ts', 'ts', null, 1, 9, 'h', 'fake-embed', 'v0', 1, 'approved v5 content', legacyVector);
  raw.close();

  // Opening with the v6 engine migrates additively.
  const store = new SqliteDurableStore(dbPath);
  t.after(() => store.close());
  assert.equal(store.health().schemaVersion, 6);
  assert.equal(store.health().migrationState, 'applied');

  const p = pointers(dbPath, 'idx_live');
  assert.equal(p.version, 5, 'latest version preserved');
  assert.equal(p.approved, 5, 'an approved index keeps its approval, now version-bound');
  assert.deepEqual(rowsAt(dbPath, 'idx_live', 5), ['approved v5 content'], 'existing chunks bound to v5 — no re-index');

  const svc = new IndexService(new FakeEmbedder(8), noSource, undefined, undefined, store);
  svc.hydrate();
  const status = svc.status('idx_live', A)!;
  assert.equal(status.approvedVersion, 5, 'the approval pointer hydrates');
  assert.equal(status.stats.chunks, 1, 'approved content is loaded and retrievable');
});

test('a non-approved index gets no approval pointer from the upgrade', (t) => {
  const dbPath = tmpDb();
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO schema_meta(key,value) VALUES('schema_version','5');
    CREATE TABLE workspace_indexes (
      id TEXT PRIMARY KEY, workspace_id TEXT, owner_scope TEXT, source_type TEXT, root TEXT,
      state TEXT, version INTEGER, embedding_model TEXT, embedding_version TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE index_chunks (
      id TEXT PRIMARY KEY, index_id TEXT, workspace_id TEXT, file_path TEXT, language TEXT, symbol TEXT,
      start_line INTEGER, end_line INTEGER, content_hash TEXT, embedding_model TEXT, embedding_version TEXT,
      indexed_at INTEGER, text TEXT, vector BLOB);
    INSERT INTO workspace_indexes VALUES
      ('idx_exp','/repo/a','o','workspace','/repo/a','experimental',3,'fake-embed','v0',1,1);
  `);
  raw.close();
  const store = new SqliteDurableStore(dbPath);
  t.after(() => store.close());

  assert.equal(pointers(dbPath, 'idx_exp').approved, null, 'never invent an approval for unreviewed content');
});

test('MANDATORY: a failed v6 candidate leaves approved v5 intact across a restart', async (t) => {
  const dbPath = tmpDb();
  const files = new Map<string, string>([['src/a.ts', 'approved content one']]);
  const store = new SqliteDurableStore(dbPath);
  const svc = new IndexService(new FakeEmbedder(8), mutableSource(files), undefined, undefined, store);
  const rec = svc.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });

  // v1 synced and approved (the live "v5 approved" shape, at smaller numbers).
  assert.equal((await svc.sync(rec.id, A)).ok, true);
  const approvedAt = svc.status(rec.id, A)!.version;
  svc.setState(rec.id, A, 'approved');
  const before = rowsAt(dbPath, rec.id, approvedAt);
  assert.ok(before.length > 0, 'approved version has durable chunks');
  const approvedHit = await svc.retrieve(rec.id, A, 'approved content one', { requireApproved: true });
  assert.equal(approvedHit.ok, true, 'approved retrieval works before the replacement');

  // A replacement candidate whose embedder yields a malformed vector.
  files.set('src/a.ts', 'replacement content two');
  const brokenEmbedder = {
    model: 'fake-embed', version: 'v0',
    embed: async (texts: string[]) => texts.map(() => [Number.NaN, 0, 0, 0, 0, 0, 0, 0]),
  };
  const svcBroken = new IndexService(brokenEmbedder, mutableSource(files), undefined, undefined, store);
  svcBroken.hydrate();
  const failed = await svcBroken.sync(rec.id, A);

  assert.equal(failed.ok, false, 'a malformed candidate must fail');
  const p = pointers(dbPath, rec.id);
  assert.equal(p.version, approvedAt, 'the candidate pointer did NOT advance');
  assert.equal(p.approved, approvedAt, 'the approval pointer did NOT move');
  assert.deepEqual(rowsAt(dbPath, rec.id, approvedAt), before, 'approved chunks are byte-for-byte untouched');
  const stray = rowsAt(dbPath, rec.id, approvedAt + 1);
  assert.equal(stray.length, 0, 'the failed candidate wrote nothing durable');

  // Restart: the Brain must come up and still serve the approved version.
  store.close();
  const reopened = new SqliteDurableStore(dbPath);
  t.after(() => reopened.close());
  const after = new IndexService(new FakeEmbedder(8), mutableSource(files), undefined, undefined, reopened);
  assert.doesNotThrow(() => after.hydrate(), 'restart must succeed');

  const status = after.status(rec.id, A)!;
  assert.equal(status.approvedVersion, approvedAt, 'approval survives the restart');
  const served = await after.retrieve(rec.id, A, 'approved content one', { requireApproved: true });
  assert.equal(served.ok, true, 'requireApproved retrieval still returns the approved version');
  assert.ok(
    (served as { chunks: Array<{ snippet: string }> }).chunks.some((c) => c.snippet.includes('approved content one')),
    'and it is the APPROVED text, never the replacement',
  );
});

test('MANDATORY: a successful v6 keeps serving v5 until explicit approval, then switches', async (t) => {
  const dbPath = tmpDb();
  const files = new Map<string, string>([['src/a.ts', 'first generation text']]);
  const store = new SqliteDurableStore(dbPath);
  t.after(() => store.close());
  const svc = new IndexService(new FakeEmbedder(8), mutableSource(files), undefined, undefined, store);
  const rec = svc.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });

  await svc.sync(rec.id, A);
  const v1 = svc.status(rec.id, A)!.version;
  svc.setState(rec.id, A, 'approved');
  assert.equal(pointers(dbPath, rec.id).approved, v1);

  // A SUCCESSFUL replacement candidate.
  files.set('src/a.ts', 'second generation text');
  assert.equal((await svc.sync(rec.id, A)).ok, true);
  const v2 = svc.status(rec.id, A)!.version;
  assert.equal(v2, v1 + 1, 'the candidate version advanced');

  const p = pointers(dbPath, rec.id);
  assert.equal(p.version, v2, 'latest = the new candidate');
  assert.equal(p.approved, v1, 'approved STILL the reviewed version — the whole point');
  assert.notEqual(svc.status(rec.id, A)!.state, 'approved', 'lifecycle demoted to await review');

  // Production retrieval must still see the OLD generation.
  const beforeApproval = await svc.retrieve(rec.id, A, 'generation text', { requireApproved: true });
  assert.equal(beforeApproval.ok, true);
  const beforeText = (beforeApproval as { chunks: Array<{ snippet: string }> }).chunks.map((c) => c.snippet).join(' ');
  assert.match(beforeText, /first generation/, 'unreviewed content must not be served');
  assert.ok(!beforeText.includes('second generation'), 'candidate content is invisible to production');

  // Explicit, version-bound approval promotes atomically.
  svc.setState(rec.id, A, 'approved');
  assert.equal(pointers(dbPath, rec.id).approved, v2, 'approval promoted to the candidate');
  const afterApproval = await svc.retrieve(rec.id, A, 'generation text', { requireApproved: true });
  const afterText = (afterApproval as { chunks: Array<{ snippet: string }> }).chunks.map((c) => c.snippet).join(' ');
  assert.match(afterText, /second generation/, 'production switched to the newly approved version');
  assert.ok(!afterText.includes('first generation'), 'and no longer serves the superseded one');
});

test('copy-forward keeps a candidate complete, and pruning bounds the history', async (t) => {
  const dbPath = tmpDb();
  const files = new Map<string, string>([['a.ts', 'alpha text'], ['b.ts', 'beta text']]);
  const store = new SqliteDurableStore(dbPath);
  t.after(() => store.close());
  const svc = new IndexService(new FakeEmbedder(8), mutableSource(files), undefined, undefined, store);
  const rec = svc.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });

  await svc.sync(rec.id, A);
  const v1 = svc.status(rec.id, A)!.version;
  svc.setState(rec.id, A, 'approved');

  files.set('a.ts', 'alpha rewritten'); // only a.ts changes
  await svc.sync(rec.id, A);
  const v2 = svc.status(rec.id, A)!.version;

  const v2rows = rowsAt(dbPath, rec.id, v2);
  assert.equal(v2rows.length, 2, 'the candidate holds BOTH files, not only the changed one');
  assert.ok(v2rows.some((t) => t.includes('alpha rewritten')), 'changed file re-embedded');
  assert.ok(v2rows.some((t) => t.includes('beta text')), 'unchanged file carried forward');

  files.set('a.ts', 'alpha third'); // a third candidate
  await svc.sync(rec.id, A);
  const v3 = svc.status(rec.id, A)!.version;

  const db = new DatabaseSync(dbPath);
  const kept = (db.prepare('SELECT DISTINCT index_version AS v FROM index_chunks WHERE index_id=? ORDER BY v').all(rec.id) as Array<{ v: number }>).map((r) => r.v);
  db.close();
  assert.deepEqual(kept, [v1, v3], 'only the approved and latest versions are retained — history cannot grow unbounded');
  assert.ok(!kept.includes(v2), 'the superseded, never-approved candidate was pruned');
});

test('stale approval is still refused when the version moved on', async (t) => {
  const dbPath = tmpDb();
  const files = new Map<string, string>([['a.ts', 'text one']]);
  const store = new SqliteDurableStore(dbPath);
  t.after(() => store.close());
  const svc = new IndexService(new FakeEmbedder(8), mutableSource(files), undefined, undefined, store);
  const rec = svc.createIndex(A, { sourceType: 'workspace', root: '/repo/a' });

  await svc.sync(rec.id, A);
  const observed = svc.status(rec.id, A)!.version;
  files.set('a.ts', 'text two');
  await svc.sync(rec.id, A); // the version the caller reviewed is now stale

  // The version-binding check lives in WorkspaceManager.approveIndex; assert the
  // fact it depends on, so the guarantee cannot be silently lost here.
  assert.notEqual(svc.status(rec.id, A)!.version, observed, 'a new candidate makes an older approval stale');
  assert.equal(pointers(dbPath, rec.id).approved, null, 'and nothing was approved along the way');
});
