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
import { Pool } from 'pg';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let skip: string | null = null;
let pg: DisposablePostgres;
let pool: Pool;
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
  pool = new Pool({ connectionString: appUrl });
  store = new PostgresDurableStore(pool, new PostgresConnection({ databaseUrl: appUrl }));
}, { timeout: 180_000 });

after(async () => {
  await pool?.end().catch(() => undefined);
  await pg?.stop();
});

/* ── 1.1 correct scope succeeds ──────────────────────────────────────────── */

test('1.1 a correctly scoped write commits and reads back', { skip: skip ?? false }, async () => {
  await store.saveConversation(conversation('c-ok', A));
  await store.saveMessage(message('m-ok', 'c-ok'), A);

  const loaded = await store.loadDurableForScope(A);
  assert.ok(loaded.conversations.some((c) => c.id === 'c-ok'), 'conversation is readable in its own scope');
  assert.ok(loaded.messages.some((m) => m.id === 'm-ok'), 'message is readable in its own scope');
});

/* ── 1.2 cross-OWNER write rejected ──────────────────────────────────────── */

test('1.2 a cross-owner message write is REJECTED by PostgreSQL', { skip: skip ?? false }, async () => {
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

test('1.3 a cross-workspace message write is REJECTED', { skip: skip ?? false }, async () => {
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

test("1.4 one tenant cannot see another's conversations", { skip: skip ?? false }, async () => {
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

test('1.5 loadDurable() throws instead of reporting an empty Brain', { skip: skip ?? false }, async () => {
  // An undeclared scope legitimately sees zero rows. Returning [] would be
  // indistinguishable from "this tenant has nothing" and would boot an
  // apparently empty Brain while every row sat safe in the database.
  await assert.rejects(() => store.loadDurable(), /row-level security/i);
});

/* ── 1.6 summaries obey the same rules ───────────────────────────────────── */

test('1.6 a cross-owner summary write is REJECTED', { skip: skip ?? false }, async () => {
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

test('2.5 createConversationWithFirstMessage is atomic', { skip: skip ?? false }, async () => {
  await store.createConversationWithFirstMessage(conversation('c-atomic', A), message('m-atomic', 'c-atomic'));

  const loaded = await store.loadDurableForScope(A);
  assert.ok(loaded.conversations.some((c) => c.id === 'c-atomic'));
  assert.ok(loaded.messages.some((m) => m.id === 'm-atomic'), 'both records, one transaction');
});

/* ── 2.2 rollback leaves nothing ─────────────────────────────────────────── */

test('2.2 a failed multi-record write leaves NO conversation behind', { skip: skip ?? false }, async () => {
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

test('1.9 a message referencing a NONEXISTENT conversation is rejected', { skip: skip ?? false }, async () => {
  // Before migration 10 this succeeded: conversation_messages had no foreign key
  // at all, so a message could name a conversation that never existed.
  await assert.rejects(
    () => store.saveMessage(message('m-orphan', 'conversation-that-never-existed'), A),
    'a message must reference a real conversation',
  );
});

test('1.10 a summary referencing a NONEXISTENT conversation is rejected', { skip: skip ?? false }, async () => {
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
