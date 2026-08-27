/**
 * The legacy import, against a real PostgreSQL and a real SQLite source.
 *
 * The source is built here rather than mocked, using the same column layout the
 * production database actually has (verified against
 * /var/lib/migrapilot/brain-state.db on 2026-08-23). A mocked source would only
 * assert that the importer agrees with my own assumptions about the legacy
 * schema — which is the thing most likely to be wrong.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chmod, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import { LegacySource } from '../src/engine/persistence/migration/legacySource.js';
import { CheckpointStore, SourceFingerprintMismatchError } from '../src/engine/persistence/migration/checkpoint.js';
import { Importer } from '../src/engine/persistence/migration/importer.js';
import { reconcile } from '../src/engine/persistence/migration/reconcile.js';
import { auditChunkIntegrity } from '../src/engine/persistence/migration/chunkAudit.js';
import { logicalChunkKey } from '../src/engine/persistence/migration/records.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let connection: PostgresConnection;
let store: PostgresDurableStore;
let workDir: string;
let sourcePath: string;

const A = { ownerScope: 'user:alpha', workspaceScope: 'personal:alpha' };
const B = { ownerScope: 'user:beta', workspaceScope: 'personal:beta' };

const vec = (seed: number): Buffer => {
  const f = new Float32Array([seed, seed + 0.5, seed + 1.25, seed + 2]);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
};

/**
 * A legacy database with the production column layout.
 *
 * `index_chunks.id` uses the real legacy shape — `${indexId}:v${version}:${path}#${line}`
 * — so the test proves the importer rebuilds the LOGICAL key rather than
 * carrying the storage key across.
 */
