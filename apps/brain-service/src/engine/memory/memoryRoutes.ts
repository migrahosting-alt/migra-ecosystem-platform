/**
 * MigraAI Engine — conversation memory facade (`/api/ai/conversations`).
 *
 *   POST   /api/ai/conversations                       → create
 *   GET    /api/ai/conversations                       → list (scoped, additive)
 *   GET    /api/ai/conversations/:id                    → fetch
 *   POST   /api/ai/conversations/:id/messages           → append (redacted, immutable)
 *   GET    /api/ai/conversations/:id/messages           → list messages
 *   POST   /api/ai/conversations/:id/summarize          → summarize (idempotent)
 *   DELETE /api/ai/conversations/:id                    → delete (cascade)
 *   PATCH  /api/ai/conversations/:id                    → rename (additive)
 *
 * Scope (owner + workspace) comes from `X-Owner-Scope` / `X-Workspace-Scope`
 * headers and is enforced by the store — a conversation is invisible outside its
 * scope. Content is redacted before storage.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ConversationStore, type MemoryMode, type MessageRole, type Scope } from './conversationStore.js';
import { redactSecrets } from './redaction.js';
import { summarizeConversation } from './summarizer.js';

export function scopeFrom(request: FastifyRequest): Scope {
  const owner = headerValue(request, 'x-owner-scope') || 'local';
  const workspace = headerValue(request, 'x-workspace-scope') || 'default';
  return { owner, workspace };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const h = request.headers[name];
  return Array.isArray(h) ? h[0] : h;
}

const MODES: MemoryMode[] = ['off', 'session', 'durable'];

export function registerMemoryRoutes(app: FastifyInstance, store: ConversationStore): ConversationStore {
  app.post<{ Body: { title?: string; memoryMode?: string } }>('/api/ai/conversations', async (request, reply) => {
    const scope = scopeFrom(request);
    const mode = MODES.includes(request.body?.memoryMode as MemoryMode) ? (request.body!.memoryMode as MemoryMode) : 'session';
    const conv = store.createConversation(scope, { title: request.body?.title, memoryMode: mode });
    reply.code(201);
    return conv;
  });

  app.get('/api/ai/conversations', async (request) => {
    const scope = scopeFrom(request);
    return { conversations: store.listConversations(scope) };
  });

  app.get<{ Params: { id: string } }>('/api/ai/conversations/:id', async (request, reply) => {
    const conv = store.getConversation(request.params.id, scopeFrom(request));
    if (!conv) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
    }
    return conv;
  });

  app.patch<{ Params: { id: string }; Body: { title?: string } }>('/api/ai/conversations/:id', async (request, reply) => {
    const title = request.body?.title;
    if (!title) {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: 'A `title` is required.' };
    }
    const conv = store.renameConversation(request.params.id, scopeFrom(request), title);
    if (!conv) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
    }
    return conv;
  });

  app.delete<{ Params: { id: string } }>('/api/ai/conversations/:id', async (request, reply) => {
    const ok = store.deleteConversation(request.params.id, scopeFrom(request));
    if (!ok) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { role?: string; content?: string; status?: string } }>(
    '/api/ai/conversations/:id/messages',
    async (request, reply) => {
      const scope = scopeFrom(request);
      const role = request.body?.role;
      const content = request.body?.content;
      if ((role !== 'user' && role !== 'assistant' && role !== 'system') || typeof content !== 'string') {
        reply.code(400);
        return { ok: false, code: 'INVALID_INPUT', error: '`role` (user|assistant|system) and `content` are required.' };
      }
      if (!store.getConversation(request.params.id, scope)) {
        reply.code(404);
        return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
      }
      const clean = redactSecrets(content).text;
      const status = request.body?.status === 'partial' || request.body?.status === 'failed' ? request.body.status : 'complete';
      const msg = store.appendMessage(request.params.id, scope, { role: role as MessageRole, content: clean, status });
      // `off` conversations retain nothing → null; report that honestly.
      return { ok: true, stored: msg !== null, message: msg };
    },
  );

  app.get<{ Params: { id: string } }>('/api/ai/conversations/:id/messages', async (request, reply) => {
    const scope = scopeFrom(request);
    if (!store.getConversation(request.params.id, scope)) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
    }
    return { messages: store.getMessages(request.params.id, scope) };
  });

  app.post<{ Params: { id: string }; Body: { force?: boolean } }>('/api/ai/conversations/:id/summarize', async (request, reply) => {
    const scope = scopeFrom(request);
    const result = summarizeConversation(store, scope, request.params.id, { force: request.body?.force });
    if (!result.ok) {
      if (result.reason === 'unknown-conversation') {
        reply.code(404);
        return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
      }
      return { ok: false, reason: result.reason, summary: result.summary };
    }
    return { ok: true, summary: result.summary };
  });

  return store;
}
