import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import type { BrainEnv } from '../src/config/env.js';
import type { ModelDescriptor } from '../src/engine/modelRegistry.js';
import { ConversationStore, type MemoryPersistence, type Scope } from '../src/engine/memory/conversationStore.js';
import { redactSecrets, sanitizeForMemory } from '../src/engine/memory/redaction.js';
import { buildContext } from '../src/engine/memory/contextBuilder.js';
import { summarizeConversation } from '../src/engine/memory/summarizer.js';
import { registerMemoryRoutes } from '../src/engine/memory/memoryRoutes.js';
import { registerAiRoutes } from '../src/engine/aiRoutes.js';

const A: Scope = { owner: 'local', workspace: 'wsA' };
const B: Scope = { owner: 'local', workspace: 'wsB' };
const STUB_ENV: BrainEnv = {
  host: '127.0.0.1', port: 0, mode: 'hybrid', enableTelemetry: false,
  localProvider: 'stub', providerBaseUrl: 'http://127.0.0.1:11434/v1', visionModel: 'llava:latest',
};

// ── Redaction ────────────────────────────────────────────────────────────────
test('redaction removes secrets + approval material', () => {
  const r = redactSecrets('token eyJhbGciOiJIUzI1NiJ9.aaaaabbbbb.cccccddddd key sk-ABCDEFGHIJKLMNOP appr_deadbeef1234 PASSWORD=hunter2 Bearer abcdef123456');
  assert.ok(!/eyJhbGc|sk-ABCDEF|appr_deadbeef|hunter2|Bearer abcdef/.test(r.text), r.text);
  assert.ok(r.redacted.length >= 4);
  assert.match(sanitizeForMemory({ a: 'x'.repeat(9000) }), /…$/);
});

// ── Conversation CRUD + isolation + cascade ─────────────────────────────────
test('create/read/delete conversation + deleted cannot be reopened', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  assert.ok(s.getConversation(c.id, A));
  assert.equal(s.deleteConversation(c.id, A), true);
  assert.equal(s.getConversation(c.id, A), undefined, 'deleted conversation cannot be reopened');
});

test('createConversation re-adopts a well-shaped, unused client id (restart recovery)', () => {
  const s = new ConversationStore();
  // A client id whose in-memory conversation was lost (brain restart) is re-adopted
  // verbatim, so the client's stored id stays valid and forward turns accumulate.
  const readopted = s.createConversation(A, { memoryMode: 'session', id: 'conv_stale123abc' });
  assert.equal(readopted.id, 'conv_stale123abc');
  assert.ok(s.getConversation('conv_stale123abc', A), 're-adopted id is retrievable');
  // A malformed id is ignored (a fresh id is minted instead).
  assert.notEqual(s.createConversation(A, { memoryMode: 'session', id: 'not-a-conv-id' }).id, 'not-a-conv-id');
  // A colliding id is never hijacked — a fresh id is minted.
  assert.notEqual(s.createConversation(A, { memoryMode: 'session', id: 'conv_stale123abc' }).id, 'conv_stale123abc');
});

test('workspace + tenant isolation at the store layer', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  s.appendMessage(c.id, A, { role: 'user', content: 'secret A history', status: 'complete' });
  assert.equal(s.getConversation(c.id, B), undefined, 'workspace B cannot see workspace A conversation');
  assert.equal(s.getMessages(c.id, B).length, 0, 'workspace B cannot read A messages');
  assert.equal(s.appendMessage(c.id, B, { role: 'user', content: 'x', status: 'complete' }), null);
});

