/**
 * Sub-slice 2 · Group 1 — conversation persistence parity and tenant isolation.
 *
 * Runs the SAME behavioural assertions against SQLite and PostgreSQL wherever
 * the contract should match, then adds PostgreSQL-specific cases for RLS.
 *
 * The isolation tests deliberately use a WRONG predicate — no owner filter at
 * all — to prove RLS is the final enforcement layer rather than a second
 * opinion beside application filtering.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import {
  deleteConversation, loadDurable, saveConversation, saveMessage, saveSummary, withScope,
} from '../src/engine/persistence/postgres/conversationRepo.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import type { Conversation, Message, Summary } from '../src/engine/memory/conversationStore.js';
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
  tmp = mkdtempSync(join(tmpdir(), 'brain-parity-'));
  skip = await postgresTestSkipReason();
  if (!skip) {
    pg = await startDisposablePostgres();
    const conn = new PostgresConnection({ databaseUrl: pg.databaseUrl });
    await conn.migrate();
    await conn.close();
    // RLS assertions MUST run as a non-superuser; the owner bypasses policies.
    appUrl = await appRoleUrl(pg.databaseUrl);
  }
}, { timeout: 180_000 });

after(async () => {
  await pg?.stop();
  rmSync(tmp, { recursive: true, force: true });
});

/** Non-superuser connection — the only one under which RLS actually applies. */
const conn = () => new PostgresConnection({ databaseUrl: appUrl, applicationName: 'group1' });

function conversation(id: string, scope = A, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id, ownerScope: scope.ownerScope, workspaceScope: scope.workspaceScope,
    title: `title-${id}`, memoryMode: 'durable', createdAt: 1_000, updatedAt: 1_000, ...overrides,
  };
}
function message(id: string, conversationId: string, createdAt: number, overrides: Partial<Message> = {}): Message {
  return {
    id, conversationId, role: 'user', content: `content-${id}`, status: 'complete',
    createdAt, durable: true, ...overrides,
  };
}
function summary(id: string, conversationId: string, version: number): Summary {
  return {
    id, conversationId, sourceFromMessageId: 'm1', sourceToMessageId: 'm2',
    summary: { text: `s-${id}` } as never, version, createdAt: 5_000,
  };
}

/** Run a scoped unit of work against Postgres. */
async function pgScoped<T>(scope: typeof A, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = conn();
  try {
    return await c.transaction((client) => withScope(client, scope, () => fn(client)));
  } finally {
    await c.close();
  }
}

// ── PARITY: same assertions, both adapters ──────────────────────────────────

test('message ordering matches SQLite exactly (seq then insertion order)', async (t) => {
  if (skip) return t.skip(skip);

  // Same createdAt on two messages forces the tie-break: SQLite rowid,
  // Postgres ins_seq. Insertion order must decide in both.
  const build = async (save: (m: Message) => Promise<void> | void) => [
    message('m-b', 'c1', 200),
    message('m-a', 'c1', 100),
    message('m-tie1', 'c1', 300),
    message('m-tie2', 'c1', 300),
  ].reduce(async (p, m) => { await p; await save(m); }, (await Promise.resolve()));

  const sqlite = new SqliteDurableStore(join(tmp, 'order.db'));
  sqlite.saveConversation(conversation('c1'));
  await build((m) => { sqlite.saveMessage(m); });
  const sqliteOrder = (await sqlite.loadDurable()).messages.map((m) => m.id);
  sqlite.close();

  await pgScoped(A, async (client) => {
    await saveConversation(client, conversation('c1'));
    await build((m) => saveMessage(client, m, A));
  });
  const pgOrder = (await pgScoped(A, (client) => loadDurable(client))).messages.map((m) => m.id);

  assert.deepEqual(pgOrder, sqliteOrder, 'PostgreSQL order must equal SQLite order');
  assert.deepEqual(sqliteOrder, ['m-a', 'm-b', 'm-tie1', 'm-tie2']);
});

test('duplicate message id is ignored by both adapters', async (t) => {
  if (skip) return t.skip(skip);

  const sqlite = new SqliteDurableStore(join(tmp, 'dupe.db'));
  sqlite.saveConversation(conversation('c-dupe'));
  sqlite.saveMessage(message('m1', 'c-dupe', 10, { content: 'first' }));
  sqlite.saveMessage(message('m1', 'c-dupe', 99, { content: 'second' }));
  const sqliteMsgs = (await sqlite.loadDurable()).messages.filter((m) => m.conversationId === 'c-dupe');
  sqlite.close();

  await pgScoped(A, async (client) => {
    await saveConversation(client, conversation('c-dupe'));
    await saveMessage(client, message('m1', 'c-dupe', 10, { content: 'first' }), A);
    await saveMessage(client, message('m1', 'c-dupe', 99, { content: 'second' }), A);
  });
  const pgMsgs = (await pgScoped(A, (client) => loadDurable(client)))
    .messages.filter((m) => m.conversationId === 'c-dupe');

  assert.equal(sqliteMsgs.length, 1);
  assert.equal(pgMsgs.length, 1);
  assert.equal(pgMsgs[0]!.content, sqliteMsgs[0]!.content, 'first write must win in both');
  assert.equal(pgMsgs[0]!.content, 'first');
});

