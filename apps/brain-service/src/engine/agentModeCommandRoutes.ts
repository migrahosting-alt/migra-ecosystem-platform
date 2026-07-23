import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AgentModeBootstrapRequestSchema, AgentModeDecisionSchema, AgentModeDisplaySchema, AgentModeReproposalRequestSchema, type AgentModeCommandRunView, type AgentModeRunRecoveryStatus } from '@migrapilot/protocol';
import type { ToolExecDeps } from './toolExecutor.js';
import { engineCorrelationId } from './toolRoutes.js';
import { AgentActivationAuthority, AgentActivationError, AGENT_CAPABILITY_HEADER } from './agentActivation.js';
import { AgentModeCommandService, type AgentModeActionResult, type AgentModeRequestContext } from './agentModeCommandService.js';

export function registerAgentModeCommandRoutes(
  app: FastifyInstance,
  toolDeps: ToolExecDeps,
  authority: AgentActivationAuthority,
  service = new AgentModeCommandService(toolDeps),
): AgentModeCommandService {
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
    return send(reply, await service.propose(request.body, context));
  });
  app.get<{ Params: { runId: string } }>('/api/ai/agent-mode/commands/:runId', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    return send(reply, service.get(request.params.runId, context));
  });
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/ai/agent-mode/commands/:runId/displayed', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const parsed = AgentModeDisplaySchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid authoritative preview fingerprint is required.');
    return send(reply, service.displayed(request.params.runId, parsed.data.fingerprint, context));
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
    return send(reply, service.cancel(request.params.runId, context));
  });
  app.get<{ Params: { runId: string } }>('/api/ai/agent-mode/commands/:runId/recovery', async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    return sendRecovery(reply, service.getRunRecoveryStatus(request.params.runId, context));
  });
  app.post<{ Params: { runId: string }; Body: unknown }>('/api/ai/agent-mode/commands/:runId/repropose', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const context = await requestContext(request, authority);
    if (!context) return forbidden(reply);
    const parsed = AgentModeReproposalRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'INVALID_INPUT', 'A valid recovery request id is required.');
    return send(reply, await service.reproposeFromRun(request.params.runId, parsed.data, context));
  });
  return service;
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

function sendRecovery(reply: FastifyReply, result: ReturnType<AgentModeCommandService['getRunRecoveryStatus']>): AgentModeRunRecoveryStatus | { ok: false; code: string; error: string } {
  if (result.ok) return result.status;
  const status = result.code === 'UNKNOWN_RUN' ? 404 : result.code === 'INVALID_CONTEXT' ? 403 : 409;
  reply.code(status);
  return { ok: false, code: result.code, error: result.message };
}
