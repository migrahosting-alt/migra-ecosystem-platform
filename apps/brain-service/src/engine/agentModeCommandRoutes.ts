import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AgentModeBootstrapRequestSchema,
  AgentModeDecisionSchema,
  AgentModeDisplaySchema,
  AgentModeReproposalRequestSchema,
  AgentModeRunHistoryExportRequestSchema,
  AgentModeRunHistoryQuerySchema,
  type AgentModeCommandRunView,
  type AgentModeRunHistoryDetail,
  type AgentModeRunHistoryExport,
  type AgentModeRunHistoryList,
  type AgentModeRunRecoveryStatus,
} from '@migrapilot/protocol';
import type { ToolExecDeps } from './toolExecutor.js';
import { engineCorrelationId } from './toolRoutes.js';
import { AgentActivationAuthority, AgentActivationError, AGENT_CAPABILITY_HEADER } from './agentActivation.js';
import { AgentModeCommandService, type AgentModeActionResult, type AgentModeRequestContext } from './agentModeCommandService.js';
import { AgentRunHistoryService, type AgentRunHistoryResult } from './agentRunHistory.js';

export function registerAgentModeCommandRoutes(
  app: FastifyInstance,
  toolDeps: ToolExecDeps,
  authority: AgentActivationAuthority,
  service = new AgentModeCommandService(toolDeps),
): AgentModeCommandService {
  const history = new AgentRunHistoryService(service.agentRunJournal(), async (run, context) => {
    const result = await service.getRunRecoveryStatus(run.runId, context);
    if (result.ok) return result.status;
    return {
      runId: run.runId,
      sourceState: run.state,
      approvalLifecycle: run.approvalLifecycle,
      recoveryClass: 'SCHEMA_INCOMPATIBLE',
      eligible: false,
      explanation: 'Recovery status could not be trusted from durable history.',
      currentRecipeAvailable: false,
      workspaceMatches: false,
      recommendedAction: 'Do not repropose from this history entry.',
      lineage: { sourceRunId: run.recoverySourceRunId, successorRunId: run.successorRunId },
    };
  });

  app.post<{ Body: unknown }>('/api/ai/agent-mode/bootstrap', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    if (!localNonBrowser(request)) return forbidden(reply);
    const parsed = AgentModeBootstrapRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid one-time Agent bootstrap request is required.');
    try {
      return await authority.bootstrap(parsed.data);
    } catch (error) {
      const code = error instanceof AgentActivationError ? error.code : 'BOOTSTRAP_INVALID';
      return invalid(reply, code, 'Agent bootstrap was refused.');
    }
  });

  app.post<{ Body: unknown }>('/api/ai/agent-mode/commands', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    return send(reply, await withClientDisconnect(reply, (signal) => service.propose(request.body, context, signal)));
  });
  app.get<{ Params: { runId: string } }>('/api/ai/agent-mode/commands/:runId', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    return send(reply, await service.get(request.params.runId, context));
  });
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/ai/agent-mode/commands/:runId/displayed', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const parsed = AgentModeDisplaySchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid authoritative preview fingerprint is required.');
    return send(reply, await service.displayed(request.params.runId, parsed.data.fingerprint, context));
  });
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/ai/agent-mode/commands/:runId/decision', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const parsed = AgentModeDecisionSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid decision and preview fingerprint are required.');
    return send(reply, await service.decide(request.params.runId, parsed.data.decision, parsed.data.fingerprint, context));
  });
  app.post<{ Params: { runId: string } }>('/api/ai/agent-mode/commands/:runId/cancel', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    return send(reply, await service.cancel(request.params.runId, context));
  });
  app.get<{ Params: { runId: string } }>('/api/ai/agent-mode/commands/:runId/recovery', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    return sendRecovery(reply, await service.getRunRecoveryStatus(request.params.runId, context));
  });
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/ai/agent-mode/commands/:runId/repropose', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const parsed = AgentModeReproposalRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid recovery request id is required.');
    return send(reply, await withClientDisconnect(reply, (signal) => service.reproposeFromRun(request.params.runId, parsed.data, context, signal)));
  });
  app.get<{ Querystring: Record<string, unknown> }>('/api/ai/agent-mode/history/runs', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const parsed = AgentModeRunHistoryQuerySchema.safeParse(parseHistoryQuery(request.query));
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid Agent run history query is required.');
    return sendHistory(reply, await history.list(parsed.data, context));
  });
  app.get<{ Params: { runId: string } }>('/api/ai/agent-mode/history/runs/:runId', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    return sendHistory(reply, await history.detail(request.params.runId, context));
  });
  app.get<{ Params: { runId: string } }>('/api/ai/agent-mode/history/runs/:runId/events', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const result = await history.detail(request.params.runId, context);
    return sendHistory(reply, result.ok ? { ok: true, value: { events: result.value.timeline, integrity: result.value.summary.integrity, integrityIssues: result.value.summary.integrityIssues } } : result);
  });
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/ai/agent-mode/history/runs/:runId/export', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const parsed = AgentModeRunHistoryExportRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid Agent run evidence export request is required.');
    return sendHistory(reply, await history.export(request.params.runId, parsed.data, context));
  });
  return service;
}