test('summary replacement and ordering match SQLite', async (t) => {
  if (skip) return t.skip(skip);

  const sqlite = new SqliteDurableStore(join(tmp, 'summ.db'));
  sqlite.saveConversation(conversation('c-s'));
  sqlite.saveSummary(summary('s1', 'c-s', 2));
  sqlite.saveSummary(summary('s2', 'c-s', 1));
  sqlite.saveSummary({ ...summary('s1', 'c-s', 2), summary: { text: 'replaced' } as never });
  const sqliteSummaries = (await sqlite.loadDurable()).summaries.filter((s) => s.conversationId === 'c-s');
  sqlite.close();

  await pgScoped(A, async (client) => {
    await saveConversation(client, conversation('c-s'));
    await saveSummary(client, summary('s1', 'c-s', 2), A);
    await saveSummary(client, summary('s2', 'c-s', 1), A);
    await saveSummary(client, { ...summary('s1', 'c-s', 2), summary: { text: 'replaced' } as never }, A);
  });
  const pgSummaries = (await pgScoped(A, (client) => loadDurable(client)))
    .summaries.filter((s) => s.conversationId === 'c-s');

  assert.deepEqual(pgSummaries.map((s) => s.version), sqliteSummaries.map((s) => s.version), 'version order');
  assert.deepEqual(pgSummaries.map((s) => s.id), ['s2', 's1']);
  const replaced = pgSummaries.find((s) => s.id === 's1')!;
  assert.deepEqual(replaced.summary, { text: 'replaced' }, 'INSERT OR REPLACE semantics');
});

test('conversation upsert updates title/updatedAt but never scope', async (t) => {
  if (skip) return t.skip(skip);

  await pgScoped(A, async (client) => {
    await saveConversation(client, conversation('c-up', A, { title: 'one', updatedAt: 1 }));
    await saveConversation(client, conversation('c-up', A, { title: 'two', updatedAt: 2 }));
  });
  const loaded = (await pgScoped(A, (client) => loadDurable(client)))
    .conversations.find((c) => c.id === 'c-up')!;

  assert.equal(loaded.title, 'two');
  assert.equal(loaded.updatedAt, 2);
  assert.equal(loaded.ownerScope, A.ownerScope, 'scope must not move on re-save');
});

test('cascade delete removes messages and summaries in real PostgreSQL', async (t) => {
  if (skip) return t.skip(skip);

  await pgScoped(A, async (client) => {
    await saveConversation(client, conversation('c-del'));
    await saveMessage(client, message('dm1', 'c-del', 1), A);
    await saveSummary(client, summary('ds1', 'c-del', 1), A);
  });

  await pgScoped(A, (client) => deleteConversation(client, 'c-del'));

  const after = await pgScoped(A, (client) => loadDurable(client));
  assert.equal(after.conversations.filter((c) => c.id === 'c-del').length, 0);
  assert.equal(after.messages.filter((m) => m.conversationId === 'c-del').length, 0, 'messages cascaded');
  assert.equal(after.summaries.filter((s) => s.conversationId === 'c-del').length, 0, 'summaries cascaded');
});

test('epoch-ms timestamps round-trip with no precision loss', async (t) => {
  if (skip) return t.skip(skip);
  const precise = 1_786_559_871_123;

  await pgScoped(A, async (client) => {
    await saveConversation(client, conversation('c-ts', A, { createdAt: precise, updatedAt: precise }));
    await saveMessage(client, message('m-ts', 'c-ts', precise), A);
  });
  const loaded = await pgScoped(A, (client) => loadDurable(client));

  assert.equal(loaded.conversations.find((c) => c.id === 'c-ts')!.createdAt, precise);
  assert.equal(loaded.messages.find((m) => m.id === 'm-ts')!.createdAt, precise);
});

// ── TENANT ISOLATION ────────────────────────────────────────────────────────

