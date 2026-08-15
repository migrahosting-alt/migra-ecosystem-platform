/**
 * MigraAI Engine — HTTP for governed coding runs.
 *
 * Deliberately thin. These handlers validate transport shape, call the service,
 * and map an outcome to a status code. They hold no workflow logic: there is no
 * path here that can advance a phase, consume an approval, or write to the
 * journal, so a route can never become a second place where a run changes state.
 *
 * Two mappings carry real meaning.
 *
 *  `202 Accepted` on start, never `200`. Planning continues after the response
 *  returns, so `200 OK` would assert a completion that has not happened.
 *
 *  `409` with a MACHINE-READABLE reason. A stale revision, a changed scope hash
 *  and an expired approval require three different reactions from a UI — retry,
 *  re-read the plan, re-plan entirely. Collapsing them into one error would leave
 *  the client guessing, and the guess an operator's UI makes about write authority
 *  is not a good place for ambiguity.
 *
 * `400` is reserved for malformed transport input. A well-formed request that
 * loses a race is a conflict, not a bad request. © MigraTeck LLC.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CodingRunService, CodingServiceResult } from './codingRunService.js';

interface StartBody {
  issueText?: unknown;
  workspaceRoot?: unknown;
  expectedRepository?: { headSha?: unknown; dirtyFingerprint?: unknown };
}
interface ScopeDecisionBody {
  expectedRevision?: unknown;
  pathSetHash?: unknown;
  decision?: unknown;
}
interface CancelBody {
  expectedRevision?: unknown;
}

export interface CodingRunRouteOptions {
  service: CodingRunService;
}

/** Map a service outcome onto HTTP. The single place status codes are decided. */
function send<T>(reply: FastifyReply, result: CodingServiceResult<T>, okCode: 200 | 202): T | undefined {
  if (result.ok) {
    reply.code(okCode);
    return result.value;
  }
  switch (result.kind) {
    case 'not_found':
      reply.code(404);
      return { error: 'coding_run_not_found' } as never;
    case 'conflict':
      reply.code(409);
      return result.body as never;
    case 'invalid':
      reply.code(400);
      return { error: 'invalid_request', message: result.message } as never;
    case 'forbidden':
      reply.code(403);
      return { error: 'workspace_not_permitted', message: result.message } as never;
    case 'unreadable':
      // 422, NOT 404. The record exists; it cannot be safely interpreted, and an
      // operator needs to know the difference.
      reply.code(422);
      return result.body as never;
  }
}

/** A revision must be a real integer. `"3"`, `3.5` and `NaN` are transport bugs. */
function revisionOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function registerCodingRunRoutes(app: FastifyInstance, opts: CodingRunRouteOptions): void {
  const { service } = opts;

  // ── start ──────────────────────────────────────────────────────────────────
  app.post('/api/ai/coding/runs', async (request: FastifyRequest<{ Body: StartBody }>, reply: FastifyReply) => {
    const body = request.body ?? {};
    if (typeof body.issueText !== 'string' || !body.issueText.trim()) {
      reply.code(400);
      return { error: 'invalid_request', message: 'issueText must be a non-empty string.' };
    }
    if (typeof body.workspaceRoot !== 'string' || !body.workspaceRoot.trim()) {
      reply.code(400);
      return { error: 'invalid_request', message: 'workspaceRoot must be a non-empty string.' };
    }
    // Everything else a caller might send — scope hash, child ids, execution or
    // approval state, validation commands, model-selected paths — is server-owned
    // and is simply not read here, so it cannot be injected.
    const expectedRepository = body.expectedRepository && typeof body.expectedRepository === 'object'
      ? {
          ...(typeof body.expectedRepository.headSha === 'string' ? { headSha: body.expectedRepository.headSha } : {}),
          ...(typeof body.expectedRepository.dirtyFingerprint === 'string' ? { dirtyFingerprint: body.expectedRepository.dirtyFingerprint } : {}),
        }
      : undefined;

    const result = await service.start({
      issueText: body.issueText,
      workspaceRoot: body.workspaceRoot,
      ...(expectedRepository ? { expectedRepository } : {}),
    });
    return send(reply, result, 202);
  });

  // ── read ───────────────────────────────────────────────────────────────────
  app.get('/api/ai/coding/runs/:runId', async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
    return send(reply, await service.read(request.params.runId), 200);
  });

  // ── scope decision ─────────────────────────────────────────────────────────
  app.post('/api/ai/coding/runs/:runId/scope-decision', async (request: FastifyRequest<{ Params: { runId: string }; Body: ScopeDecisionBody }>, reply: FastifyReply) => {
    const body = request.body ?? {};
    const expectedRevision = revisionOf(body.expectedRevision);
    if (expectedRevision === undefined) {
      reply.code(400);
      return { error: 'invalid_request', message: 'expectedRevision must be a non-negative integer.' };
    }
    if (typeof body.pathSetHash !== 'string' || !body.pathSetHash.trim()) {
      reply.code(400);
      return { error: 'invalid_request', message: 'pathSetHash is required.' };
    }
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      reply.code(400);
      return { error: 'invalid_request', message: "decision must be 'approve' or 'reject'." };
    }
    const result = await service.scopeDecision(request.params.runId, {
      expectedRevision,
      pathSetHash: body.pathSetHash,
      decision: body.decision,
    });
    return send(reply, result, 200);
  });

  // ── cancel ─────────────────────────────────────────────────────────────────
  app.post('/api/ai/coding/runs/:runId/cancel', async (request: FastifyRequest<{ Params: { runId: string }; Body: CancelBody }>, reply: FastifyReply) => {
    const expectedRevision = revisionOf((request.body ?? {}).expectedRevision);
    if (expectedRevision === undefined) {
      reply.code(400);
      return { error: 'invalid_request', message: 'expectedRevision must be a non-negative integer.' };
    }
    const result = await service.cancel(request.params.runId, { expectedRevision });
    return send(reply, result, 200);
  });
}