/** Aborts server-side proposal preparation when the client goes away.
 *
 * The extension enforces its own request timeout by aborting the HTTP request,
 * which closes the socket. Without this, snapshot planning would keep consuming
 * CPU and disk for a response nobody will read. */
async function withClientDisconnect<T>(reply: FastifyReply, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onClose = (): void => {
    // A close before the response is written means the client disconnected or
    // timed out, not a normally completed request.
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once('close', onClose);
  try {
    return await run(controller.signal);
  } finally {
    reply.raw.removeListener('close', onClose);
  }
}

async function requestContext(request: FastifyRequest, authority: AgentActivationAuthority): Promise<AgentModeRequestContext | undefined> {
  if (!localNonBrowser(request)) return undefined;
  const capability = one(request.headers[AGENT_CAPABILITY_HEADER]);
  const workspace = one(request.headers['x-migrapilot-workspace-root']);
  if (!capability || !workspace) return undefined;
  try {
    const activation = await authority.authorize(capability, workspace);
    return { ...activation, workspaceRoot: activation.canonicalWorkspace, externalRequestId: engineCorrelationId(request) };
  } catch {
    return undefined;
  }
}

function localNonBrowser(request: FastifyRequest): boolean {
  const ip = request.ip.replace(/^::ffff:/, '');
  return (ip === '127.0.0.1' || ip === '::1') && request.headers.origin === undefined;
}

function one(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' && text.length <= 1024 ? text.trim() : undefined;
}

function forbidden(reply: FastifyReply): { ok: false; code: string; error: string } {
  reply.code(403);
  return { ok: false, code: 'INVALID_CONTEXT', error: 'Agent authorization was refused.' };
}

function invalid(reply: FastifyReply, code: string, error: string): { ok: false; code: string; error: string } {
  reply.code(400);
  return { ok: false, code, error };
}

function send(reply: FastifyReply, result: AgentModeActionResult): AgentModeCommandRunView | { ok: false; code: string; error: string } {
  if (result.ok) return result.view;
  const status = result.code === 'UNKNOWN_RUN' ? 404 : result.code === 'INVALID_CONTEXT' ? 403 : result.code === 'OVERLOADED' ? 429 : result.code === 'PROPOSAL_FAILED' ? 400 : result.code === 'UNSUPPORTED_PLATFORM' || result.code === 'CONTAINMENT_UNAVAILABLE' ? 503 : 409;
  reply.code(status);
  return { ok: false, code: result.code, error: result.message };
}

function sendRecovery(reply: FastifyReply, result: Awaited<ReturnType<AgentModeCommandService['getRunRecoveryStatus']>>): AgentModeRunRecoveryStatus | { ok: false; code: string; error: string } {
  if (result.ok) return result.status;
  const status = result.code === 'UNKNOWN_RUN' ? 404 : result.code === 'INVALID_CONTEXT' ? 403 : 409;
  reply.code(status);
  return { ok: false, code: result.code, error: result.message };
}

function sendHistory<T extends AgentModeRunHistoryList | AgentModeRunHistoryDetail | AgentModeRunHistoryExport | Record<string, unknown>>(
  reply: FastifyReply,
  result: AgentRunHistoryResult<T>,
): T | { ok: false; code: string; error: string } {
  if (result.ok) return result.value;
  const status = result.code === 'UNKNOWN_RUN' ? 404 : result.code === 'INVALID_CONTEXT' ? 403 : 400;
  reply.code(status);
  return { ok: false, code: result.code, error: result.message };
}

function parseHistoryQuery(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    state: stringValue(raw.state),
    recipe: stringValue(raw.recipe),
    recoveryClass: stringValue(raw.recoveryClass),
    recoveryEligible: boolValue(raw.recoveryEligible),
    from: intValue(raw.from),
    to: intValue(raw.to),
    q: stringValue(raw.q),
    sort: stringValue(raw.sort) ?? 'updatedAt.desc',
    limit: intValue(raw.limit) ?? 25,
    cursor: stringValue(raw.cursor),
  };
}

function stringValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function intValue(value: unknown): number | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  const raw = stringValue(value);
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}