async function buildLegacySource(path: string): Promise<void> {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, title TEXT,
      memory_mode TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, grounding_files TEXT);
    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, status TEXT,
      request_id TEXT, model_id TEXT, provider_id TEXT, created_at INTEGER, durable INTEGER,
      supersedes_id TEXT, seq INTEGER);
    CREATE TABLE conversation_summaries (
      id TEXT PRIMARY KEY, conversation_id TEXT, source_from_message_id TEXT,
      source_to_message_id TEXT, summary_json TEXT, version INTEGER, created_at INTEGER);
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, name TEXT, root TEXT,
      git_repo TEXT, git_branch TEXT, memory_mode TEXT, index_id TEXT, provider_preferences TEXT,
      permissions TEXT, last_sync_at INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE workspace_indexes (
      id TEXT PRIMARY KEY, workspace_id TEXT, owner_scope TEXT, source_type TEXT, root TEXT,
      state TEXT, version INTEGER, approved_version INTEGER, embedding_model TEXT,
      embedding_version TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE index_versions (index_id TEXT, version INTEGER, committed_at INTEGER, PRIMARY KEY(index_id, version));
    CREATE TABLE index_chunks (
      id TEXT PRIMARY KEY, index_id TEXT, workspace_id TEXT, file_path TEXT, language TEXT, symbol TEXT,
      start_line INTEGER, end_line INTEGER, content_hash TEXT, embedding_model TEXT, embedding_version TEXT,
      indexed_at INTEGER, text TEXT, vector BLOB, index_version INTEGER);
    CREATE TABLE memory_items (
      id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, category TEXT,
      content TEXT, confidence REAL, source_type TEXT, source_id TEXT, expires_at INTEGER, created_at INTEGER);
  `);

  const conv = db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?)');
  const msg = db.prepare('INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');

  // Scope A: 3 conversations. One carries grounding files, one carries an EMPTY
  // grounding set (a different fact from "no set"), one carries none.
  conv.run('c-a1', A.ownerScope, A.workspaceScope, 'first', 'durable', 100, 110, null, JSON.stringify(['notes.md', 'spec.md']));
  conv.run('c-a2', A.ownerScope, A.workspaceScope, 'second', 'durable', 200, 210, null, JSON.stringify([]));
  conv.run('c-a3', A.ownerScope, A.workspaceScope, 'third', 'session', 300, 310, null, null);
  // Soft-deleted: it must migrate as deleted and must NOT come back to the user.
  conv.run('c-a4', A.ownerScope, A.workspaceScope, 'deleted thread', 'durable', 500, 510, 515, null);
  // Scope B, to prove the import does not leak across tenants.
  conv.run('c-b1', B.ownerScope, B.workspaceScope, 'beta only', 'durable', 400, 410, null, null);

  // Message ORDER is part of parity, so seq is deliberately not insertion order.
  msg.run('m-a1-2', 'c-a1', 'assistant', 'second message', 'complete', null, 'qwen3:8b', 'local', 121, 1, null, 2);
  msg.run('m-a1-1', 'c-a1', 'user', 'first message', 'complete', 'req-1', null, null, 120, 1, null, 1);
  msg.run('m-a1-3', 'c-a1', 'user', 'third message', 'complete', null, null, null, 122, 0, null, 3);
  msg.run('m-a2-1', 'c-a2', 'user', 'only message', 'complete', null, null, null, 220, 1, null, 1);
  msg.run('m-b1-1', 'c-b1', 'user', 'beta message', 'complete', null, null, null, 420, 1, null, 1);

  db.prepare('INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?)').run(
    's-a1', 'c-a1', 'm-a1-1', 'm-a1-2',
    JSON.stringify({ confirmedFacts: ['alpha likes markdown'], openQuestions: [] }), 1, 130,
  );

  db.prepare('INSERT INTO workspaces VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'ws-a', A.ownerScope, A.workspaceScope, 'alpha ws', '/work/alpha', null, null, 'durable', 'idx-a', null, null, null, 90, 95,
  );

  const idx = db.prepare('INSERT INTO workspace_indexes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  // Approved at v2, with chunks at BOTH v1 and v2 — the multi-version history
  // that a single commitSync could not reproduce.
  idx.run('idx-a', A.workspaceScope, A.ownerScope, 'docs', '/library/alpha', 'approved', 2, 2, 'nomic-embed-text', 'v1', 90, 140);
  // Scope B holds an index whose chunks use the SAME logical keys as A's. Under
  // the first PostgreSQL port that was a cross-tenant primary-key collision.
  idx.run('idx-b', B.workspaceScope, B.ownerScope, 'docs', '/library/beta', 'experimental', 1, null, 'nomic-embed-text', 'v1', 90, 140);

  const ver = db.prepare('INSERT INTO index_versions VALUES(?,?,?)');
  ver.run('idx-a', 1, 100);
  ver.run('idx-a', 2, 140);
  ver.run('idx-b', 1, 100);

  const chunk = db.prepare('INSERT INTO index_chunks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const put = (indexId: string, workspaceScope: string, version: number, file: string, line: number, text: string, seed: number) => {
    chunk.run(
      `${indexId}:v${version}:${file}#${line}`, indexId, workspaceScope, file, 'markdown', null,
      line, line + 4, `hash-${file}-${line}`, 'nomic-embed-text', 'v1', 100 + seed, text, vec(seed), version,
    );
  };
  put('idx-a', A.workspaceScope, 1, 'notes.md', 1, 'ALPHA OLD CONTENT', 1);
  put('idx-a', A.workspaceScope, 2, 'notes.md', 1, 'ALPHA NEW CONTENT', 2);
  put('idx-a', A.workspaceScope, 2, 'spec.md', 1, 'ALPHA SPEC', 3);
  // Same file path AND same start line as A's — identical logical key, other tenant.
  put('idx-b', B.workspaceScope, 1, 'notes.md', 1, 'BETA CONTENT', 4);

  db.close();
}

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'legacy-migration-'));
  sourcePath = join(workDir, 'brain-state.db');
  await buildLegacySource(sourcePath);

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
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/** Open the run, then build an importer for it — the order the CLI uses. */
async function importerFor(runId: string, source: LegacySource): Promise<Importer> {
  const checkpoints = new CheckpointStore(connection);
  await checkpoints.beginOrResume(runId, sourcePath, await LegacySource.fingerprint(sourcePath), 1_000);
  return new Importer({ source, store, checkpoints, runId, now: () => 1_000 });
}

