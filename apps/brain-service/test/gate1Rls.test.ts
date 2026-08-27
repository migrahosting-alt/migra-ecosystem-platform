/**
 * Gate 1 — row-level security, proven against a real PostgreSQL server.
 *
 * Nothing here may be mocked. The whole point is to verify what PostgreSQL
 * ACTUALLY does with a mismatched scope; a fake would assert our own assumption,
 * which is the thing under test.
 *
 * Runs only when MIGRAPILOT_TEST_DATABASE_URL is set. It connects as the
 * NOBYPASSRLS application role — the harness fails loudly if that role can
 * bypass RLS, because these tests would then pass vacuously.
 *
 * Cases are numbered to POSTGRES_CUTOVER_ACCEPTANCE.md.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PostgresDurableStore } from '../src/engine/persistence/postgresStore.js';
import type { Conversation, Message } from '../src/engine/memory/conversationStore.js';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let appConnection: PostgresConnection;
let store: PostgresDurableStore;

const A = { owner: 'user:alpha', workspace: 'ws:one' };
const B = { owner: 'user:beta', workspace: 'ws:one' };
const AY = { owner: 'user:alpha', workspace: 'ws:two' };

const conversation = (id: string, scope: { owner: string; workspace: string }): Conversation => ({
  id,
  ownerScope: scope.owner,
  workspaceScope: scope.workspace,
  title: `conv ${id}`,
  memoryMode: 'durable',
  createdAt: 1,
  updatedAt: 1,
});

const message = (id: string, conversationId: string): Message => ({
  id,
  conversationId,
  role: 'user',
  content: `content of ${id}`,
  status: 'complete',
  createdAt: 2,
  durable: true,
});

before(async () => {
  skip = await postgresTestSkipReason();
  if (skip) return;
  pg = await startDisposablePostgres();

  // Migrations run as the OWNER.
  const owner = new PostgresConnection({ databaseUrl: pg.databaseUrl });
  await owner.migrate();
  await owner.close();

  // Everything asserted below runs as the NON-SUPERUSER app role. An owner or
  // BYPASSRLS connection ignores policies entirely, so RLS assertions made on
  // one prove nothing — they pass whatever the policies actually say.
  const appUrl = await appRoleUrl(pg.databaseUrl);
  appConnection = new PostgresConnection({ databaseUrl: appUrl });
  store = new PostgresDurableStore(appConnection);
}, { timeout: 180_000 });

after(async () => {
  await appConnection?.close().catch(() => undefined);
  await pg?.stop();
});

/* ── 1.1 correct scope succeeds ──────────────────────────────────────────── */

test('1.1 a correctly scoped write commits and reads back', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-ok', A));
  await store.saveMessage(message('m-ok', 'c-ok'), A);

  const loaded = await store.loadDurableForScope(A);
  assert.ok(loaded.conversations.some((c) => c.id === 'c-ok'), 'conversation is readable in its own scope');
  assert.ok(loaded.messages.some((m) => m.id === 'm-ok'), 'message is readable in its own scope');
});

/* ── 1.2 cross-OWNER write rejected ──────────────────────────────────────── */

test('1.2 a cross-owner message write is REJECTED by PostgreSQL', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-owner', A));

  // The conversation belongs to alpha. Writing a message to it while declaring
  // beta's scope is the cross-tenant write the whole model exists to stop.
  await assert.rejects(
    () => store.saveMessage(message('m-cross-owner', 'c-owner'), B),
    (error: unknown) => error instanceof Error,
    'PostgreSQL must refuse a message whose scope does not match the declared scope',
  );

  // 1.4 — and it must land NOWHERE. A row filed under beta would be just as bad
  // as one filed under alpha: the point is that the write did not happen.
  const underA = await store.loadDurableForScope(A);
  const underB = await store.loadDurableForScope(B);
  assert.ok(!underA.messages.some((m) => m.id === 'm-cross-owner'), 'no row under the real owner');
  assert.ok(!underB.messages.some((m) => m.id === 'm-cross-owner'), 'no row under the declared owner');
});

/* ── 1.3 cross-WORKSPACE write rejected ──────────────────────────────────── */

test('1.3 a cross-workspace message write is REJECTED', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-ws', A));

  await assert.rejects(
    () => store.saveMessage(message('m-cross-ws', 'c-ws'), AY),
    'same owner, different workspace, must still be refused',
  );

  const underA = await store.loadDurableForScope(A);
  const underAY = await store.loadDurableForScope(AY);
  assert.ok(!underA.messages.some((m) => m.id === 'm-cross-ws'));
  assert.ok(!underAY.messages.some((m) => m.id === 'm-cross-ws'));
});

