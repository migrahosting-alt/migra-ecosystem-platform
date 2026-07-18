// Operational Readiness Slice 5 — operator API for read-only production diagnostics.
//
// A bounded, read-only surface. It exposes NO mutation endpoint, NO arbitrary
// target creation, and NO raw credential reference. Operator authentication is a
// SEPARATE token space from the workspace ToolApprovalStore — a workspace approval
// token can never authorize a production diagnostic.
//
//   GET  /api/ai/production-diagnostics/status
//   GET  /api/ai/production-diagnostics/targets
//   POST /api/ai/production-diagnostics/run     { targetId, capability, params? }
//   GET  /api/ai/production-diagnostics/runs/:id
//
// © MigraTeck LLC.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DiagnosticError, type DiagnosticFailureCode } from './types.js';
import type { ProductionDiagnosticsProvider } from './provider.js';

const HTTP_FOR_CODE: Record<DiagnosticFailureCode, number> = {
  PROVIDER_DISABLED: 403,
  UNAUTHORIZED: 401,
  TARGET_NOT_ALLOWED: 403,
  ENVIRONMENT_NOT_ALLOWED: 403,
  CAPABILITY_NOT_ALLOWED_FOR_TARGET: 403,
  READ_ONLY_CAPABILITY: 403,
  ARBITRARY_INPUT_REJECTED: 400,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  OUTPUT_CAPPED: 400,
  UNKNOWN_RUN: 404,
};

interface RunBody {
  targetId?: string;
  capability?: string;
  params?: Record<string, unknown>;
}

/** Resolve the authenticated operator principal from a bearer token. Returns ''
 * (→ UNAUTHORIZED at the provider) when the token is unknown. Never trusts a
 * caller-supplied principal header. */
function resolveOperator(request: FastifyRequest, tokens: Map<string, string>): string {
  const auth = String(request.headers['authorization'] ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return '';
  return tokens.get(m[1]!.trim()) ?? '';
}

function correlationId(request: FastifyRequest): string {
  return String((request.headers['x-correlation-id'] as string | undefined) ?? '').trim();
}

export function registerProductionDiagnosticsRoutes(
  app: FastifyInstance,
  provider: ProductionDiagnosticsProvider,
  operatorTokens: Map<string, string>,
): void {
  // Explicit provider status (labels the mode as read-only + disabled/enabled).
  app.get('/api/ai/production-diagnostics/status', async () => ({
    mode: 'Production Diagnostics — Read Only',
    ...provider.status(),
    capabilities: provider.registeredCapabilityIds(),
  }));

  // Registered targets as SAFE summaries (no credentials, no raw hosts/urls).
  app.get('/api/ai/production-diagnostics/targets', async () => ({
    mode: 'Production Diagnostics — Read Only',
    status: provider.status(),
    targets: provider.listTargets(),
  }));

  app.post<{ Body: RunBody }>('/api/ai/production-diagnostics/run', async (request, reply) => {
    const operator = resolveOperator(request, operatorTokens);
    const body = request.body ?? {};
    try {
      const { runId, correlationId: cid, result } = await provider.run({
        operator,
        targetId: String(body.targetId ?? ''),
        capability: String(body.capability ?? ''),
        params: body.params,
        correlationId: correlationId(request) || undefined,
      });
      return { ok: true, runId, correlationId: cid, result };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/ai/production-diagnostics/runs/:id', async (request, reply) => {
    const run = provider.getRun(request.params.id);
    if (!run) {
      reply.code(404);
      return { ok: false, code: 'UNKNOWN_RUN', error: 'unknown run id' };
    }
    return { ok: true, run };
  });
}

function fail(reply: FastifyReply, err: unknown): { ok: false; code: string; error: string } {
  if (err instanceof DiagnosticError) {
    reply.code(HTTP_FOR_CODE[err.code] ?? 400);
    return { ok: false, code: err.code, error: err.message };
  }
  reply.code(500);
  return { ok: false, code: 'ERROR', error: 'diagnostic failed' };
}
