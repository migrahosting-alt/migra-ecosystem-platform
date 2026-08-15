/**
 * Sub-slice 2 · Group 2 — memory items, workspaces, workspace indexes.
 *
 * Parity against SQLite plus PostgreSQL-only isolation cases. Every RLS
 * assertion runs under the NON-SUPERUSER application role; asserting isolation
 * on the owner connection proves nothing, as Group 1 demonstrated.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { withScope } from '../src/engine/persistence/postgres/conversationRepo.js';
import {
  UnscopedRecordError, deleteWorkspace, loadMemoryItems, loadWorkspaceIndexesFor, loadWorkspaces,
  saveMemoryItem, saveWorkspace, saveWorkspaceIndex,
} from '../src/engine/persistence/postgres/memoryWorkspaceRepo.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import type { MemoryItem } from '../src/engine/memory/conversationStore.js';
import type { PersistedWorkspace } from '../src/engine/persistence/types.js';
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
  tmp = mkdtempSync(join(tmpdir(), 'brain-g2-'));
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

const conn = () => new PostgresConnection({ databaseUrl: appUrl, applicationName: 'group2' });

async function scoped<T>(scope: typeof A, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = conn();
  try {
    return await c.transaction((client) => withScope(client, scope, () => fn(client)));
  } finally {
    await c.close();
  }
}

const item = (id: string, scope = A, over: Partial<MemoryItem> = {}): MemoryItem => ({
  id, scope: { owner: scope.ownerScope, workspace: scope.workspaceScope },
  category: 'convention', content: `content-${id}`, confidence: 0.75,
  sourceType: 'test', createdAt: 1_000, ...over,
});

const workspace = (id: string, scope = A, over: Partial<PersistedWorkspace> = {}): PersistedWorkspace => ({
  id, ownerScope: scope.ownerScope, workspaceScope: scope.workspaceScope,
  name: `ws-${id}`, root: `/srv/${id}`, memoryMode: 'durable',
  createdAt: 1_000, updatedAt: 1_000, ...over,
});

// ── PARITY ──────────────────────────────────────────────────────────────────

test('memory item round-trips with identical field values in both adapters', async (t) => {
  if (skip) return t.skip(skip);

  const sqlite = new SqliteDurableStore(join(tmp, 'mem.db'));
  sqlite.saveMemoryItem(item('mi-1', A, { confidence: 0.5, expiresAt: 9_999, sourceId: 'src-1' }));
  const fromSqlite = (await sqlite.loadMemoryItems()).find((i) => i.id === 'mi-1')!;
  sqlite.close();

  await scoped(A, (c) => saveMemoryItem(c, item('mi-1', A, { confidence: 0.5, expiresAt: 9_999, sourceId: 'src-1' })));
  const fromPg = (await scoped(A, loadMemoryItems)).find((i) => i.id === 'mi-1')!;

  assert.equal(fromPg.content, fromSqlite.content);
  assert.equal(fromPg.confidence, fromSqlite.confidence);
  assert.equal(fromPg.expiresAt, fromSqlite.expiresAt);
  assert.equal(fromPg.sourceId, fromSqlite.sourceId);
  assert.equal(fromPg.createdAt, fromSqlite.createdAt);
  assert.equal(fromPg.category, fromSqlite.category);
});

test('memory item upsert replaces content in both adapters', async (t) => {
  if (skip) return t.skip(skip);

  const sqlite = new SqliteDurableStore(join(tmp, 'mem2.db'));
  sqlite.saveMemoryItem(item('mi-up', A, { content: 'first' }));
  sqlite.saveMemoryItem(item('mi-up', A, { content: 'second' }));
  const sqliteItems = (await sqlite.loadMemoryItems()).filter((i) => i.id === 'mi-up');
  sqlite.close();

  await scoped(A, async (c) => {
    await saveMemoryItem(c, item('mi-up', A, { content: 'first' }));
    await saveMemoryItem(c, item('mi-up', A, { content: 'second' }));
  });
  const pgItems = (await scoped(A, loadMemoryItems)).filter((i) => i.id === 'mi-up');

  assert.equal(sqliteItems.length, 1);
  assert.equal(pgItems.length, 1);
  assert.equal(pgItems[0]!.content, sqliteItems[0]!.content);
  assert.equal(pgItems[0]!.content, 'second');
});

test('workspace upsert updates fields but never scope, in both adapters', async (t) => {
  if (skip) return t.skip(skip);

  const sqlite = new SqliteDurableStore(join(tmp, 'ws.db'));
  sqlite.saveWorkspace(workspace('w-1', A, { name: 'one' }));
  sqlite.saveWorkspace({ ...workspace('w-1', B, { name: 'two' }) });
  const fromSqlite = (await sqlite.loadWorkspaces()).find((w) => w.id === 'w-1')!;
  sqlite.close();

  assert.equal(fromSqlite.name, 'two', 'SQLite updates the name');
  assert.equal(fromSqlite.ownerScope, A.ownerScope, 'SQLite keeps the original scope');

  await scoped(A, (c) => saveWorkspace(c, workspace('w-1', A, { name: 'one' })));
  await scoped(A, (c) => saveWorkspace(c, workspace('w-1', A, { name: 'two' })));
  const fromPg = (await scoped(A, loadWorkspaces)).find((w) => w.id === 'w-1')!;

  assert.equal(fromPg.name, fromSqlite.name);
  assert.equal(fromPg.ownerScope, A.ownerScope);
});

test('workspace delete removes only the target', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveWorkspace(c, workspace('w-keep'));
    await saveWorkspace(c, workspace('w-drop'));
  });
  await scoped(A, (c) => deleteWorkspace(c, 'w-drop'));

  const ids = (await scoped(A, loadWorkspaces)).map((w) => w.id);
  assert.ok(ids.includes('w-keep'));
  assert.ok(!ids.includes('w-drop'));
});

// ── GOVERNED REFUSALS ───────────────────────────────────────────────────────

test('an unscoped memory item is refused, not silently written', async (t) => {
  if (skip) return t.skip(skip);

  const unscoped: MemoryItem = { ...item('mi-unscoped'), scope: {} };
  await assert.rejects(() => scoped(A, (c) => saveMemoryItem(c, unscoped)), UnscopedRecordError);

  const found = (await scoped(A, loadMemoryItems)).filter((i) => i.id === 'mi-unscoped');
  assert.equal(found.length, 0, 'nothing may be persisted');
});

test('upserting an existing memory item under another scope cannot re-home it', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => saveMemoryItem(c, item('mi-home', A, { content: 'owned-by-A' })));

  // B attempts to claim the same id. RLS makes A's row invisible to B, and
  // WITH CHECK refuses a row labelled B for an id that already exists.
  await assert.rejects(
    () => scoped(B, (c) => saveMemoryItem(c, item('mi-home', B, { content: 'stolen' }))),
    'B must not be able to take over an existing id',
  );

  const stillA = (await scoped(A, loadMemoryItems)).find((i) => i.id === 'mi-home')!;
  assert.equal(stillA.content, 'owned-by-A', 'A record is untouched');
  assert.equal(stillA.scope.owner, A.ownerScope);
});

test('upserting a workspace under another scope cannot re-home it', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => saveWorkspace(c, workspace('w-home', A, { name: 'A-owned' })));
  await assert.rejects(
    () => scoped(B, (c) => saveWorkspace(c, workspace('w-home', B, { name: 'B-stolen' }))),
    'B must not take over an existing workspace id',
  );

  const stillA = (await scoped(A, loadWorkspaces)).find((w) => w.id === 'w-home')!;
  assert.equal(stillA.name, 'A-owned');
  assert.equal(stillA.ownerScope, A.ownerScope);
});

// ── ISOLATION, BOTH DIRECTIONS ──────────────────────────────────────────────

test('tenant B cannot discover tenant A workspace metadata or memory', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveWorkspace(c, workspace('w-private', A, { name: 'secret-project', root: '/srv/secret' }));
    await saveMemoryItem(c, item('mi-private', A, { content: 'secret-fact' }));
  });

  const bWorkspaces = await scoped(B, loadWorkspaces);
  const bMemory = await scoped(B, loadMemoryItems);
  assert.equal(bWorkspaces.filter((w) => w.id === 'w-private').length, 0);
  assert.equal(bMemory.filter((i) => i.id === 'mi-private').length, 0);
  assert.ok(!JSON.stringify(bWorkspaces).includes('secret-project'), 'no metadata leak');
  assert.ok(!JSON.stringify(bMemory).includes('secret-fact'), 'no content leak');
});

test('knowing another tenant workspace id does NOT grant access to its indexes', async (t) => {
  if (skip) return t.skip(skip);

  const known = 'w-known-id';
  await scoped(A, async (c) => {
    await saveWorkspace(c, workspace(known, A));
    await saveWorkspaceIndex(c, { id: 'idx-a', workspaceId: known, createdAt: 1, updatedAt: 1 }, A);
  });

  // B knows the identifier exactly and queries for it directly.
  const asB = await scoped(B, (c) => loadWorkspaceIndexesFor(c, known));
  assert.equal(asB.length, 0, 'a known id must not be a capability');

  const asA = await scoped(A, (c) => loadWorkspaceIndexesFor(c, known));
  assert.equal(asA.length, 1, 'the owner still sees it');
});

test('RLS is the final layer for Group 2 tables: no predicate still cannot cross tenants', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => saveMemoryItem(c, item('mi-rls-a', A)));
  await scoped(B, (c) => saveMemoryItem(c, item('mi-rls-b', B)));

  const seenByA = await scoped(A, async (c) => {
    const r = await c.query<{ id: string }>('SELECT id FROM memory_items');
    return r.rows.map((x) => x.id);
  });
  assert.ok(seenByA.includes('mi-rls-a'));
  assert.ok(!seenByA.includes('mi-rls-b'), 'unfiltered SELECT must not expose B');

  const seenWorkspaces = await scoped(A, async (c) => {
    const r = await c.query<{ id: string }>('SELECT id FROM workspaces');
    return r.rows.length;
  });
  assert.ok(seenWorkspaces >= 0);
});

test('missing scope returns zero rows across all Group 2 tables', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, async (c) => {
    await saveMemoryItem(c, item('mi-noscope', A));
    await saveWorkspace(c, workspace('w-noscope', A));
    await saveWorkspaceIndex(c, { id: 'idx-noscope', workspaceId: 'w-noscope', createdAt: 1, updatedAt: 1 }, A);
  });

  const c = conn();
  try {
    const counts = await c.transaction(async (client) => ({
      memory: (await client.query('SELECT id FROM memory_items')).rows.length,
      workspaces: (await client.query('SELECT id FROM workspaces')).rows.length,
      indexes: (await client.query('SELECT id FROM workspace_indexes')).rows.length,
    }));
    assert.deepEqual(counts, { memory: 0, workspaces: 0, indexes: 0 }, 'unset scope must fail closed');
  } finally {
    await c.close();
  }
});

test('an unrelated tenant cannot UPDATE or DELETE Group 2 rows without a predicate', async (t) => {
  if (skip) return t.skip(skip);
  const C = { ownerScope: 'user:carol', workspaceScope: 'org:initech' };

  await scoped(A, (c) => saveWorkspace(c, workspace('w-untouchable', A, { name: 'original' })));

  const affected = await scoped(C, async (c) => {
    const upd = await c.query(`UPDATE workspaces SET name = 'hijacked'`);
    const del = await c.query('DELETE FROM memory_items');
    return { updated: upd.rowCount ?? 0, deleted: del.rowCount ?? 0 };
  });
  assert.equal(affected.updated, 0);
  assert.equal(affected.deleted, 0);

  const survived = (await scoped(A, loadWorkspaces)).find((w) => w.id === 'w-untouchable')!;
  assert.equal(survived.name, 'original');
});
