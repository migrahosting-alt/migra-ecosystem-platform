import assert from 'node:assert/strict';
import test from 'node:test';

import { ConversationStore } from '../src/engine/memory/conversationStore.js';

/**
 * Grounding belongs to the CONVERSATION, and must survive a restart.
 *
 * The defect this closes was verified live: grounding lived in a browser ref, so a
 * reload silently dropped it and the same question answered "I don't have access to
 * external documents" with the earlier answers still on screen.
 */
const scope = { owner: 'o1', workspace: 'w1' };

let seq = 0;
function storeWith(saved: unknown[] = []) {
  const persistence = {
    saveConversation(c: unknown) { saved.push(structuredClone(c)); },
    saveMessage() {}, saveSummary() {}, deleteConversation() {},
  };
  // (now, mkId, persistence) — the clock and id factory are injected so tests do
  // not depend on wall-clock time.
  const store = new ConversationStore(() => 1_000, (p: string) => `${p}_${++seq}`, persistence as never);
  return { store, saved };
}

test('a durable conversation persists its grounding set', () => {
  const { store, saved } = storeWith();
  const c = store.createConversation(scope, { memoryMode: 'durable' });
  const updated = store.setGroundingFiles(c.id, scope, ['notes.md', 'data.json']);
  assert.deepEqual(updated?.groundingFiles, ['notes.md', 'data.json']);
  // Written through, or a restart loses it — which is the whole point.
  assert.ok(saved.some((s) => (s as { groundingFiles?: string[] }).groundingFiles?.length === 2));
});

test('the set is replaced, never merged', () => {
  // Deltas would let a retry leave a thread grounded in something nobody chose.
  const { store } = storeWith();
  const c = store.createConversation(scope, { memoryMode: 'durable' });
  store.setGroundingFiles(c.id, scope, ['a.md', 'b.md']);
  assert.deepEqual(store.setGroundingFiles(c.id, scope, ['c.md'])?.groundingFiles, ['c.md']);
});

test('detaching everything is a real state, distinct from never attaching', () => {
  const { store } = storeWith();
  const c = store.createConversation(scope, { memoryMode: 'durable' });
  store.setGroundingFiles(c.id, scope, ['a.md']);
  assert.deepEqual(store.setGroundingFiles(c.id, scope, [])?.groundingFiles, []);
});

test('duplicates collapse and order is preserved', () => {
  const { store } = storeWith();
  const c = store.createConversation(scope, { memoryMode: 'durable' });
  assert.deepEqual(store.setGroundingFiles(c.id, scope, ['b.md', 'a.md', 'b.md'])?.groundingFiles, ['b.md', 'a.md']);
});

test('another tenant cannot read or set grounding', () => {
  const { store } = storeWith();
  const c = store.createConversation(scope, { memoryMode: 'durable' });
  assert.equal(store.setGroundingFiles(c.id, { owner: 'other', workspace: 'w1' }, ['x.md']), undefined);
});

test('a new conversation starts grounded in nothing', () => {
  const { store } = storeWith();
  const c = store.createConversation(scope, { memoryMode: 'durable' });
  assert.equal(c.groundingFiles, undefined);
});

test('hydrated conversations keep the grounding they were stored with', () => {
  // The restart path: what loadDurable returns must come back intact.
  const { store } = storeWith();
  store.hydrate({
    conversations: [{
      id: 'c1', ownerScope: 'o1', workspaceScope: 'w1', title: 't', memoryMode: 'durable',
      createdAt: 1, updatedAt: 1, groundingFiles: ['kept.md'],
    }],
    messages: [], summaries: [],
  });
  assert.deepEqual(store.getConversation('c1', scope)?.groundingFiles, ['kept.md']);
});