test('the source is opened READ-ONLY — the artifact being migrated cannot be damaged',
  async (t) => {
    if (skip) return t.skip(skip);
    const source = new LegacySource(sourcePath);
    assert.throws(
      () => (source as unknown as { db: DatabaseSync }).db.exec('DELETE FROM conversations'),
      /readonly|read-only/i,
      'a write against the legacy source must be refused by SQLite itself, not by convention',
    );
    source.close();
  });

test('a full import reconciles EXACTLY against the source', async (t) => {
  if (skip) return t.skip(skip);
  const source = new LegacySource(sourcePath);
  const totals = await (await importerFor('run-exact', source)).importAll();

  assert.equal(totals.conversations, 5);
  assert.equal(totals.messages, 5);
  assert.equal(totals.summaries, 1);
  assert.equal(totals.workspaces, 1);
  assert.equal(totals.indexes, 2);
  assert.equal(totals.chunks, 4);

  const parity = await reconcile(source, store);
  assert.deepEqual(parity.mismatches, [], 'no field may differ');
  assert.ok(parity.exact);
  assert.equal(parity.comparedConversations, 5);
  assert.equal(parity.deletedConversationsChecked, 1, 'the soft-deleted thread was checked, not skipped');
  assert.equal(parity.comparedMessages, 5);
  assert.equal(parity.comparedChunks, 4);
  source.close();
});

test('message ORDER survives, not just message count', async (t) => {
  if (skip) return t.skip(skip);
  // The legacy rows were inserted out of order on purpose; `seq` is the truth.
  const loaded = await store.loadDurableForScope({ owner: A.ownerScope, workspace: A.workspaceScope });
  const forA1 = loaded.messages.filter((m) => m.conversationId === 'c-a1');
  assert.deepEqual(forA1.map((m) => m.id), ['m-a1-1', 'm-a1-2', 'm-a1-3']);
  assert.deepEqual(forA1.map((m) => m.content), ['first message', 'second message', 'third message']);
});

test('SQLite 0/1 becomes a real boolean, not a truthy number', async (t) => {
  if (skip) return t.skip(skip);
  const loaded = await store.loadDurableForScope({ owner: A.ownerScope, workspace: A.workspaceScope });
  const durable = loaded.messages.find((m) => m.id === 'm-a1-1');
  const notDurable = loaded.messages.find((m) => m.id === 'm-a1-3');
  assert.equal(durable?.durable, true);
  assert.equal(notDurable?.durable, false);
});

test('an EMPTY grounding set stays distinct from NO grounding set', async (t) => {
  if (skip) return t.skip(skip);
  // Collapsing these loses a real user fact: "I detached every file" is not the
  // same as "I never attached one".
  const loaded = await store.loadDurableForScope({ owner: A.ownerScope, workspace: A.workspaceScope });
  assert.deepEqual(loaded.conversations.find((c) => c.id === 'c-a1')?.groundingFiles, ['notes.md', 'spec.md']);
  assert.deepEqual(loaded.conversations.find((c) => c.id === 'c-a2')?.groundingFiles, []);
  assert.equal(loaded.conversations.find((c) => c.id === 'c-a3')?.groundingFiles, undefined);
});

test('multi-version chunk history is preserved, not flattened to the latest', async (t) => {
  if (skip) return t.skip(skip);
  const scope = { owner: A.ownerScope, workspace: A.workspaceScope };
  const v1 = await store.loadChunksForScope(scope, 'idx-a', 1);
  const v2 = await store.loadChunksForScope(scope, 'idx-a', 2);
  assert.equal(v1.length, 1, 'the older version still has its chunk');
  assert.equal(v1[0]?.text, 'ALPHA OLD CONTENT');
  assert.equal(v2.length, 2);
  assert.deepEqual(v2.map((c) => c.text).sort(), ['ALPHA NEW CONTENT', 'ALPHA SPEC']);
});

