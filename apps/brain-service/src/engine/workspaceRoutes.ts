/**
 * MigraAI Engine — Workspace Manager facade (`/api/ai/workspaces`).
 *
 *   POST   /api/ai/workspaces            → open (register/reuse; idempotent per scope)
 *   GET    /api/ai/workspaces            → list (scoped)
 *   GET    /api/ai/workspaces/:id         → aggregated workspace view
 *   POST   /api/ai/workspaces/:id/sync    → sync the workspace index
 *   POST   /api/ai/workspaces/:id/rebuild → rebuild the index (→ experimental)
 *   POST   /api/ai/workspaces/:id/approve → approve the current index version for RAG
 *   PATCH  /api/ai/workspaces/:id          → update name / memory mode / prefs
 *   DELETE /api/ai/workspaces/:id          → delete workspace + its index
 *
 * Clients say "Open Workspace" / "Sync Workspace"; the engine owns index, memory,
 * agents, models, and health. Scope (owner + workspace) from headers, enforced.
 */

import type { FastifyInstance } from 'fastify';
import { WorkspaceManager } from './workspaceManager.js';
import { scopeFrom } from './memory/memoryRoutes.js';

export function registerWorkspaceRoutes(app: FastifyInstance, manager: WorkspaceManager): WorkspaceManager {
  app.post<{ Body: { name?: string; root?: string; memoryMode?: 'off' | 'session' | 'durable' } }>('/api/ai/workspaces', async (request, reply) => {
    const scope = scopeFrom(request);
    const root = request.body?.root ?? (scope.workspace !== 'default' ? scope.workspace : undefined);
    if (!root) {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: 'A workspace `root` (or X-Workspace-Scope path) is required.' };
    }
    const record = await manager.openWorkspace(scope, { name: request.body?.name, root, memoryMode: request.body?.memoryMode });
    return manager.view(record.id, scope);
  });

  app.get('/api/ai/workspaces', async (request) => {
    const scope = scopeFrom(request);
    return { workspaces: manager.list(scope).map((w) => ({ id: w.id, name: w.name, root: w.root, gitBranch: w.gitBranch, memoryMode: w.memoryMode, lastSyncAt: w.lastSyncAt })) };
  });

  app.get<{ Params: { id: string } }>('/api/ai/workspaces/:id', async (request, reply) => {
    const view = await manager.view(request.params.id, scopeFrom(request));
    if (!view) { reply.code(404); return { ok: false, code: 'UNKNOWN_WORKSPACE', error: 'Workspace not found.' }; }
    return view;
  });

  app.post<{ Params: { id: string } }>('/api/ai/workspaces/:id/sync', async (request, reply) => {
    const res = await manager.sync(request.params.id, scopeFrom(request));
    if (!res.ok) { reply.code(res.code === 'UNKNOWN_WORKSPACE' ? 404 : 502); return { ok: false, code: res.code, error: res.error }; }
    return res.view;
  });

  app.post<{ Params: { id: string } }>('/api/ai/workspaces/:id/rebuild', async (request, reply) => {
    const res = await manager.rebuild(request.params.id, scopeFrom(request));
    if (!res.ok) { reply.code(res.code === 'UNKNOWN_WORKSPACE' ? 404 : 502); return { ok: false, code: res.code, error: res.error }; }
    return res.view;
  });

  app.post<{ Params: { id: string }; Body: { indexVersion?: number } }>('/api/ai/workspaces/:id/approve', async (request, reply) => {
    const version = request.body?.indexVersion;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: 'An integer `indexVersion` (the version you observed) is required.' };
    }
    const res = await manager.approveIndex(request.params.id, scopeFrom(request), version);
    if (!res.ok) {
      reply.code(res.code === 'UNKNOWN_WORKSPACE' || res.code === 'NO_INDEX' ? 404 : res.code === 'STALE_VERSION' ? 409 : 400);
      return { ok: false, code: res.code, error: res.error };
    }
    return res.view;
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; memoryMode?: 'off' | 'session' | 'durable'; providerPreferences?: Record<string, string> } }>('/api/ai/workspaces/:id', async (request, reply) => {
    const w = manager.patch(request.params.id, scopeFrom(request), request.body ?? {});
    if (!w) { reply.code(404); return { ok: false, code: 'UNKNOWN_WORKSPACE', error: 'Workspace not found.' }; }
    return manager.view(w.id, scopeFrom(request));
  });

  app.delete<{ Params: { id: string } }>('/api/ai/workspaces/:id', async (request, reply) => {
    const ok = await manager.delete(request.params.id, scopeFrom(request));
    if (!ok) { reply.code(404); return { ok: false, code: 'UNKNOWN_WORKSPACE', error: 'Workspace not found.' }; }
    return { ok: true };
  });

  return manager;
}