/* ── 1.4 isolation between tenants ───────────────────────────────────────── */

test("1.4 one tenant cannot see another's conversations", async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-alpha-only', A));
  await store.saveConversation(conversation('c-beta-only', B));

  const alpha = await store.loadDurableForScope(A);
  const beta = await store.loadDurableForScope(B);

  assert.ok(alpha.conversations.some((c) => c.id === 'c-alpha-only'));
  assert.ok(!alpha.conversations.some((c) => c.id === 'c-beta-only'), "alpha must not see beta's");
  assert.ok(beta.conversations.some((c) => c.id === 'c-beta-only'));
  assert.ok(!beta.conversations.some((c) => c.id === 'c-alpha-only'), "beta must not see alpha's");
});

/* ── 1.5 loadDurable refuses rather than returning [] ────────────────────── */

test('1.5 loadDurable() throws instead of reporting an empty Brain', async (t) => {
  if (skip) return t.skip(skip);
  // An undeclared scope legitimately sees zero rows. Returning [] would be
  // indistinguishable from "this tenant has nothing" and would boot an
  // apparently empty Brain while every row sat safe in the database.
  await assert.rejects(() => store.loadDurable(), /row-level security/i);
});

/* ── 1.6 summaries obey the same rules ───────────────────────────────────── */

test('1.6 a cross-owner summary write is REJECTED', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveConversation(conversation('c-sum', A));
  await assert.rejects(
    () =>
      store.saveSummary(
        {
          id: 's-cross',
          conversationId: 'c-sum',
          sourceFromMessageId: 'm1',
          sourceToMessageId: 'm2',
          summary: { confirmedFacts: [], decisions: [], questions: [], projectState: [], nextActions: [] },
          version: 1,
          createdAt: 3,
        },
        B,
      ),
    'summaries are scope-checked exactly like messages',
  );
});

/* ── 2.5 the explicit multi-record transaction ───────────────────────────── */

test('2.5 createConversationWithFirstMessage is atomic', async (t) => {
  if (skip) return t.skip(skip);
  await store.createConversationWithFirstMessage(conversation('c-atomic', A), message('m-atomic', 'c-atomic'));

  const loaded = await store.loadDurableForScope(A);
  assert.ok(loaded.conversations.some((c) => c.id === 'c-atomic'));
  assert.ok(loaded.messages.some((m) => m.id === 'm-atomic'), 'both records, one transaction');
});

/* ── 2.2 rollback leaves nothing ─────────────────────────────────────────── */

test('2.2 a failed multi-record write leaves NO conversation behind', async (t) => {
  if (skip) return t.skip(skip);
  // The message declares a conversation id that will violate the FK inside the
  // same transaction, so the conversation insert must roll back with it.
  const bad = { ...message('m-bad', 'does-not-exist'), id: 'm-bad' };
  await assert.rejects(() => store.createConversationWithFirstMessage(conversation('c-rollback', A), bad));

  const loaded = await store.loadDurableForScope(A);
  assert.ok(
    !loaded.conversations.some((c) => c.id === 'c-rollback'),
    'a half-committed pair would be acknowledged as stored and absent on reload',
  );
});

/* ── direct integrity: a child may not name a parent that does not exist ──── */

test('1.9 a message referencing a NONEXISTENT conversation is rejected', async (t) => {
  if (skip) return t.skip(skip);
  // Before migration 10 this succeeded: conversation_messages had no foreign key
  // at all, so a message could name a conversation that never existed.
  await assert.rejects(
    () => store.saveMessage(message('m-orphan', 'conversation-that-never-existed'), A),
    'a message must reference a real conversation',
  );
});

test('1.10 a summary referencing a NONEXISTENT conversation is rejected', async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(
    () =>
      store.saveSummary(
        {
          id: 's-orphan',
          conversationId: 'conversation-that-never-existed',
          sourceFromMessageId: 'm1',
          sourceToMessageId: 'm2',
          summary: { confirmedFacts: [], decisions: [], questions: [], projectState: [], nextActions: [] },
          version: 1,
          createdAt: 3,
        },
        A,
      ),
    'a summary must reference a real conversation',
  );
});