test('the legacy STORAGE key is rewritten to the engine LOGICAL key', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * The legacy row id was `idx-a:v2:notes.md#1`. PostgreSQL must hold
   * `notes.md#1` — what indexService produces on a fresh sync. Carrying the
   * storage key across would make migrated indexes retrieve under keys no live
   * sync would ever generate.
   */
  const chunks = await store.loadChunksForScope({ owner: A.ownerScope, workspace: A.workspaceScope }, 'idx-a', 2);
  const keys = chunks.map((c) => c.id).sort();
  assert.deepEqual(keys, [logicalChunkKey('notes.md', 1), logicalChunkKey('spec.md', 1)].sort());
  assert.ok(!keys.some((k) => k.includes(':v')), 'no legacy storage key survived the import');
});

test('two tenants keep IDENTICAL logical chunk keys without colliding', async (t) => {
  if (skip) return t.skip(skip);
  // This exact pair is what the first PostgreSQL port collapsed into one row.
  const a = await store.loadChunksForScope({ owner: A.ownerScope, workspace: A.workspaceScope }, 'idx-a', 2);
  const b = await store.loadChunksForScope({ owner: B.ownerScope, workspace: B.workspaceScope }, 'idx-b', 1);
  const aNotes = a.find((c) => c.id === 'notes.md#1');
  const bNotes = b.find((c) => c.id === 'notes.md#1');
  assert.equal(aNotes?.text, 'ALPHA NEW CONTENT');
  assert.equal(bNotes?.text, 'BETA CONTENT', 'beta must not be serving alpha content');
});

test('the approved pointer and version survive the version replay', async (t) => {
  if (skip) return t.skip(skip);
  // commitSync moves `version` as a side effect of every version it replays, so
  // the importer restores the legacy pointers afterwards.
  const indexes = await store.loadIndexesForScope({ owner: A.ownerScope, workspace: A.workspaceScope });
  const idx = indexes.find((i) => i.id === 'idx-a');
  assert.equal(idx?.state, 'approved');
  assert.equal(idx?.version, 2);
  assert.equal(idx?.approvedVersion, 2);
});

test('re-running the SAME import is idempotent — no duplicates, still exact', async (t) => {
  if (skip) return t.skip(skip);
  const source = new LegacySource(sourcePath);
  // A fresh run id, so no checkpoint lets it skip: every write is replayed.
  await (await importerFor('run-again', source)).importAll();
  const parity = await reconcile(source, store);
  assert.deepEqual(parity.mismatches, [], 'a second full import must converge, not duplicate');

  const loaded = await store.loadDurableForScope({ owner: A.ownerScope, workspace: A.workspaceScope });
  assert.equal(loaded.messages.filter((m) => m.conversationId === 'c-a1').length, 3,
    'messages were upserted by id, not appended');
  source.close();
});

test('a crashed import RESUMES where it stopped instead of starting over', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * The failure this models is the real one: the process dies partway through.
   * The importer is driven to throw inside a specific scope, then re-run with
   * the same run id — it must skip the stages that already committed and finish
   * the rest.
   */
  const source = new LegacySource(sourcePath);
  const checkpoints = new CheckpointStore(connection);
  const runId = 'run-crash';
  await checkpoints.beginOrResume(runId, sourcePath, await LegacySource.fingerprint(sourcePath), 1_000);

  let stagesBeforeCrash = 0;
  const crashing = new Importer({
    source, store, checkpoints, runId, now: () => 1_000,
    onProgress: (p) => {
      if (p.skipped) return;
      stagesBeforeCrash += 1;
      // Die immediately after the second committed stage.
      if (stagesBeforeCrash === 2) throw new Error('simulated crash mid-import');
    },
  });
  await assert.rejects(() => crashing.importAll(), /simulated crash/);

  const committed = await checkpoints.completedStages(runId);
  assert.equal(committed.size, 2, 'exactly the stages that finished are checkpointed');

  const skipped: string[] = [];
  const resumed = new Importer({
    source, store, checkpoints, runId, now: () => 2_000,
    onProgress: (p) => { if (p.skipped) skipped.push(`${p.scope.ownerScope} ${p.stage}`); },
  });
  await resumed.importAll();

  assert.equal(skipped.length, 2, 'the resumed run skipped exactly the already-committed stages');
  const parity = await reconcile(source, store);
  assert.deepEqual(parity.mismatches, [], 'the resumed import still produces exact parity');
  source.close();
});

