/**
 * MigraAI Engine — semantic RAG facade (`/api/ai/indexes`, `/api/ai/retrieve`).
 *
 *   POST   /api/ai/indexes                 → create an index (workspace|docs)
 *   POST   /api/ai/indexes/:id/sync         → (incremental, atomic) index
 *   GET    /api/ai/indexes/:id/status       → status + stats
 *   PATCH  /api/ai/indexes/:id              → set state (promotion: approve/disable)
 *   GET    /api/ai/indexes                  → list (scoped)
 *   DELETE /api/ai/indexes/:id              → delete
 *   POST   /api/ai/retrieve                 → bounded, cited semantic retrieval
 *
 * Scope (owner + workspace) comes from headers and is enforced by the service —
 * workspace A can never see or retrieve workspace B's index. Retrieval returns
 * bounded chunks with file + line-range citations and a per-chunk "why" breakdown.
 */

import type { FastifyInstance } from 'fastify';
import { IndexService, type IndexState, type Scope } from './indexService.js';
import { scopeFrom } from '../memory/memoryRoutes.js';
import { citation } from './hybridRetriever.js';

const STATES: IndexState[] = ['experimental', 'evaluated', 'approved', 'degraded', 'disabled'];

export function registerRagRoutes(app: FastifyInstance, service: IndexService): IndexService {
  /*
   * Hydrate the caller's own indexes before any handler reads.
   *
   * This is the quiet one. An empty conversation list is obvious; an empty INDEX
   * is not — chat keeps answering and simply stops using the caller's documents,
   * which reads as a model regression rather than a persistence bug.
   */
  app.addHook('preHandler', async (request) => {
    await service.hydrate(scopeFrom(request));
  });

  app.post<{ Body: { sourceType?: 'workspace' | 'docs'; root?: string } }>('/api/ai/indexes', async (request, reply) => {
    const scope = scopeFrom(request);
    const root = request.body?.root ?? scope.workspace;
    if (!root || root === 'default') {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: 'A workspace `root` (or X-Workspace-Scope path) is required.' };
    }
    const record = service.createIndex(scope, { sourceType: request.body?.sourceType, root });
    reply.code(201);
    return record;
  });

  app.get('/api/ai/indexes', async (request) => {
    return { indexes: service.listForScope(scopeFrom(request)) };
  });

  app.post<{ Params: { id: string } }>('/api/ai/indexes/:id/sync', async (request, reply) => {
    const res = await service.sync(request.params.id, scopeFrom(request));
    if (!res.ok) {
      reply.code(res.code === 'UNKNOWN_INDEX' ? 404 : 502);
      return { ok: false, code: res.code, error: res.error };
    }
    return { ok: true, index: res.record };
  });

  app.get<{ Params: { id: string } }>('/api/ai/indexes/:id/status', async (request, reply) => {
    const rec = service.status(request.params.id, scopeFrom(request));
    if (!rec) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_INDEX', error: 'Index not found.' };
    }
    /*
     * `chunkCounts` is per FILE, from the approved index.
     *
     * A library-wide `searchable` flag cannot answer "can this file be read?", and the UI
     * was showing "Ready — MigraPilot can read this" for a whitespace-only upload that
     * produced zero chunks. A caller can now tell readiness per file instead of inferring
     * it from a library-wide boolean.
     */
    return {
      ...rec,
      status: rec.syncing ? 'indexing' : rec.state,
      chunkCounts: service.approvedChunkCounts(request.params.id, scopeFrom(request)),
    };
  });

  app.patch<{ Params: { id: string }; Body: { state?: string } }>('/api/ai/indexes/:id', async (request, reply) => {
    const state = request.body?.state as IndexState;
    if (!STATES.includes(state)) {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: `state must be one of ${STATES.join(', ')}` };
    }
    const rec = service.setState(request.params.id, scopeFrom(request), state);
    if (!rec) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_INDEX', error: 'Index not found.' };
    }
    return rec;
  });

  app.delete<{ Params: { id: string } }>('/api/ai/indexes/:id', async (request, reply) => {
    const ok = service.delete(request.params.id, scopeFrom(request));
    if (!ok) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_INDEX', error: 'Index not found.' };
    }
    return { ok: true };
  });

  app.post<{ Body: { query?: string; indexId?: string; maxChunks?: number; tokenBudget?: number; requireApproved?: boolean } }>(
    '/api/ai/retrieve',
    async (request, reply) => {
      const scope: Scope = scopeFrom(request);
      const body = request.body ?? {};
      if (!body.query || typeof body.query !== 'string') {
        reply.code(400);
        return { ok: false, code: 'INVALID_INPUT', error: 'A `query` is required.' };
      }
      /*
       * DETERMINISTIC AUTHORITY, NOT "the first array element".
       *
       * This used to fall back to `listForScope(scope)[0]`, so a scope holding
       * more than one index silently retrieved from an arbitrary one — whichever
       * happened to be first in a Map. During the candidate gate that selected
       * an empty index and reported zero chunks while an approved index with
       * content sat beside it.
       *
       * The order is now: what the caller named, else the scope's APPROVED index
       * (persisted state, not iteration order), else the only index if there is
       * exactly one. More than one candidate and no approved index is genuinely
       * ambiguous, and guessing would serve content nobody selected.
       */
      const inScope = service.listForScope(scope);
      const approved = service.approvedIndexFor(scope);
      const indexId = body.indexId ?? approved ?? (inScope.length === 1 ? inScope[0]!.id : undefined);
      if (!indexId) {
        reply.code(inScope.length > 1 ? 409 : 404);
        return inScope.length > 1
          ? {
              ok: false,
              code: 'AMBIGUOUS_INDEX',
              error: `This workspace has ${inScope.length} indexes and none is approved. Name one with \`indexId\`.`,
            }
          : { ok: false, code: 'NO_INDEX', error: 'No index exists for this workspace.' };
      }
      const res = await service.retrieve(indexId, scope, body.query, {
        maxChunks: body.maxChunks,
        tokenBudget: body.tokenBudget,
        requireApproved: body.requireApproved,
      });
      if (!res.ok) {
        reply.code(res.code === 'UNKNOWN_INDEX' ? 404 : res.code === 'NOT_APPROVED' ? 403 : 409);
        return { ok: false, code: res.code, error: res.error };
      }
      return {
        ok: true,
        indexState: res.indexState,
        chunks: res.chunks.map((c) => ({ ...c, citation: citation(c) })),
        diagnostics: res.diagnostics,
      };
    },
  );

  return service;
}
