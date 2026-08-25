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
import { telemetryHub } from './telemetryHub.js';
import { makeStageLogger, jsonLineSink } from './correlation.js';

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
  // Instrument the approval store via the shared telemetry hub (mint/consume/
  // expiry/eviction events, health snapshot).
  const approvals = deps.approvals ?? new ToolApprovalStore(undefined, undefined, undefined, telemetryHub.sink);
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
    if (body.tool === 'command.run' || body.tool === 'agent.recipe') {
      reply.code(403);
      return { ok: false, code: 'CAPABILITY_DENIED', reason: 'CAPABILITY_DENIED', error: 'Command execution is available only through the scoped Agent Mode recipe boundary.' };
    }
    // Resume correlation (Slice 3): an operator apply carries the ORIGINAL
    // execution correlation id via header, plus this call's own requestId — so
    // the audit chain links the resumed application to the original execution
    // without pretending it happened in the original HTTP request.
    const inbound = String((request.headers['x-correlation-id'] as string | undefined) ?? '').trim();
    const stage = inbound ? makeStageLogger(inbound, jsonLineSink((line) => request.log.info(line))) : undefined;
    const outcome = await executeToolCore({ registry, approvals, audit }, {
      tool: body.tool,
      input: body.input,
      dryRun: body.dryRun,
      approvalId: body.approvalId,
      requestId,
      stage,
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

/**
 * A BOUND on an inbound correlation id, deliberately not a format.
 *
 * This value lands in the DURABLE audit store and in every log line for the
 * request, and it arrives in a header — so an unchecked one writes arbitrary
 * text, at arbitrary length, into records this service is meant to be able to
 * trust. What is actually dangerous is the character set and the length, so
 * those are what this constrains.
 *
 * NO MINIMUM LENGTH. An earlier version required eight characters and broke a
 * caller using a short id, for no security gain: a short id is not a threat,
 * it is just short. The strict `req_<hex>` FORMAT check belongs in the consumer,
 * whose input is a browser; this service's callers are internal and legitimately
 * use several id shapes, including plain UUIDs.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function correlationId(request: FastifyRequest): string {
  const header = request.headers['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  // A malformed id is REPLACED, not trimmed into shape: a half-accepted
  // identifier still lets a caller choose part of what gets recorded.
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value) ? value : randomUUID();
}

/** Shared correlation-id extractor for engine routes. */
export { correlationId as engineCorrelationId };