test('a resume REFUSES when the source changed underneath it', async (t) => {
  if (skip) return t.skip(skip);
  const checkpoints = new CheckpointStore(connection);
  const real = await LegacySource.fingerprint(sourcePath);
  await checkpoints.beginOrResume('run-fingerprint', sourcePath, real, 1_000);

  await assert.rejects(
    () => checkpoints.beginOrResume('run-fingerprint', sourcePath, `${real.slice(0, -1)}${real.endsWith('0') ? '1' : '0'}`, 2_000),
    SourceFingerprintMismatchError,
    'continuing against a different source would interleave two datasets',
  );

  // The same fingerprint still resumes cleanly.
  const again = await checkpoints.beginOrResume('run-fingerprint', sourcePath, real, 3_000);
  assert.equal(again.resumed, true);
});

test('reconciliation FAILS when the target diverges — the check has teeth', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * A parity checker that never fails proves nothing. A conversation is mutated
   * in PostgreSQL only, and reconciliation must name it.
   */
  const source = new LegacySource(sourcePath);
  const scope = { owner: A.ownerScope, workspace: A.workspaceScope };
  const loaded = await store.loadDurableForScope(scope);
  const original = loaded.conversations.find((c) => c.id === 'c-a3')!;
  await store.saveConversation({ ...original, title: 'TAMPERED' });

  const parity = await reconcile(source, store);
  assert.equal(parity.exact, false);
  const hit = parity.mismatches.find((m) => m.id === 'c-a3' && m.field === 'title');
  assert.ok(hit, 'the tampered title must be reported');
  assert.equal(hit?.postgres, 'TAMPERED');

  await store.saveConversation(original);
  assert.ok((await reconcile(source, store)).exact, 'and parity returns once it is put back');
  source.close();
});

test('the audit reports UNVERIFIED rather than a clean number when the source is gone',
  async (t) => {
    if (skip) return t.skip(skip);
    // Both fixture roots are absent, exactly like three of the four production
    // indexes whose upload directories were deleted.
    const source = new LegacySource(sourcePath);
    const audit = await auditChunkIntegrity(source);

    assert.equal(audit.indexes.length, 2);
    assert.equal(audit.unverifiedCount, 2);
    assert.equal(audit.fullyVerified, false, 'a missing source can never produce a verified verdict');
    for (const row of audit.indexes) {
      assert.equal(row.verdict, 'historical_integrity_unverified');
      assert.equal(row.sourceAvailable, false);
      assert.equal(row.expectedFiles, null, 'expected-file count is unknown, not zero');
    }
    source.close();
  });

test('the audit verifies against a source that DOES still exist', async (t) => {
  if (skip) return t.skip(skip);
  const root = join(workDir, 'library-present');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'present.md'), 'content');

  const dbPath = join(workDir, 'present-source.db');
  await buildLegacySource(dbPath);
  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE workspace_indexes SET root = ? WHERE id = ?').run(root, 'idx-a');
  // One chunk at the latest version, mapping to the one file that exists.
  // Renaming BOTH v2 chunks to the same path would give them the same logical
  // key, which the audit correctly reports as a duplicate rather than a match.
  db.prepare("DELETE FROM index_chunks WHERE index_id = 'idx-a' AND file_path = 'spec.md'").run();
  db.prepare("UPDATE index_chunks SET file_path = ? WHERE index_id = 'idx-a'").run('present.md');
  db.close();

  const source = new LegacySource(dbPath);
  const audit = await auditChunkIntegrity(source);
  const present = audit.indexes.find((i) => i.indexId === 'idx-a');
  assert.equal(present?.sourceAvailable, true);
  assert.equal(present?.expectedFiles, 1);
  assert.equal(present?.verdict, 'verified_against_source');
  // The other index still has no source, so the OVERALL claim stays false.
  assert.equal(audit.fullyVerified, false);
  source.close();
});