test('off / session / durable retention semantics', () => {
  const saved: string[] = [];
  const spy: MemoryPersistence = { saveConversation() {}, saveMessage: (m) => saved.push(m.id), saveSummary() {}, deleteConversation() {} };
  const s = new ConversationStore(undefined, undefined, spy);
  const off = s.createConversation(A, { memoryMode: 'off' });
  assert.equal(s.appendMessage(off.id, A, { role: 'user', content: 'x', status: 'complete' }), null);
  assert.equal(s.getMessages(off.id, A).length, 0, 'off retains nothing');

  const sess = s.createConversation(A, { memoryMode: 'session' });
  const sm = s.appendMessage(sess.id, A, { role: 'user', content: 'x', status: 'complete' })!;
  assert.equal(sm.durable, false);

  const dur = s.createConversation(A, { memoryMode: 'durable' });
  const dm = s.appendMessage(dur.id, A, { role: 'user', content: 'x', status: 'complete' })!;
  assert.equal(dm.durable, true);
  assert.ok(saved.includes(dm.id) && !saved.includes(sm.id), 'only durable messages persist');
});

test('messages are immutable; corrections create new records', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  const m1 = s.appendMessage(c.id, A, { role: 'assistant', content: 'first', status: 'complete' })!;
  assert.ok(Object.isFrozen(m1));
  assert.throws(() => { (m1 as { content: string }).content = 'edited'; });
  const m2 = s.appendMessage(c.id, A, { role: 'assistant', content: 'corrected', status: 'complete', supersedesId: m1.id })!;
  assert.equal(m2.supersedesId, m1.id);
  assert.equal(s.getMessages(c.id, A).length, 2, 'correction is a NEW record');
});

test('append is idempotent per (requestId, role)', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  s.appendMessage(c.id, A, { role: 'user', content: 'hi', status: 'complete', requestId: 'r1' });
  s.appendMessage(c.id, A, { role: 'user', content: 'hi', status: 'complete', requestId: 'r1' });
  assert.equal(s.getMessages(c.id, A).length, 1, 'retry with same requestId does not duplicate');
});

test('deletion cascade removes messages + summaries', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  for (let i = 0; i < 5; i++) s.appendMessage(c.id, A, { role: 'user', content: `m${i}`, status: 'complete' });
  summarizeConversation(s, A, c.id, { force: true });
  s.deleteConversation(c.id, A);
  assert.equal(s.getMessages(c.id, A).length, 0);
  assert.equal(s.getSummaries(c.id, A).length, 0);
});

// ── Summarizer ───────────────────────────────────────────────────────────────
test('summary: source binding + idempotency + no invention', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push(s.appendMessage(c.id, A, { role: 'user', content: `request ${i}?`, status: 'complete' })!.id);
  const first = summarizeConversation(s, A, c.id, { force: true });
  assert.ok(first.ok && first.summary);
  assert.equal(first.summary!.sourceFromMessageId, ids[0]);
  assert.equal(first.summary!.sourceToMessageId, ids[4]);
  assert.equal(first.summary!.summary.confirmedFacts.length, 0, 'no invented facts');
  assert.ok(first.summary!.summary.questions.length >= 1);
  // Idempotent: nothing new → already-summarized, returns the same summary.
  const again = summarizeConversation(s, A, c.id, { force: true });
  assert.equal(again.reason, 'already-summarized');
  assert.equal(again.summary!.id, first.summary!.id);
});

test('summary threshold gating', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  s.appendMessage(c.id, A, { role: 'user', content: 'only one', status: 'complete' });
  assert.equal(summarizeConversation(s, A, c.id).reason, 'not-enough-messages');
});

// ── Context builder ──────────────────────────────────────────────────────────
test('context builder: bounded, budgeted, explainable', () => {
  const s = new ConversationStore();
  const c = s.createConversation(A, { memoryMode: 'session' });
  s.addMemoryItem({ scope: { workspace: 'wsA' }, category: 'workspace-fact', content: 'Uses Fastify', confidence: 0.9, sourceType: 'manual' });
  for (let i = 0; i < 10; i++) s.appendMessage(c.id, A, { role: i % 2 ? 'assistant' : 'user', content: `msg ${i} ${'x'.repeat(200)}`, status: 'complete' });
  const built = buildContext({ store: s, scope: A, conversationId: c.id, currentPrompt: 'now what?', retrieve: true, tokenBudget: 200 });
  assert.ok(built.diagnostics.workspaceMemoriesUsed >= 1);
  assert.ok(built.diagnostics.omittedForBudget > 0, 'tight budget omits older messages');
  assert.ok(built.messages[built.messages.length - 1]!.content.includes('now what?'), 'current request always included');
});

