// The durable-write invariant, from the canary finding. © MigraTeck LLC.
//
// `durable: true` is returned ONLY after persistence has actually committed.
//
// The canary caught the Brain answering {ok:true, stored:true, durable:true} for
// a `memoryMode: durable` write while the state database was unreadable. After
// recovery that conversation was gone, while durable data written before the
// failure survived intact — so the acknowledgement had been false and the loss
// was silent.
//
// The sequence below is that incident, start to finish.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConversationStore,
  NOOP_PERSISTENCE,
  PersistenceUnavailableError,
  type MemoryPersistence,
  type Conversation,
  type Message,
} from '../src/engine/memory/conversationStore.js';

const A = { owner: 'o1', workspace: 'w1' };

/** A store whose disk can be taken away and given back, as chmod 000 does. */
function failableStore(): MemoryPersistence & { readable: boolean; conversations: Conversation[]; messages: Message[] } {
  const state = {
    readable: true,
    conversations: [] as Conversation[],
    messages: [] as Message[],
    async saveConversation(c: Conversation) {
      if (!state.readable) throw new Error('unable to open database file');
      state.conversations.push({ ...c });
    },
    async saveMessage(m: Message) {
      if (!state.readable) throw new Error('unable to open database file');
      state.messages.push({ ...m });
    },
    async saveSummary() {
      if (!state.readable) throw new Error('unable to open database file');
    },
    async deleteConversation() {
      if (!state.readable) throw new Error('unable to open database file');
    },
  };
  return state;
}

test('the canary sequence: durable data survives, a refused write never claims to', async () => {
  const disk = failableStore();
  const store = new ConversationStore(undefined, undefined, disk);

  // 1. A durable conversation written while storage is healthy.
  const before = await store.createConversation(A, { memoryMode: 'durable', title: 'before' });
  const kept = await store.appendMessage(before.id, A, {
    role: 'user',
    content: 'canary durable marker ORANGE ANVIL 707',
    status: 'complete',
  });
  assert.equal(kept?.durable, true, 'a committed durable write reports durable');
  assert.ok(disk.messages.some((m) => m.id === kept!.id), 'and it really reached the store');

  // 2. The database becomes unreadable.
  disk.readable = false;

  // 3. THE FINDING: a durable write must now be REFUSED, not acknowledged.
  await assert.rejects(
    () => store.appendMessage(before.id, A, { role: 'user', content: 'written during storage failure', status: 'complete' }),
    (error: unknown) => error instanceof PersistenceUnavailableError && error.code === 'PERSISTENCE_UNAVAILABLE',
    'a durable write during a storage outage must throw, never return stored:true',
  );
  await assert.rejects(
    () => store.createConversation(A, { memoryMode: 'durable', title: 'during failure' }),
    PersistenceUnavailableError,
  );

  // 4. And it must leave NOTHING behind — a refused write that is readable from
  //    memory is the same lie, just deferred to the next restart.
  const visible = store.getMessages(before.id, A);
  assert.equal(visible.length, 1, 'the refused message is not readable');
  assert.equal(visible[0]!.content, 'canary durable marker ORANGE ANVIL 707');

  // 5. Storage comes back.
  disk.readable = true;

  // 6. The prior durable data is intact, and the failed write is absent.
  assert.equal(disk.messages.length, 1, 'the refused write never reached the store');
  assert.ok(!disk.conversations.some((c) => c.title === 'during failure'));

  // 7. A new durable write succeeds and is committed for real.
  const after = await store.appendMessage(before.id, A, { role: 'user', content: 'after recovery', status: 'complete' });
  assert.equal(after?.durable, true);
  assert.ok(disk.messages.some((m) => m.content === 'after recovery'), 'recovery restores durability');
});

test('a rehydrated store still holds what was committed before the failure', async () => {
  // The restart half of the incident: what the store CAN produce after a reload
  // is exactly what reached the disk, so the refused write must be absent there.
  const disk = failableStore();
  const first = new ConversationStore(undefined, undefined, disk);
  const c = await first.createConversation(A, { memoryMode: 'durable', title: 'survivor' });
  await first.appendMessage(c.id, A, { role: 'user', content: 'kept', status: 'complete' });

  disk.readable = false;
  await assert.rejects(
    () => first.appendMessage(c.id, A, { role: 'user', content: 'lost', status: 'complete' }),
    PersistenceUnavailableError,
  );
  disk.readable = true;

  const restarted = new ConversationStore(undefined, undefined, disk);
  restarted.hydrate({ conversations: disk.conversations, messages: disk.messages, summaries: [] });

  const messages = restarted.getMessages(c.id, A);
  assert.deepEqual(messages.map((m) => m.content), ['kept'], 'only committed data comes back');
});

test('session mode is NOT a defect: it stores in memory and says durable:false', async () => {
  // The first canary probe "failed" because it used the default session mode,
  // and the response had said `durable: false` at creation. The system was
  // honest and the probe was wrong. That distinction must keep working: a
  // session write during a storage outage is legitimate, because nothing about
  // it was ever promised to disk.
  const disk = failableStore();
  const store = new ConversationStore(undefined, undefined, disk);
  const c = await store.createConversation(A, { memoryMode: 'session' });

  disk.readable = false;
  const m = await store.appendMessage(c.id, A, { role: 'user', content: 'session write', status: 'complete' });

  assert.equal(m?.durable, false, 'session messages report durable:false');
  assert.equal(store.getMessages(c.id, A).length, 1, 'and are still readable in memory');
  assert.equal(disk.messages.length, 0, 'nothing was written to disk, as promised');
});

test('a durable write with NO durable adapter is refused, not silently kept in memory', async () => {
  // server.ts sets `durable` to undefined when persistence is selected but
  // unwired, which lands NOOP_PERSISTENCE here. A no-op "succeeds" every time,
  // so without this guard the acknowledgement would be false again — same lie,
  // different route.
  const store = new ConversationStore(undefined, undefined, NOOP_PERSISTENCE);
  await assert.rejects(
    () => store.createConversation(A, { memoryMode: 'durable' }),
    (error: unknown) => error instanceof PersistenceUnavailableError,
    'durable mode against a no-op store must refuse',
  );

  // A session conversation is unaffected — it never claimed to outlive anything.
  const session = await store.createConversation(A, { memoryMode: 'session' });
  const m = await store.appendMessage(session.id, A, { role: 'user', content: 'x', status: 'complete' });
  assert.equal(m?.durable, false);
});