test('the audit NAMES a file that is persisted but no longer in the source', async (t) => {
  if (skip) return t.skip(skip);
  const root = join(workDir, 'library-partial');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'kept.md'), 'still here');

  const dbPath = join(workDir, 'partial-source.db');
  await buildLegacySource(dbPath);
  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE workspace_indexes SET root = ? WHERE id = ?').run(root, 'idx-a');
  // v2 holds notes.md and spec.md; only kept.md exists on disk.
  db.close();

  const source = new LegacySource(dbPath);
  const audit = await auditChunkIntegrity(source);
  const row = audit.indexes.find((i) => i.indexId === 'idx-a');
  assert.equal(row?.verdict, 'source_mismatch');
  assert.deepEqual(row?.filesMissingFromSource, ['notes.md', 'spec.md']);
  assert.deepEqual(row?.filesMissingFromIndex, ['kept.md']);
  source.close();
});

test('a soft-deleted conversation migrates as DELETED and does not come back', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * Resurrecting a thread the user deleted is worse than losing one: it puts
   * content back in front of them that they removed on purpose.
   */
  const loaded = await store.loadDurableForScope({ owner: A.ownerScope, workspace: A.workspaceScope });
  assert.ok(!loaded.conversations.some((c) => c.id === 'c-a4'), 'the deleted thread must not load');

  // But the row exists, carrying its deletion timestamp — it was migrated, not dropped.
  // The scope MUST be declared: under FORCE row-level security an undeclared
  // read returns zero rows, which would look exactly like a dropped row.
  const rows = await connection.transaction(async (client) => {
    await client.query(`SELECT set_config('migrapilot.owner_scope', $1, true)`, [A.ownerScope]);
    await client.query(`SELECT set_config('migrapilot.workspace_scope', $1, true)`, [A.workspaceScope]);
    const r = await client.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM conversations WHERE id = 'c-a4'`,
    );
    return r.rows;
  });
  assert.equal(rows.length, 1, 'the row was migrated rather than silently skipped');
  assert.equal(Number(rows[0]?.deleted_at), 515, 'and it kept the exact deletion timestamp');
});

test('an UNREADABLE source is not reported as a missing one', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * The defect this replaces shipped into a written report.
   *
   * /var/lib/migrapilot/uploads is 0700. Run as an ordinary user the audit got
   * EACCES, the catch-all swallowed it, and three indexes were recorded as
   * "SOURCE GONE" — which I then wrote up as "their upload directories were
   * deleted". They existed the whole time; the same audit run as root verified
   * every one of them against its source.
   *
   * A permission failure reported as a data fact is worse than no audit: it
   * closes the question with a wrong answer.
   */
  const root = join(workDir, 'library-locked');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'secret.md'), 'content');

  const dbPath = join(workDir, 'locked-source.db');
  await buildLegacySource(dbPath);
  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE workspace_indexes SET root = ? WHERE id = ?').run(root, 'idx-a');
  db.close();

  await chmod(root, 0o000);
  try {
    const source = new LegacySource(dbPath);
    const audit = await auditChunkIntegrity(source);
    const locked = audit.indexes.find((i) => i.indexId === 'idx-a');

    assert.equal(locked?.verdict, 'source_unreadable', 'unreadable is its own verdict');
    assert.notEqual(locked?.verdict, 'historical_integrity_unverified', 'and is NOT "gone"');
    assert.equal(locked?.sourceError, 'EACCES', 'the errno is kept — it says what to fix');
    assert.equal(audit.unreadableCount, 1);
    assert.equal(audit.unverifiedCount, 1, 'only the genuinely-absent root counts as unverified');
    assert.equal(audit.fullyVerified, false);
    source.close();
  } finally {
    // Restore, or the temp-dir cleanup in `after` cannot remove it.
    await chmod(root, 0o755);
  }
});

test('a genuinely ABSENT source still reports ENOENT and "gone"', async (t) => {
  if (skip) return t.skip(skip);
  // The other half of the distinction: the original behaviour must survive.
  const source = new LegacySource(sourcePath);
  const audit = await auditChunkIntegrity(source);
  for (const row of audit.indexes) {
    assert.equal(row.verdict, 'historical_integrity_unverified');
    assert.equal(row.sourceError, 'ENOENT', 'absent, not merely unreadable');
  }
  assert.equal(audit.unreadableCount, 0);
  source.close();
});