test('workspace memory isolation', () => {
  const s = new ConversationStore();
  s.addMemoryItem({ scope: { workspace: 'wsA' }, category: 'workspace-fact', content: 'A-fact', confidence: 1, sourceType: 'manual' });
  s.addMemoryItem({ scope: { workspace: 'wsB' }, category: 'workspace-fact', content: 'B-fact', confidence: 1, sourceType: 'manual' });
  assert.deepEqual(s.getWorkspaceMemories(A).map((m) => m.content), ['A-fact']);
});

// ── Routes + chat integration ────────────────────────────────────────────────
function memApp(store: ConversationStore, providerOverride?: (m: ModelDescriptor) => never): FastifyInstance {
  const app = Fastify();
  registerMemoryRoutes(app, store);
  registerAiRoutes(app, STUB_ENV, undefined, store, providerOverride as never);
  return app;
}
const H = (s: Scope) => ({ 'x-owner-scope': s.owner, 'x-workspace-scope': s.workspace });

test('routes: conversation lifecycle + messages + summarize', async () => {
  const store = new ConversationStore();
  const app = memApp(store);
  const created = await app.inject({ method: 'POST', url: '/api/ai/conversations', headers: H(A), payload: { memoryMode: 'session' } });
  assert.equal(created.statusCode, 201);
  const id = (created.json() as { id: string }).id;
  await app.inject({ method: 'POST', url: `/api/ai/conversations/${id}/messages`, headers: H(A), payload: { role: 'user', content: 'hello' } });
  const msgs = await app.inject({ method: 'GET', url: `/api/ai/conversations/${id}/messages`, headers: H(A) });
  assert.equal((msgs.json() as { messages: unknown[] }).messages.length, 1);
  // Cross-workspace GET is a 404.
  assert.equal((await app.inject({ method: 'GET', url: `/api/ai/conversations/${id}`, headers: H(B) })).statusCode, 404);
  await app.close();
});

test('chat commits user+assistant once and redacts secrets; retrieval diagnostics present', async () => {
  const store = new ConversationStore();
  const app = memApp(store);
  const id = (( await app.inject({ method: 'POST', url: '/api/ai/conversations', headers: H(A), payload: { memoryMode: 'session' } })).json() as { id: string }).id;
  const chat = await app.inject({
    method: 'POST', url: '/api/ai/chat', headers: { ...H(A), 'x-request-id': 'turn-1' },
    payload: { prompt: 'my key is sk-ABCDEFGHIJKLMNOPQR ok', conversationId: id, memoryPolicy: { mode: 'session', retrieve: true, store: true } },
  });
  assert.equal(chat.statusCode, 200);
  assert.ok((chat.json() as { context?: unknown }).context, 'context diagnostics returned');
  const msgs = store.getMessages(id, A);
  assert.equal(msgs.length, 2, 'user + assistant committed');
  assert.ok(!/sk-ABCDEF/.test(JSON.stringify(msgs)), 'secret redacted in stored message');
  // Retry same requestId → idempotent (still 2 messages).
  await app.inject({ method: 'POST', url: '/api/ai/chat', headers: { ...H(A), 'x-request-id': 'turn-1' }, payload: { prompt: 'x', conversationId: id, memoryPolicy: { mode: 'session', retrieve: true, store: true } } });
  assert.equal(store.getMessages(id, A).length, 2, 'retry does not duplicate');
  await app.close();
});