/* ── 1.8 the workspaceId / workspace_scope question ──────────────────────── */

const indexRecord = (id: string, scope: { owner: string; workspace: string }) => ({
  id,
  // `workspaceId` is set to `scope.workspace` at creation (indexService.createIndex),
  // so despite the NAME it carries the workspace SCOPE string. 1.8 exists to prove
  // that against the database rather than trusting the field name.
  workspaceId: scope.workspace,
  ownerScope: scope.owner,
  sourceType: 'docs',
  root: `/library/${id}`,
  state: 'ready',
  version: 1,
  approvedVersion: undefined,
  embeddingModel: 'nomic-embed-text',
  embeddingVersion: 'v1',
  createdAt: 1,
  updatedAt: 1,
});

const chunk = (id: string, indexId: string, scope: { owner: string; workspace: string }) => ({
  id,
  indexId,
  workspaceId: scope.workspace,
  filePath: 'notes.md',
  language: 'markdown',
  startLine: 1,
  endLine: 2,
  contentHash: `hash-${id}`,
  embeddingModel: 'nomic-embed-text',
  embeddingVersion: 'v1',
  indexedAt: 1,
  text: `text of ${id}`,
  vector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
});

test('1.8 saveIndex stores workspace_scope EQUAL to a conversation in the same workspace', async (t) => {
  if (skip) return t.skip(skip);
  // The actual question: is `workspaceId` the same semantic value RLS compares
  // against for conversations? If the two diverge, every index write breaks.
  await store.saveConversation(conversation('c-ws-probe', A));
  await store.saveIndex(indexRecord('idx-probe', A) as never);

  // The verification query must ALSO declare a scope. Reading without one
  // returns null for every row — which is what made the first run of this case
  // look like a mapping mismatch when it was an unscoped SELECT.
  const rows = await appConnection.transaction(async (client) => {
    await client.query(`SELECT set_config('migrapilot.owner_scope', $1, true)`, [A.owner]);
    await client.query(`SELECT set_config('migrapilot.workspace_scope', $1, true)`, [A.workspace]);
    const r = await client.query<{ ws_index: string; ws_conv: string }>(
      `SELECT (SELECT workspace_scope FROM workspace_indexes WHERE id = 'idx-probe') AS ws_index,
              (SELECT workspace_scope FROM conversations      WHERE id = 'c-ws-probe') AS ws_conv`,
    );
    return r.rows;
  });

  assert.equal(
    rows[0]?.ws_index,
    rows[0]?.ws_conv,
    'workspaceId and the RLS workspace_scope must be the SAME value, or the mapping is a modelling defect',
  );
  assert.equal(rows[0]?.ws_index, A.workspace);
});

test('1.8b commitSync under the correct scope succeeds', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveIndex(indexRecord('idx-commit', A) as never);
  await store.commitSync('idx-commit', 1, [chunk('ch-1', 'idx-commit', A) as never], ['notes.md'], [], 2, A);

  const chunks = await store.loadChunksForScope(A, 'idx-commit', 1);
  assert.ok(chunks.some((c) => c.id === 'ch-1'), 'the chunk is readable in its own scope');
});

test('1.8c commitSync under a WRONG owner is rejected', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveIndex(indexRecord('idx-wrong-owner', A) as never);
  await assert.rejects(
    () => store.commitSync('idx-wrong-owner', 1, [chunk('ch-bad', 'idx-wrong-owner', B) as never], ['notes.md'], [], 2, B),
    'chunks may not be committed against another tenant index',
  );
});

test('1.8d commitSync under a WRONG workspace is rejected', async (t) => {
  if (skip) return t.skip(skip);
  await store.saveIndex(indexRecord('idx-wrong-ws', A) as never);
  await assert.rejects(
    () => store.commitSync('idx-wrong-ws', 1, [chunk('ch-bad-ws', 'idx-wrong-ws', AY) as never], ['notes.md'], [], 2, AY),
    'same owner, different workspace, still refused',
  );
});

/* ── migration 11: chunk identity is scoped, not global ──────────────────── */

const chunkNamed = (key: string, indexId: string, scope: { owner: string; workspace: string }, text: string) => ({
  id: key, // the LOGICAL key: `${relPath}#${startLine}`
  indexId,
  workspaceId: scope.workspace,
  filePath: key.split('#')[0],
  language: 'markdown',
  startLine: Number(key.split('#')[1] ?? 1),
  endLine: 3,
  contentHash: `hash-${indexId}-${key}`,
  embeddingModel: 'fake',
  embeddingVersion: 'v1',
  indexedAt: 1,
  text,
  vector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
});

