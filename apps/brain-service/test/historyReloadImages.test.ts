/**
 * The reload path, end to end — the one place the bug actually lived.
 *
 * A DIRECT STORE READ WOULD HAVE PASSED THIS WHOLE TIME. The in-memory copy
 * always had the refs. What a page load does is different: the process is gone,
 * the conversation is rebuilt from durable rows, and it is served through the
 * SAME history route the browser calls. Every assertion below therefore comes
 * from that route's JSON, never from the store the writer used.
 *
 * FRESH MESSAGES ONLY. Rows written before migration 19 legitimately have no
 * `image_refs`, so a fixture that reused old data could hide a real failure
 * behind honest history.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { ConversationStore } from '../src/engine/memory/conversationStore.js';
import { registerMemoryRoutes } from '../src/engine/memory/memoryRoutes.js';

const SCOPE = { owner: 'user:reload', workspace: 'personal:reload' };
const HEADERS = { 'x-owner-scope': SCOPE.owner, 'x-workspace-scope': SCOPE.workspace };
const A = 'img_' + 'a'.repeat(32);
const B = 'img_' + 'b'.repeat(32);

/** A durable store that really round-trips: writes land in rows, reads come back. */
function durableRows() {
  const conversations = new Map<string, unknown>();
  const messages = new Map<string, unknown>();
  return {
    rows: { conversations, messages },
    persistence: {
      saveConversation: async (c: { id: string }) => { conversations.set(c.id, structuredClone(c)); },
      saveMessage: async (m: { id: string }) => { messages.set(m.id, structuredClone(m)); },
      saveSummary: async () => {},
      loadDurable: async () => ({
        conversations: [...conversations.values()],
        messages: [...messages.values()],
        summaries: [],
      }),
      /*
       * The SCOPED loader is what a real page load uses — hydration follows the
       * request so one tenant's read never populates another's cache. A fixture
       * that only offered `loadDurable` would exercise a path production does not.
       */
      loadDurableForScope: async () => ({
        conversations: [...conversations.values()],
        messages: [...messages.values()],
        summaries: [],
      }),
    },
  };
}

async function historyApi(store: ConversationStore) {
  const app = Fastify();
  registerMemoryRoutes(app, store);
  await app.ready();
  return app;
}

test('a message keeps its image across a full reload, through the history API', async () => {
  const { persistence } = durableRows();

  // ── the writing process ────────────────────────────────────────────────
  const writer = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await writer.createConversation(SCOPE, { title: 'T', memoryMode: 'durable' });
  await writer.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'What do you see in this image?', status: 'complete', imageRefs: [A],
  });
  await writer.appendMessage(conv.id, SCOPE, {
    role: 'assistant', content: 'Pink tulips.', status: 'complete',
  });
  await writer.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'And this one?', status: 'complete', imageRefs: [B],
  });
  await writer.setImageRefs(conv.id, SCOPE, [A, B]);

  // ── every trace of that process is discarded ───────────────────────────
  // A new store over the same rows is exactly what a restart plus a page load
  // gets: nothing survives except what was actually written.
  const reader = new ConversationStore(undefined, undefined, persistence as never);
  await reader.ensureScopeHydrated(SCOPE);
  const app = await historyApi(reader);

  const response = await app.inject({
    method: 'GET', url: `/api/ai/conversations/${conv.id}/messages`, headers: HEADERS,
  });
  assert.equal(response.statusCode, 200, 'the history route must serve the rebuilt thread');

  const served = response.json().messages as { role: string; content: string; imageRefs?: string[] }[];
  const first = served.find((m) => m.content.startsWith('What do you see'));
  const second = served.find((m) => m.content.startsWith('And this one'));
  assert.ok(first && second, 'both user turns must come back');

  // THE ASSERTION THAT MATTERS: it is in the SERIALIZED response, not the store.
  assert.deepEqual(first.imageRefs, [A]);
  assert.deepEqual(second.imageRefs, [B]);
  assert.ok(!first.imageRefs!.includes(B), 'a turn must not inherit another turn’s picture');

  await app.close();
});

test('detaching from active context does not rewrite the served history', async () => {
  const { persistence } = durableRows();
  const writer = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await writer.createConversation(SCOPE, { title: 'T', memoryMode: 'durable' });
  await writer.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'about A', status: 'complete', imageRefs: [A],
  });
  await writer.setImageRefs(conv.id, SCOPE, [A, B]);
  // A leaves the active context; future turns no longer carry it.
  await writer.setImageRefs(conv.id, SCOPE, [B]);

  const reader = new ConversationStore(undefined, undefined, persistence as never);
  await reader.ensureScopeHydrated(SCOPE);
  const app = await historyApi(reader);

  const history = await app.inject({
    method: 'GET', url: `/api/ai/conversations/${conv.id}/messages`, headers: HEADERS,
  });
  const served = history.json().messages as { imageRefs?: string[] }[];
  assert.deepEqual(served[0]!.imageRefs, [A], 'history keeps the picture the turn asked about');

  const list = await app.inject({ method: 'GET', url: '/api/ai/conversations', headers: HEADERS });
  const conversation = (list.json().conversations as { id: string; imageRefs?: string[] }[])
    .find((c) => c.id === conv.id)!;
  assert.deepEqual(conversation.imageRefs, [B], 'active context no longer includes A');

  await app.close();
});

test('a session-scoped conversation persists nothing, which is what hid the bug', async () => {
  /*
   * The production defect in one assertion. `memoryMode: 'session'` writes no
   * rows at all, so a reload finds an empty thread — and within one process
   * lifetime it still looked like it worked, because memory still had it.
   */
  const { rows, persistence } = durableRows();
  const writer = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await writer.createConversation(SCOPE, { title: 'T', memoryMode: 'session' });
  await writer.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'about A', status: 'complete', imageRefs: [A],
  });
  assert.equal(rows.messages.size, 0, 'session mode writes nothing');
  assert.equal(rows.conversations.size, 0);
});
