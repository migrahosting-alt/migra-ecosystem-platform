/**
 * A message keeps the picture it asked about.
 *
 * THE DEFECT THIS PINS. The image was persisted at the CONVERSATION level and the
 * transcript rendered it from memory only, so after a reload the sent message
 * showed its text and nothing else: the system remembered what the thread was
 * about while losing what each turn had actually carried.
 *
 * Two concepts, deliberately separate:
 *   Conversation.imageRefs — ACTIVE CONTEXT for follow-ups without re-attaching.
 *   Message.imageRefs      — the IMMUTABLE RECORD of one turn.
 *
 * Deriving the second from the first is wrong in a way that only appears later:
 * attach A and ask, attach B and ask, drop A from the context — and message one
 * silently loses its picture, or worse, shows B.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationStore } from '../src/engine/memory/conversationStore.js';

const SCOPE = { owner: 'u1', workspace: 'w1' };
const A = 'img_' + 'a'.repeat(32);
const B = 'img_' + 'b'.repeat(32);

/** A store whose durable half is a real round trip, not a stub that agrees. */
function durableStore() {
  const rows = new Map<string, unknown>();
  const persistence = {
    saveConversation: async (c: unknown) => { rows.set(`c:${(c as { id: string }).id}`, structuredClone(c)); },
    saveMessage: async (m: unknown) => { rows.set(`m:${(m as { id: string }).id}`, structuredClone(m)); },
    saveSummary: async () => {},
    loadDurable: async () => ({
      conversations: [...rows.entries()].filter(([k]) => k.startsWith('c:')).map(([, v]) => v),
      messages: [...rows.entries()].filter(([k]) => k.startsWith('m:')).map(([, v]) => v),
      summaries: [],
    }),
  };
  return { rows, persistence };
}

async function seed() {
  const { persistence } = durableStore();
  const store = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await store.createConversation(SCOPE, { title: 'T', memoryMode: 'durable' });
  const m1 = await store.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'What do you see in this image?', status: 'complete', imageRefs: [A],
  });
  const m2 = await store.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'And this one?', status: 'complete', imageRefs: [B],
  });
  // Both are active context at this point.
  await store.setImageRefs(conv.id, SCOPE, [A, B]);
  return { store, conv, m1: m1!, m2: m2! };
}

test('each message keeps its own image, and not the other one', async () => {
  const { store, conv, m1, m2 } = await seed();
  const thread = store.getMessages(conv.id, SCOPE);

  const first = thread.find((m) => m.id === m1.id)!;
  const second = thread.find((m) => m.id === m2.id)!;
  assert.deepEqual(first.imageRefs, [A]);
  assert.deepEqual(second.imageRefs, [B]);
  assert.ok(!first.imageRefs!.includes(B), 'message one must not show the later picture');
  assert.ok(!second.imageRefs!.includes(A));
});

test('detaching from the active context does not rewrite history', async () => {
  /*
   * THE CASE THAT PROVES THE TWO CONCEPTS ARE SEPARATE. A is dropped from the
   * thread so future turns no longer carry it — and the message that asked about
   * A must still show A.
   */
  const { store, conv, m1, m2 } = await seed();
  await store.setImageRefs(conv.id, SCOPE, [B]);

  const active = store.getConversation(conv.id, SCOPE)!.imageRefs;
  assert.deepEqual(active, [B], 'future follow-ups no longer include A');

  const thread = store.getMessages(conv.id, SCOPE);
  assert.deepEqual(thread.find((m) => m.id === m1.id)!.imageRefs, [A],
    'the historical message keeps the picture it asked about');
  assert.deepEqual(thread.find((m) => m.id === m2.id)!.imageRefs, [B]);
});

test('order is preserved when one message carries several images', async () => {
  // "Compare the first with the second" is a different question if they swap.
  const { persistence } = durableStore();
  const store = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await store.createConversation(SCOPE, { title: 'T', memoryMode: 'durable' });
  const m = await store.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'compare', status: 'complete', imageRefs: [B, A],
  });
  assert.deepEqual(m!.imageRefs, [B, A]);
});

test('a message with no images records none, rather than an empty claim', async () => {
  const { persistence } = durableStore();
  const store = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await store.createConversation(SCOPE, { title: 'T', memoryMode: 'durable' });
  const m = await store.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'just text', status: 'complete',
  });
  assert.equal(m!.imageRefs, undefined)
});

test('anything that is not a canonical ref never reaches the record', async () => {
  /*
   * Validated at the store as well as at intake: this is the last place before a
   * durable row, and a value that is not a ref could never resolve to a picture
   * on any later read of the transcript.
   */
  const { persistence } = durableStore();
  const store = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await store.createConversation(SCOPE, { title: 'T', memoryMode: 'durable' });
  const m = await store.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'x', status: 'complete',
    imageRefs: [A, 'undefined', '9a39fd9e-2daf-42e1-9f0e-000000000000', '../../etc/passwd'],
  });
  assert.deepEqual(m!.imageRefs, [A]);
});

test('the refs survive a durable round trip, which is what a reload is', async () => {
  const { persistence } = durableStore();
  const store = new ConversationStore(undefined, undefined, persistence as never);
  const conv = await store.createConversation(SCOPE, { title: 'T', memoryMode: 'durable' });
  await store.appendMessage(conv.id, SCOPE, {
    role: 'user', content: 'What do you see in this image?', status: 'complete', imageRefs: [A],
  });

  /*
   * Read back from the DURABLE rows rather than from memory. That is the whole
   * distinction: the in-memory copy always had the refs, and a reload is served
   * from what was actually written.
   */
  const loaded = (await persistence.loadDurable()).messages as { imageRefs?: string[] }[];
  assert.deepEqual(loaded[0]!.imageRefs, [A],
    'a reload must reconstruct the picture from the message record');
});