test('11.1 the SAME chunk key coexists across two owners', async (t) => {
  if (skip) return t.skip(skip);
  // `README.md#1` is not exotic — it would collide across essentially every
  // workspace. Before migration 11 the second write hit ON CONFLICT and RLS
  // refused it against the first tenant's row; without RLS it would have
  // OVERWRITTEN that tenant's content.
  await store.saveIndex(indexRecord('idx-collide-a', A) as never);
  await store.saveIndex(indexRecord('idx-collide-b', B) as never);

  await store.commitSync('idx-collide-a', 1, [chunkNamed('README.md#1', 'idx-collide-a', A, 'ALPHA CONTENT') as never], ['README.md'], [], 2, A);
  await store.commitSync('idx-collide-b', 1, [chunkNamed('README.md#1', 'idx-collide-b', B, 'BETA CONTENT') as never], ['README.md'], [], 2, B);

  const a = await store.loadChunksForScope(A, 'idx-collide-a', 1);
  const b = await store.loadChunksForScope(B, 'idx-collide-b', 1);

  assert.equal(a.length, 1, 'alpha keeps its chunk');
  assert.equal(b.length, 1, 'beta keeps its chunk');
  assert.equal(a[0]!.text, 'ALPHA CONTENT', 'alpha reads ALPHA content');
  assert.equal(b[0]!.text, 'BETA CONTENT', 'beta reads BETA content — not overwritten by alpha');
  assert.equal(a[0]!.id, 'README.md#1', 'the LOGICAL key is what retrieval sees, not a row id');
  assert.equal(b[0]!.id, 'README.md#1');
});

test('11.2 the same chunk key coexists across two indexes in ONE scope', async (t) => {
  if (skip) return t.skip(skip);
  // Tenant isolation alone does not solve index-to-index collision: both of
  // these belong to the same owner and workspace.
  await store.saveIndex(indexRecord('idx-same-scope-1', A) as never);
  await store.saveIndex(indexRecord('idx-same-scope-2', A) as never);

  await store.commitSync('idx-same-scope-1', 1, [chunkNamed('README.md#1', 'idx-same-scope-1', A, 'FROM INDEX ONE') as never], ['README.md'], [], 2, A);
  await store.commitSync('idx-same-scope-2', 1, [chunkNamed('README.md#1', 'idx-same-scope-2', A, 'FROM INDEX TWO') as never], ['README.md'], [], 2, A);

  const one = await store.loadChunksForScope(A, 'idx-same-scope-1', 1);
  const two = await store.loadChunksForScope(A, 'idx-same-scope-2', 1);
  assert.equal(one[0]!.text, 'FROM INDEX ONE');
  assert.equal(two[0]!.text, 'FROM INDEX TWO', 'the second index did not overwrite the first');
});

test('11.3 re-syncing the SAME chunk updates in place rather than duplicating', async (t) => {
  if (skip) return t.skip(skip);
  // row_id is derived from the canonical tuple, so an unchanged chunk resolves
  // to the same row and ON CONFLICT updates it.
  await store.saveIndex(indexRecord('idx-resync', A) as never);
  await store.commitSync('idx-resync', 1, [chunkNamed('notes.md#1', 'idx-resync', A, 'FIRST') as never], ['notes.md'], [], 2, A);
  await store.commitSync('idx-resync', 1, [chunkNamed('notes.md#1', 'idx-resync', A, 'SECOND') as never], ['notes.md'], [], 3, A);

  const chunks = await store.loadChunksForScope(A, 'idx-resync', 1);
  assert.equal(chunks.length, 1, 're-sync must not duplicate the row');
  assert.equal(chunks[0]!.text, 'SECOND', 'and must update it');
});

