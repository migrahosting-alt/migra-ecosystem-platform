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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ConversationStore, PersistenceUnavailableError, type MemoryMode, type MessageRole, type Scope } from './conversationStore.js';
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

/**
 * A durable write the store refused, as a structured 503.
 *
 * The caller asked for data that outlives the process and did not get it. That
 * is reported, never softened into a success with `durable: false` — a client
 * told "stored" has no reason to retry, warn anyone, or stop.
 */
function persistenceRefusal(error: unknown, reply: FastifyReply): { ok: false; code: string; error: string } | undefined {
  if (!(error instanceof PersistenceUnavailableError)) return undefined;
  reply.code(503);
  return {
    ok: false,
    code: error.code,
    error: 'Durable storage is unavailable, so this was not saved. Nothing was stored.',
  };
}

export function registerMemoryRoutes(app: FastifyInstance, store: ConversationStore): ConversationStore {
  /*
   * HYDRATE THE REQUEST'S SCOPE BEFORE ANY HANDLER READS.
   *
   * The store is an in-memory cache over durable storage. It used to be filled
   * once at startup by reading every conversation in the database, which is
   * invalid under row-level security — an undeclared connection sees nothing, so
   * that load would have produced an empty Brain that looked healthy.
   *
   * One preHandler instead of a call in each handler: a route added later is
   * covered automatically, whereas a forgotten per-handler call would surface as
   * "my conversations disappeared" rather than as an error.
   */
  app.addHook('preHandler', async (request) => {
    await store.ensureScopeHydrated(scopeFrom(request));
  });

  app.post<{ Body: { title?: string; memoryMode?: string } }>('/api/ai/conversations', async (request, reply) => {
    const scope = scopeFrom(request);
    const mode = MODES.includes(request.body?.memoryMode as MemoryMode) ? (request.body!.memoryMode as MemoryMode) : 'session';
    try {
      const conv = await store.createConversation(scope, { title: request.body?.title, memoryMode: mode });
      reply.code(201);
      return conv;
    } catch (error) {
      const refusal = persistenceRefusal(error, reply);
      if (refusal) return refusal;
      throw error;
    }
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
    const conv = await store.renameConversation(request.params.id, scopeFrom(request), title);
    if (!conv) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
    }
    return conv;
  });

  /**
   * Replace the conversation's grounding set.
   *
   * PUT, not POST: the whole set is sent, so a retry or a race cannot leave the
   * thread grounded in something nobody chose, and "what is this grounded in" has
   * one answer at any moment. An empty array is a legitimate body — it means the
   * user detached everything, which is different from never having attached.
   */
  app.put<{ Params: { id: string }; Body: { files?: unknown } }>(
    '/api/ai/conversations/:id/grounding',
    async (request, reply) => {
      const files = request.body?.files;
      if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) {
        reply.code(400);
        return { ok: false, code: 'INVALID_INPUT', error: 'A `files` array of filenames is required.' };
      }
      const conv = await store.setGroundingFiles(request.params.id, scopeFrom(request), files as string[]);
      if (!conv) {
        reply.code(404);
        return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
      }
      return conv;
    },
  );

  /**
   * Replace the conversation's image set. PUT for the same reason grounding is:
   * the whole set is sent, so a retry cannot leave the thread about a picture
   * nobody chose.
   */
  app.put<{ Params: { id: string }; Body: { images?: unknown } }>(
    '/api/ai/conversations/:id/images',
    async (request, reply) => {
      const images = request.body?.images;
      if (!Array.isArray(images) || images.some((r) => typeof r !== 'string')) {
        reply.code(400);
        return { ok: false, code: 'INVALID_INPUT', error: 'An `images` array of image refs is required.' };
      }
      const conv = await store.setImageRefs(request.params.id, scopeFrom(request), images as string[]);
      if (!conv) {
        reply.code(404);
        return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
      }
      return conv;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/ai/conversations/:id', async (request, reply) => {
    const ok = await store.deleteConversation(request.params.id, scopeFrom(request));
    if (!ok) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_CONVERSATION', error: 'Conversation not found.' };
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { role?: string; content?: string; status?: string; imageRefs?: unknown; fileRefs?: unknown } }>(
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
      try {
        /*
         * THE IMAGES THIS TURN CARRIED, recorded on the message itself.
         *
         * This route is how the CONSUMER stores a user turn, and it is the path
         * production actually takes — the engine's own in-turn append never runs
         * for a streamed turn, because that request carries no conversationId.
         * Without this the picture was written to the conversation's active set
         * and nowhere else, so a reload rebuilt the thread with the image in the
         * composer and gone from the message that asked about it.
         */
        const refs = Array.isArray(request.body?.imageRefs)
          ? (request.body.imageRefs as unknown[]).filter(
              (r): r is string => typeof r === 'string' && /^img_[0-9a-f]{32}$/.test(r),
            )
          : [];
        /*
         * THE DOCUMENTS THIS TURN CARRIED, on the message for the same reason.
         *
         * A file grounded an answer and left no trace on the turn that attached
         * it, so the transcript could only be derived from the conversation's
         * ACTIVE set — and detaching a file would have erased it from the
         * message that asked. A name, not a path: anything with a separator did
         * not come from a file library.
         */
        const files = Array.isArray(request.body?.fileRefs)
          ? (request.body.fileRefs as unknown[]).filter(
              (f): f is string => typeof f === 'string' && f.trim().length > 0 && !/[\\/]/.test(f),
            )
          : [];
        const msg = await store.appendMessage(request.params.id, scope, {
          role: role as MessageRole, content: clean, status,
          ...(refs.length > 0 ? { imageRefs: refs } : {}),
          ...(files.length > 0 ? { fileRefs: files } : {}),
        });
        // `off` conversations retain nothing → null; report that honestly.
        return { ok: true, stored: msg !== null, message: msg };
      } catch (error) {
        // THE CANARY FINDING. This used to answer ok:true/stored:true/durable:true
        // with the database unreadable, and the message was gone after a restart.
        const refusal = persistenceRefusal(error, reply);
        if (refusal) return refusal;
        throw error;
      }
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
    const result = await summarizeConversation(store, scope, request.params.id, { force: request.body?.force });
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
