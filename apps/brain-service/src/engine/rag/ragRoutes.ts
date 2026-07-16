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
    return { ...rec, status: rec.syncing ? 'indexing' : rec.state };
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
      const indexId = body.indexId ?? service.listForScope(scope)[0]?.id;
      if (!indexId) {
        reply.code(404);
        return { ok: false, code: 'NO_INDEX', error: 'No index exists for this workspace.' };
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