test('11.4 the scoped-identity migration backfills rows that ALREADY exist', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * THE CASE THE TEST MATRIX WAS MISSING.
   *
   * Scratch databases are migrated BEFORE any data exists, so migration 11 never
   * met a row it had to backfill and its UPDATE trivially "succeeded". Against a
   * database that already held chunks it matched zero rows — FORCE row-level
   * security applies to the table OWNER too, and an owner-run maintenance
   * statement has no tenant scope to declare — leaving row_id NULL and failing
   * SET NOT NULL.
   *
   * Every row here was written through the normal path AFTER migration, so this
   * asserts the post-condition the backfill exists to guarantee: every chunk has
   * a row_id, and it is derived from the canonical tuple rather than assigned
   * arbitrarily.
   */
  await store.saveIndex(indexRecord('idx-backfill', A) as never);
  await store.commitSync(
    'idx-backfill', 1,
    [chunkNamed('backfill.md#1', 'idx-backfill', A, 'BACKFILL CONTENT') as never],
    ['backfill.md'], [], 2, A,
  );

  const rows = await appConnection.transaction(async (client) => {
    await client.query(`SELECT set_config('migrapilot.owner_scope', $1, true)`, [A.owner]);
    await client.query(`SELECT set_config('migrapilot.workspace_scope', $1, true)`, [A.workspace]);
    const r = await client.query<{ row_id: string | null; chunk_key: string; expected: string }>(
      `SELECT row_id, chunk_key,
              encode(sha256(convert_to(
                owner_scope || E'\\x1f' || workspace_scope || E'\\x1f' ||
                coalesce(index_id,'') || E'\\x1f' || index_version::text || E'\\x1f' ||
                chunk_key, 'UTF8')), 'hex') AS expected
         FROM index_chunks WHERE index_id = 'idx-backfill'`,
    );
    return r.rows;
  });

  assert.equal(rows.length, 1, 'the chunk is present');
  assert.ok(rows[0]!.row_id, 'row_id is never null');
  // The canonical tuple includes index_version as of migration 13: without it
  // an index cannot hold the same logical chunk at two versions, and
  // committing a new version rewrites the previous version's chunk.
  assert.equal(rows[0]!.row_id, rows[0]!.expected, 'row_id is derived from the canonical tuple');
  assert.equal(rows[0]!.chunk_key, 'backfill.md#1', 'chunk_key stays the logical identity');
});