test('chat self-heals a stale conversationId instead of degrading to amnesia', async () => {
  const store = new ConversationStore();
  const app = memApp(store);
  // The client holds a conversationId whose server-side session memory was lost
  // (brain restart). It was never created here — getConversation returns undefined.
  const staleId = 'conv_lostafterrestart1';
  assert.equal(store.getConversation(staleId, A), undefined, 'precondition: id unknown to the store');
  const chat = await app.inject({
    method: 'POST', url: '/api/ai/chat', headers: { ...H(A), 'x-request-id': 'heal-1' },
    payload: { prompt: 'continue with the plan', conversationId: staleId, conversationSummary: 'user: build MigraWatch\nassistant: here is the plan', memoryPolicy: { mode: 'session', retrieve: true, store: true } },
  });
  assert.equal(chat.statusCode, 200);
  // Self-healed under the SAME id → the client's stored id stays valid, and this
  // turn is committed so subsequent turns accumulate real server memory.
  assert.equal((chat.json() as { conversationId?: string }).conversationId, staleId, 'echoes the re-adopted id');
  assert.equal(store.getMessages(staleId, A).length, 2, 'user + assistant committed under the re-adopted id');
  await app.close();
});

test('memory-off chat persists nothing', async () => {
  const store = new ConversationStore();
  const app = memApp(store);
  const id = (( await app.inject({ method: 'POST', url: '/api/ai/conversations', headers: H(A), payload: { memoryMode: 'off' } })).json() as { id: string }).id;
  await app.inject({ method: 'POST', url: '/api/ai/chat', headers: H(A), payload: { prompt: 'hello', conversationId: id, memoryPolicy: { mode: 'off', retrieve: true, store: true } } });
  assert.equal(store.getMessages(id, A).length, 0, 'off stores nothing durable');
  await app.close();
});

// ── Streaming commit + cancellation (real listen + controllable provider) ─────
function slowProvider(delayMs: number) {
  return () => ({
    profile: 'default' as const,
    async isAvailable() { return true; },
    async complete() { return { modelProfile: 'default' as const, content: 'full answer', citations: [], proposedEdits: [], telemetry: { inputTokens: 1, outputTokens: 2, latencyMs: 1, cacheHit: false } }; },
    async *stream() {
      yield { delta: 'partial ' };
      await new Promise((r) => setTimeout(r, delayMs));
      yield { delta: 'answer' };
      yield { usage: { inputTokens: 1, outputTokens: 2 } };
    },
  });
}

test('completed stream commits assistant once; cancelled stream commits nothing', async () => {
  const store = new ConversationStore();
  const app = memApp(store, slowProvider(400) as never);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const mk = async (mode: string) => (await (await fetch(`${base}/api/ai/conversations`, { method: 'POST', headers: { 'content-type': 'application/json', ...H(A) }, body: JSON.stringify({ memoryMode: mode }) })).json() as { id: string }).id;

  // Completed stream → assistant committed once.
  const cid = await mk('session');
  const res = await fetch(`${base}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...H(A) }, body: JSON.stringify({ prompt: 'go', conversationId: cid, stream: true, memoryPolicy: { mode: 'session', store: true, retrieve: false } }) });
  await res.text(); // drain to completion
  assert.equal(store.getMessages(cid, A).filter((m) => m.role === 'assistant').length, 1, 'completed stream commits once');

  // Cancelled mid-stream → NO assistant committed (user only).
  const cid2 = await mk('session');
  const ctl = new AbortController();
  const p = fetch(`${base}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...H(A) }, body: JSON.stringify({ prompt: 'go', conversationId: cid2, stream: true, memoryPolicy: { mode: 'session', store: true, retrieve: false } }), signal: ctl.signal });
  const r = await p;
  const reader = r.body!.getReader();
  await reader.read(); // first chunk (route/token)
  ctl.abort();
  await reader.cancel().catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(store.getMessages(cid2, A).filter((m) => m.role === 'assistant').length, 0, 'cancelled stream commits no assistant');
  assert.equal(store.getMessages(cid2, A).filter((m) => m.role === 'user').length, 1, 'user message present, not corrupted');
  await app.close();
});
