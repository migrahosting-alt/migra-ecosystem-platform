/**
 * MigraAI Engine — capability execution facade (`/api/ai/tools`).
 *
 * The single execution boundary every client shares. Clients submit a tool
 * request; the ENGINE validates input, checks availability, dispatches, and (for
 * mutating tools) enforces the approval lifecycle. Clients never touch `file.*` /
 * `git.*` / `edit.*` directly and never learn implementation details.
 *
 *   GET  /api/ai/tools        → catalog (sanitized metadata; filterable)
 *   GET  /api/ai/tools/:id     → one capability's metadata
 *   POST /api/ai/tools         → execute { tool, input, dryRun?, approvalId? }
 *
 * Execution rules:
 *  - unknown tool                → 404 UNKNOWN_TOOL
 *  - unavailable (grant absent)  → 403 CAPABILITY_DENIED
 *  - bad input                   → 400 INVALID_INPUT (+ issues)
 *  - read-only                   → execute immediately → { status: 'ok', result }
 *  - mutating + dryRun           → preview only, no mutation → { status: 'dry_run' }
 *  - mutating, no approvalId      → preview + mint single-use token
 *                                   → { status: 'approval_required', approvalId }
 *  - mutating + approvalId        → consume (bound + single-use) → execute
 *                                   → { status: 'executed', result }
 *  - replay / bad token          → 409 INVALID_STATE
 *  - handler throws              → 502 TOOL_FAILED (sanitized; logged server-side)
 *
 * Correlation: the inbound `X-Request-Id` is honored (or minted) and echoed on
 * every response and audit event. Provider/handler error bodies never reach the
 * client.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { CapabilityRegistry } from './capabilityRegistry.js';
import { ToolApprovalStore } from './toolApprovalStore.js';
import { ToolAudit } from './toolAudit.js';
import { executeToolCore } from './toolExecutor.js';

export interface ToolRoutesDeps {
  registry?: CapabilityRegistry;
  approvals?: ToolApprovalStore;
  audit?: ToolAudit;
}

interface ExecuteBody {
  tool?: string;
  input?: unknown;
  dryRun?: boolean;
  approvalId?: string;
}

export function registerToolExecutionRoutes(app: FastifyInstance, deps: ToolRoutesDeps = {}): {
  registry: CapabilityRegistry;
  approvals: ToolApprovalStore;
  audit: ToolAudit;
} {
  const registry = deps.registry ?? new CapabilityRegistry();
  const approvals = deps.approvals ?? new ToolApprovalStore();
  const audit = deps.audit ?? new ToolAudit();

  app.get('/api/ai/tools', async (request) => {
    const q = request.query as { category?: string; readOnly?: string; includeUnavailable?: string };
    const tools = registry.list({
      category: q.category,
      readOnly: q.readOnly === undefined ? undefined : q.readOnly === 'true',
      includeUnavailable: q.includeUnavailable === 'true',
    });
    return { count: tools.length, tools };
  });

  app.get<{ Params: { id: string } }>('/api/ai/tools/:id', async (request, reply) => {
    const cap = registry.get(request.params.id);
    if (!cap) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_TOOL', error: `Unknown capability: ${request.params.id}` };
    }
    return cap;
  });

  app.post<{ Body: ExecuteBody }>('/api/ai/tools', async (request, reply) => {
    const requestId = correlationId(request);
    const body = request.body ?? {};
    const outcome = await executeToolCore({ registry, approvals, audit }, {
      tool: body.tool,
      input: body.input,
      dryRun: body.dryRun,
      approvalId: body.approvalId,
      requestId,
    });
    if (outcome.ok) {
      const { httpStatus: _s, ok: _o, ...payload } = outcome;
      return payload;
    }
    if (outcome.code === 'TOOL_FAILED') {
      request.log.warn({ tool: outcome.tool }, 'ai/tools handler failed');
    }
    reply.code(outcome.httpStatus);
    const { httpStatus: _s, ok: _o, ...payload } = outcome;
    return payload;
  });

  app.get('/api/ai/audit', async (request) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
    return { events: audit.recent(limit) };
  });

  return { registry, approvals, audit };
}

function correlationId(request: FastifyRequest): string {
  const header = request.headers['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.length > 0 ? value : randomUUID();
}

/** Shared correlation-id extractor for engine routes. */
export { correlationId as engineCorrelationId };
