import assert from 'node:assert/strict';
import test from 'node:test';

import { ConversationStore } from '../src/engine/memory/conversationStore.js';

/**
 * The cache has to be able to forget, because the claim writes behind it.
 *
 * Moving an anonymous conversation into an account is a direct scoped
 * PostgreSQL transaction — it must be, because row-level security's `WITH CHECK`
 * refuses to let a row be rewritten into a scope other than the declared one.
 * The in-memory conversation cache therefore learns nothing from the move, and a
 * cache that has not been told keeps serving the world as it was.
 *
 * That is not a cosmetic staleness. Verified on chat.migrateck.com: a claim
 * answered `claimed: true`, the anonymous cookie was revoked on the strength of
 * it, and afterwards the conversation was a 404 for the account and a 200 for
 * the visitor whose authority had just been taken away. Both sides wrong, in
 * opposite directions, with a success reported to each.
 *
 * Two properties are pinned here:
 *
 *   eviction is SCOPED — one tenant's eviction cannot empty another's cache
 *   a re-hydrated scope does not DUPLICATE its messages, which is what would
 *     happen if the rows were left in the maps and `hydrate` appended over them
 */

const anon = { owner: 'anon:visitor1', workspace: 'anon:visitor1' };
const other = { owner: 'anon:visitor2', workspace: 'anon:visitor2' };
const account = { owner: 'user:abc', workspace: 'personal:abc' };

let seq = 0;
function storeWith(durable: {
  conversations: unknown[];
  messages: unknown[];
  summaries: unknown[];
}) {
  const persistence = {
    async saveConversation() {},
    async saveMessage() {},
    async saveSummary() {},
    async deleteConversation() {},
    async loadDurableForScope(scope: { owner: string; workspace: string }) {
      const owned = (durable.conversations as { id: string; ownerScope: string; workspaceScope: string }[])
        .filter((c) => c.ownerScope === scope.owner && c.workspaceScope === scope.workspace);
      const ids = new Set(owned.map((c) => c.id));
      return {
        conversations: structuredClone(owned),
        messages: structuredClone(
          (durable.messages as { conversationId: string }[]).filter((m) => ids.has(m.conversationId)),
        ),
        summaries: [],
      };
    },
  };
  return new ConversationStore(() => 1_000, (p: string) => `${p}_${++seq}`, persistence as never);
}

const conversation = (id: string, scope: { owner: string; workspace: string }) => ({
  id, ownerScope: scope.owner, workspaceScope: scope.workspace,
  title: 'thread', memoryMode: 'durable' as const, createdAt: 10, updatedAt: 10,
});

const message = (id: string, conversationId: string) => ({
  id, conversationId, role: 'user' as const, content: 'hello',
  status: 'complete' as const, createdAt: 20, durable: true,
});

test('an evicted scope re-reads the database instead of its stale copy', async () => {
  const durable = {
    conversations: [conversation('c-1', anon)] as unknown[],
    messages: [message('m-1', 'c-1')] as unknown[],
    summaries: [] as unknown[],
  };
  const store = storeWith(durable);

  await store.ensureScopeHydrated(anon);
  assert.equal(store.listConversations(anon).length, 1, 'the visitor sees their thread');

  // The claim moves the row in the database. The cache is not part of that.
  durable.conversations = [conversation('c-1', account)];
  assert.equal(
    store.listConversations(anon).length,
    1,
    'and without eviction it keeps serving a conversation the visitor no longer owns',
  );

  store.evictScope(anon);
  store.evictScope(account);

  // The read path hydrates before it lists, which is what makes eviction a
  // re-read rather than a permanent hole.
  await store.ensureScopeHydrated(anon);
  await store.ensureScopeHydrated(account);

  assert.deepEqual(store.listConversations(anon), [], 'the visitor no longer sees it');
  const owned = store.listConversations(account);
  assert.deepEqual(owned.map((c) => c.id), ['c-1'], 'and the account now does — same id');
});

test('eviction is scoped: one visitor cannot empty another visitor\'s cache', async () => {
  const durable = {
    conversations: [conversation('c-1', anon), conversation('c-2', other)] as unknown[],
    messages: [] as unknown[],
    summaries: [] as unknown[],
  };
  const store = storeWith(durable);

  await store.ensureScopeHydrated(anon);
  await store.ensureScopeHydrated(other);
  store.evictScope(anon);

  // `other` was never re-loaded, so this is served from cache — which is the
  // point: evicting one tenant must not cost every other tenant their state.
  assert.deepEqual(store.listConversations(other).map((c) => c.id), ['c-2']);
});

test('re-hydrating an evicted scope does not duplicate its messages', async () => {
  /*
   * `hydrate` APPENDS to the message arrays. Clearing only the hydration flag
   * and leaving the conversations in the maps would therefore double every
   * message on the next read — a conversation that says everything twice.
   */
  const durable = {
    conversations: [conversation('c-1', account)] as unknown[],
    messages: [message('m-1', 'c-1'), message('m-2', 'c-1')] as unknown[],
    summaries: [] as unknown[],
  };
  const store = storeWith(durable);

  await store.ensureScopeHydrated(account);
  assert.equal(store.getMessages('c-1', account).length, 2);

  store.evictScope(account);
  await store.ensureScopeHydrated(account);

  assert.equal(
    store.getMessages('c-1', account).length,
    2,
    'still two — not four',
  );
});