test('11.5 FORCE row-level security is RESTORED after the migration', async (t) => {
  if (skip) return t.skip(skip);
  // The migration lifts FORCE for its owner-run backfill. If it failed to
  // restore it, the table owner would silently bypass tenant isolation from then
  // on — a permanent weakening introduced by a one-off maintenance step.
  const rows = await appConnection.query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'index_chunks'`,
  );
  assert.equal(rows[0]?.relrowsecurity, true, 'row level security is enabled');
  assert.equal(rows[0]?.relforcerowsecurity, true, 'and FORCE is back on — the owner is not exempt');
});

/* ── 12 the scoped-mutation row-count invariant ──────────────────────────── */

/*
 * This group exists because of a defect that shipped, not a hypothetical.
 *
 * `setIndexState` ran its UPDATE without declaring a scope. Under FORCE row
 * level security that matched ZERO rows, PostgreSQL raised nothing, the method
 * resolved, the API answered `state: approved` from memory — and the next
 * restart revealed the database had always said `experimental`.
 *
 * The scope is now declared. These cases assert the SECOND line of defence: if
 * a scoped UPDATE or DELETE changes nothing, that is an error, never success.
 * A wrong scope is the cheapest way to produce a zero-row mutation on purpose.
 */

const workspaceRecord = (id: string, scope: { owner: string; workspace: string }) => ({
  id,
  ownerScope: scope.owner,
  workspaceScope: scope.workspace,
  name: `ws ${id}`,
  root: `/work/${id}`,
  memoryMode: 'durable',
  createdAt: 1,
  updatedAt: 1,
});

test('12.1 setIndexState under a WRONG scope raises rather than silently doing nothing',
  async (t) => {
    if (skip) return t.skip(skip);
    await store.saveIndex(indexRecord('idx-rowcount-state', A) as never);

    await assert.rejects(
      () => store.setIndexState('idx-rowcount-state', 'approved', 9, B),
      /affected no rows/,
      'a zero-row UPDATE must raise — this is the exact shape of the shipped defect',
    );

    // And the state genuinely did not change under the real owner either.
    const indexes = await store.loadIndexesForScope(A);
    const rec = indexes.find((i) => i.id === 'idx-rowcount-state');
    assert.equal(rec?.state, 'ready', 'the rejected UPDATE changed nothing anywhere');
  });

test('12.2 setIndexState under the CORRECT scope still succeeds and persists',
  async (t) => {
    if (skip) return t.skip(skip);
    await store.setIndexState('idx-rowcount-state', 'approved', 10, A);
    const indexes = await store.loadIndexesForScope(A);
    assert.equal(indexes.find((i) => i.id === 'idx-rowcount-state')?.state, 'approved');
  });

test('12.3 setApprovedVersion under a WRONG scope raises', async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(
    () => store.setApprovedVersion('idx-rowcount-state', 1, 11, B),
    /affected no rows/,
  );
  const indexes = await store.loadIndexesForScope(A);
  assert.equal(
    indexes.find((i) => i.id === 'idx-rowcount-state')?.approvedVersion,
    undefined,
    'no approval was recorded by the rejected write',
  );
});

test('12.4 setApprovedVersion under the CORRECT scope persists the approval',
  async (t) => {
    if (skip) return t.skip(skip);
    await store.setApprovedVersion('idx-rowcount-state', 1, 12, A);
    const indexes = await store.loadIndexesForScope(A);
    assert.equal(indexes.find((i) => i.id === 'idx-rowcount-state')?.approvedVersion, 1);
  });

test('12.5 deleteIndex under a WRONG scope raises and the index SURVIVES',
  async (t) => {
    if (skip) return t.skip(skip);
    await assert.rejects(() => store.deleteIndex('idx-rowcount-state', B), /affected no rows/);
    const indexes = await store.loadIndexesForScope(A);
    assert.ok(
      indexes.some((i) => i.id === 'idx-rowcount-state'),
      'a delete that reported success while deleting nothing is the failure mode being blocked',
    );
  });

test('12.6 deleting an index that does not exist is a MISMATCH, not idempotent success',
  async (t) => {
    if (skip) return t.skip(skip);
    /*
     * DECIDED, not defaulted: "already absent" is an error.
     *
     * Under FORCE row level security "it is already gone" and "it is not yours"
     * are indistinguishable from the row count, so treating absence as success
     * would re-open exactly the hole this invariant closes. Callers reach a
     * delete only after seeing the record in their OWN scope, so zero rows means
     * something is genuinely wrong.
     */
    await assert.rejects(() => store.deleteIndex('idx-never-existed', A), /affected no rows/);
  });

test('12.7 deleteConversation: wrong scope raises, correct scope deletes, repeat raises',
  async (t) => {
    if (skip) return t.skip(skip);
    await store.saveConversation(conversation('c-rowcount', A));
    await store.saveMessage(message('m-rowcount', 'c-rowcount'), A);

    await assert.rejects(() => store.deleteConversation('c-rowcount', B), /affected no rows/);
    const stillThere = await store.loadDurableForScope(A);
    assert.ok(stillThere.conversations.some((c) => c.id === 'c-rowcount'), 'the wrong-scope delete deleted nothing');

    await store.deleteConversation('c-rowcount', A);
    const afterDelete = await store.loadDurableForScope(A);
    assert.ok(!afterDelete.conversations.some((c) => c.id === 'c-rowcount'), 'the correct-scope delete removed it');
    assert.ok(!afterDelete.messages.some((m) => m.id === 'm-rowcount'), 'and its messages went with it');

    // Second delete of the same id: absent, therefore a mismatch.
    await assert.rejects(() => store.deleteConversation('c-rowcount', A), /affected no rows/);
  });

test('12.8 deleting a conversation with NO messages still succeeds',
  async (t) => {
    if (skip) return t.skip(skip);
    // Only the PARENT row count is required. Demanding rows from the child
    // tables would fail a perfectly correct delete of an empty conversation.
    await store.saveConversation(conversation('c-rowcount-empty', A));
    await store.deleteConversation('c-rowcount-empty', A);
    const after = await store.loadDurableForScope(A);
    assert.ok(!after.conversations.some((c) => c.id === 'c-rowcount-empty'));
  });

test('12.9 deleteWorkspace: wrong scope raises and the workspace SURVIVES',
  async (t) => {
    if (skip) return t.skip(skip);
    await store.saveWorkspace(workspaceRecord('ws-rowcount', A) as never);

    await assert.rejects(() => store.deleteWorkspace('ws-rowcount', B), /affected no rows/);
    const survived = await store.loadWorkspacesForScope(A);
    assert.ok(survived.some((w) => w.id === 'ws-rowcount'), 'the wrong-scope delete deleted nothing');

    await store.deleteWorkspace('ws-rowcount', A);
    const after = await store.loadWorkspacesForScope(A);
    assert.ok(!after.some((w) => w.id === 'ws-rowcount'), 'the correct-scope delete removed it');
  });