test('tenant B cannot see tenant A conversations, messages or summaries', async (t) => {
  if (skip) return t.skip(skip);

  await pgScoped(A, async (client) => {
    await saveConversation(client, conversation('c-secret', A));
    await saveMessage(client, message('m-secret', 'c-secret', 1), A);
    await saveSummary(client, summary('s-secret', 'c-secret', 1), A);
  });

  const asB = await pgScoped(B, (client) => loadDurable(client));
  assert.equal(asB.conversations.filter((c) => c.id === 'c-secret').length, 0);
  assert.equal(asB.messages.filter((m) => m.id === 'm-secret').length, 0);
  assert.equal(asB.summaries.filter((s) => s.id === 's-secret').length, 0);

  const asA = await pgScoped(A, (client) => loadDurable(client));
  assert.equal(asA.conversations.filter((c) => c.id === 'c-secret').length, 1, 'A still sees its own');
});

test('RLS is the FINAL layer: a query with NO owner predicate still cannot cross tenants', async (t) => {
  if (skip) return t.skip(skip);

  await pgScoped(A, (client) => saveConversation(client, conversation('c-rls-a', A)));
  await pgScoped(B, (client) => saveConversation(client, conversation('c-rls-b', B)));

  // Deliberately WRONG: no scope filter at all. Application-level filtering is
  // bypassed entirely; only the database boundary can save us here.
  const rows = await pgScoped(A, async (client) => {
    const r = await client.query<{ id: string }>('SELECT id FROM conversations');
    return r.rows.map((x) => x.id);
  });

  assert.ok(rows.includes('c-rls-a'), 'A must see its own row');
  assert.ok(!rows.includes('c-rls-b'), 'RLS must hide B even with no predicate in the SQL');
});

test('an unrelated tenant cannot UPDATE or DELETE another tenant rows without a predicate', async (t) => {
  if (skip) return t.skip(skip);

  // A third tenant that owns NOTHING, so a non-zero rowCount can only mean the
  // statement reached another tenant's rows. Using B here would be misleading:
  // B legitimately affects its own rows from earlier tests.
  const C = { ownerScope: 'user:carol', workspaceScope: 'org:initech' };

  await pgScoped(A, (client) => saveConversation(client, conversation('c-immutable', A, { title: 'original' })));

  const changed = await pgScoped(C, async (client) => {
    const upd = await client.query(`UPDATE conversations SET title = 'hijacked'`);
    const del = await client.query('DELETE FROM conversations');
    return { updated: upd.rowCount ?? 0, deleted: del.rowCount ?? 0 };
  });
  assert.equal(changed.updated, 0, 'C owns nothing, so an unfiltered UPDATE must affect 0 rows');
  assert.equal(changed.deleted, 0, 'C owns nothing, so an unfiltered DELETE must affect 0 rows');

  const stillThere = (await pgScoped(A, (client) => loadDurable(client)))
    .conversations.find((c) => c.id === 'c-immutable');
  assert.equal(stillThere?.title, 'original', 'A row survives untouched');
});

test('a MISSING scope returns zero rows — never unscoped data', async (t) => {
  if (skip) return t.skip(skip);

  await pgScoped(A, (client) => saveConversation(client, conversation('c-noscope', A)));

  const c = conn();
  try {
    // No set_config at all: migra_current_owner() is NULL, so no policy matches.
    const rows = await c.transaction(async (client) => {
      const r = await client.query<{ id: string }>('SELECT id FROM conversations');
      return r.rows;
    });
    assert.equal(rows.length, 0, 'unset scope must fail closed, not open');
  } finally {
    await c.close();
  }
});

test('scope does not leak between transactions on a pooled connection', async (t) => {
  if (skip) return t.skip(skip);

  await pgScoped(A, (client) => saveConversation(client, conversation('c-leak', A)));

  const c = conn();
  try {
    // First transaction sets A's scope...
    await c.transaction((client) => withScope(client, A, async () => {
      const r = await client.query('SELECT id FROM conversations');
      assert.ok(r.rows.length > 0, 'A sees rows inside its own transaction');
    }));

    // ...the next must NOT inherit it (set_config used transaction-local mode).
    const leaked = await c.transaction(async (client) => {
      const r = await client.query<{ id: string }>('SELECT id FROM conversations');
      return r.rows.length;
    });
    assert.equal(leaked, 0, 'scope must not survive into the next transaction');
  } finally {
    await c.close();
  }
});

test('writing outside your scope is rejected by WITH CHECK', async (t) => {
  if (skip) return t.skip(skip);

  await assert.rejects(
    () => pgScoped(B, (client) => saveConversation(client, conversation('c-forge', A))),
    'B must not insert a row labelled as A',
  );
});
