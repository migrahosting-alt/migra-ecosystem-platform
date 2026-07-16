/**
 * MigraAI Engine — agent orchestration facade (`/api/ai/agents`).
 *
 *   GET  /api/ai/agents                     → agent catalog (sanitized metadata)
 *   GET  /api/ai/agents/:id                  → one agent's metadata
 *   POST /api/ai/agents/runs                 → create + start a run
 *   GET  /api/ai/agents/runs/:runId          → run status (JSON, or SSE observe)
 *   POST /api/ai/agents/runs/:runId/resume    → approve | reject a pending action
 *   POST /api/ai/agents/runs/:runId/cancel    → request run cancellation
 *
 * The engine owns this contract; clients never call pilot-api agent endpoints
 * directly. Responses are sanitized (no prompts/CoT/secrets/approval material/raw
 * tool inputs). Correlation via `X-Request-Id`; idempotent create via
 * `Idempotency-Key`. Observing over SSE and disconnecting NEVER cancels the run.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AgentRegistry } from './agentRegistry.js';
import { AgentRunStore } from './agentRunStore.js';
import { AgentService, toRunView } from './agentRuntime.js';
import type { ToolExecDeps } from './toolExecutor.js';
import { engineCorrelationId } from './toolRoutes.js';

export interface AgentRoutesDeps {
  toolDeps: ToolExecDeps;
  registry?: AgentRegistry;
  store?: AgentRunStore;
  service?: AgentService;
}

interface CreateBody {
  agentId?: string;
  input?: unknown;
}
interface ResumeBody {
  decision?: 'approve' | 'reject';
}

export function registerAgentRoutes(app: FastifyInstance, deps: AgentRoutesDeps): AgentService {
  const registry = deps.registry ?? new AgentRegistry();
  const store = deps.store ?? new AgentRunStore();
  const service = deps.service ?? new AgentService(registry, store, deps.toolDeps);

  app.get('/api/ai/agents', async (request) => {
    const q = request.query as { operationClass?: string; readOnly?: string };
    const agents = registry.list({
      operationClass: q.operationClass,
      readOnly: q.readOnly === undefined ? undefined : q.readOnly === 'true',
    });
    return { count: agents.length, agents };
  });

  app.get<{ Params: { id: string } }>('/api/ai/agents/:id', async (request, reply) => {
    const agent = registry.get(request.params.id);
    if (!agent) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_AGENT', error: `Unknown agent: ${request.params.id}` };
    }
    return agent;
  });

  app.post<{ Body: CreateBody }>('/api/ai/agents/runs', async (request, reply) => {
    const requestId = engineCorrelationId(request);
    const idempotencyKey = headerValue(request, 'idempotency-key');
    const body = request.body ?? {};
    if (!body.agentId) {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: 'An `agentId` is required.', requestId };
    }
    const created = await service.createRun({ agentId: body.agentId, input: body.input, requestId, idempotencyKey });
    if (!created.ok) {
      reply.code(created.httpStatus);
      return { ok: false, code: created.code, error: created.error, issues: created.issues, requestId };
    }
    return toRunView(created.run);
  });

  app.get<{ Params: { runId: string } }>('/api/ai/agents/runs/:runId', async (request, reply) => {
    const rec = service.getRun(request.params.runId);
    if (!rec) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_RUN', error: `Unknown run: ${request.params.runId}` };
    }
    // SSE observe: emit the current (reconciled) state, then close. Disconnecting
    // does NOT cancel the run — observation is decoupled from execution.
    const accept = headerValue(request, 'accept') ?? '';
    if (accept.includes('text/event-stream')) {
      observeSse(reply, JSON.stringify(toRunView(rec)));
      return reply;
    }
    return toRunView(rec);
  });

  app.post<{ Params: { runId: string }; Body: ResumeBody }>('/api/ai/agents/runs/:runId/resume', async (request, reply) => {
    const decision = request.body?.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: '`decision` must be "approve" or "reject".' };
    }
    const res = await service.resumeRun(request.params.runId, decision);
    if (!res.ok) {
      reply.code(res.httpStatus);
      return { ok: false, code: res.code, error: res.error };
    }
    return toRunView(res.run);
  });

  app.post<{ Params: { runId: string } }>('/api/ai/agents/runs/:runId/cancel', async (request, reply) => {
    const res = await service.cancelRun(request.params.runId);
    if (!res.ok) {
      reply.code(res.httpStatus);
      return { ok: false, code: res.code, error: res.error };
    }
    return toRunView(res.run);
  });

  return service;
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const h = request.headers[name];
  return Array.isArray(h) ? h[0] : h;
}

function observeSse(reply: FastifyReply, stateJson: string): void {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  try {
    raw.write(`event: state\ndata: ${stateJson}\n\n`);
    raw.write(`event: done\ndata: {}\n\n`);
  } catch {
    /* client already gone */
  }
  raw.end();
}
