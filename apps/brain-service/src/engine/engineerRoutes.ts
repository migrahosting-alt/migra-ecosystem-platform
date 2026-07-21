// POST /api/ai/engineer — SSE surface for the model-in-the-loop workspace
// engineer (Slice 2). Local-only: no pilot-api involvement anywhere on this
// path, so disabled remote delegation can never block ordinary local work.

import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { BrainEnv } from '../config/env.js';
import type { ModelRegistry, ModelDescriptor } from './modelRegistry.js';
import { selectModel, tierFromHints } from './capabilityRouter.js';
import { selectLocalCoding, type LocalRoutingDeps } from './providers/localCodingRouter.js';
import { retrieveContext } from '../retrieval/retrieve.js';
import { resolveEffectivePolicy } from './providers/executionPolicy.js';
import { assessCodingOutcome } from './providers/codingAssessment.js';
import type { EscalationController } from './providers/escalationController.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { StubProvider, type ProviderAdapter } from '../providers/providerRegistry.js';
import { OpenAiCompatProvider } from '../providers/openAiCompatProvider.js';
import { executeToolCore, type ToolExecDeps } from './toolExecutor.js';
import { newCorrelationId, makeStageLogger, jsonLineSink, type StageLogger } from './correlation.js';
import { runEngineerTask, type EngineerToolInfo } from './engineerRuntime.js';
import { changesetProposals } from './capabilityRegistry.js';
import { telemetryHub } from './telemetryHub.js';
import { auditStore, auditHash } from './auditLog.js';
import { incidentManager } from './incidents.js';
import { sanitizeError } from './redaction.js';
import { recoveryManager, RecoveryError } from './recovery.js';
import { nodeChangesetFs } from '../tools/changesetFs.js';

const EngineerBodySchema = z.object({
  rootPath: z.string().min(1),
  task: z.string().min(1),
  ecosystem: z.boolean().optional(),
  /** Prior turns (oldest first). The unified agent serves ordinary chat too, so
   * it carries the conversation the chat path used to hold. */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() }))
    .max(40)
    .optional(),
  tier: z.string().optional(),
  /** A model id pinned in the chat picker. Ordinary turns used to reach the chat
   * endpoint, which honors it; routing them to the agent silently dropped it. */
  model: z.string().optional(),
  /** Slice 5: a per-request execution-policy PREFERENCE (server resolves to an
   * effective policy; never bypasses local-first / consent / privacy / budget). */
  policy: z.string().optional(),
});

/** One-line input hints shown to the model per tool (kept beside the route so
 * the protocol prompt stays in sync with what this deployment exposes). */
const INPUT_HINTS: Record<string, string> = {
  'workspace.search': '{"rootPath","query"}',
  'file.readRange': '{"rootPath","path","startLine","endLine"}',
  'file.readSymbol': '{"rootPath","path","symbol"}',
  'git.status': '{"rootPath"}',
  'git.diff': '{"rootPath"}',
  'diagnostics.get': '{"rootPath","path"?}',
  'edit.preview': '{"rootPath","changes":[{"path","startLine","endLine","replacement"}]}',
  'fs.proposeChangeset': '{"rootPath","ops":[{"op":"create","path":"src/x.js","content":"..."}]} (op: create|replace|patch|delete|mkdir)',
  'command.run': '{"rootPath","command":["npm","test"],"cwd"?,"timeoutMs"?}',
};

/** Shallow-ish workspace file listing for command side-effect detection. Skips
 * heavy/noisy dirs; bounded so a big install cannot flood the diff. */
async function listWorkspaceFiles(root: string, limit = 5_000): Promise<string[]> {
  const skip = new Set(['.git', 'node_modules', '.next', 'dist', '.cache']);
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= limit || depth > 6) return;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (!skip.has(e.name)) await walk(path.join(dir, e.name), depth + 1);
      } else {
        out.push(path.relative(root, path.join(dir, e.name)));
      }
    }
  }
  await walk(root, 0);
  return out;
}

/** A provider adapter that can also stream token deltas (OpenAI-compatible
 * backends do; the stub does not). Feature-detected so non-streaming adapters
 * keep the buffered path. */
type StreamingProvider = ProviderAdapter & {
  stream(request: ChatTurnRequest, signal?: AbortSignal): AsyncGenerator<{ delta?: string }>;
};

export function registerEngineerRoutes(
  app: FastifyInstance,
  env: BrainEnv,
  modelRegistry: ModelRegistry,
  toolDeps: ToolExecDeps,
  providerOverride?: (model: ModelDescriptor) => ProviderAdapter,
  /** Slice 2: when provided, coding turns select the highest-ranked eligible
   * LOCAL model under the active policy (never invokes cloud). Absent → the prior
   * capability-router selection is used unchanged. */
  providerRouting?: LocalRoutingDeps,
  /** Slice 3: when provided, a local coding failure with a DEFINED reason may mint
   * a cloud-escalation OFFER (no cloud call here — approval is a separate request).
   * Requires providerRouting for the active policy. */
  escalation?: EscalationController,
): void {
  const real = env.localProvider === 'openai-compat';
  const providerFor = (model: ModelDescriptor): ProviderAdapter => {
    if (providerOverride) return providerOverride(model);
    if (!real) return new StubProvider('default');
    return new OpenAiCompatProvider({
      profile: 'default',
      baseUrl: env.providerBaseUrl,
      model: model.id,
      apiKey: env.openAiApiKey,
    });
  };

  /** The loop's tool surface: read-only capabilities + the two policy-gated
   * extras (edit.preview for proposals, command.run under its allowlist).
   * edit.apply is deliberately ABSENT — the loop never mutates. */
  const loopTools = (): EngineerToolInfo[] =>
    toolDeps.registry
      .list({ includeUnavailable: false })
      .filter((t) => t.kind === 'tool' && t.id !== 'edit.apply' && (t.readOnly || t.id === 'command.run'))
      .map((t) => ({
        id: t.id,
        description: t.description,
        readOnly: t.readOnly,
        inputHint: INPUT_HINTS[t.id] ?? '{"rootPath",...}',
      }));

  // Read-only store health/telemetry (Slice 2). Aggregate health + counters +
  // eviction stats + a small recent-events window — NO proposal bodies, approval
  // tokens, raw paths, or request data. Local, non-production.
  app.get('/api/ai/engineer/stores/health', async () => {
    const proposal = changesetProposals.health();
    const approval = toolDeps.approvals.health();
    const overall: 'healthy' | 'degraded' | 'unhealthy' =
      proposal.status === 'unhealthy' || approval.status === 'unhealthy'
        ? 'unhealthy'
        : proposal.status === 'degraded' || approval.status === 'degraded'
          ? 'degraded'
          : 'healthy';
    return {
      status: overall,
      stores: { proposal, approval },
      audit: auditStore.healthSnapshot(),
      incidents: incidentManager.health(),
      evictions: telemetryHub.evictionStats(),
      recent: telemetryHub.recentEvents(50).map((e) => ({ event: e.event, at: e.at, correlationId: e.correlationId, ...e.fields })),
    };
  });

  // Read-only durable audit chain for one correlation id (Slice 3). Records are
  // already redacted metadata; bounded + stable-ordered by per-correlation seq.
  app.get('/api/ai/engineer/audit', async (request, reply) => {
    const q = request.query as { correlationId?: string; limit?: string };
    if (!q.correlationId) {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: 'correlationId is required' };
    }
    const limit = Math.min(Number(q.limit ?? 500) || 500, 1000);
    return { correlationId: q.correlationId, records: auditStore.byCorrelation(q.correlationId, limit) };
  });

  // Read-only incident list + detail. Safe metadata only (no bodies/tokens/paths).
  app.get('/api/ai/engineer/incidents', async (request) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(Number(q.limit ?? 200) || 200, 500);
    return { incidents: incidentManager.list(limit), health: incidentManager.health() };
  });
  app.get<{ Params: { id: string } }>('/api/ai/engineer/incidents/:id', async (request, reply) => {
    const inc = incidentManager.get(request.params.id);
    if (!inc) {
      reply.code(404);
      return { ok: false, code: 'NOT_FOUND', error: 'unknown incident' };
    }
    return inc;
  });

  // ── Operator recovery tooling (Slice 4) — local, explicit, approval-gated ─────
  const recFs = nodeChangesetFs();
  const recFail = (reply: import('fastify').FastifyReply, err: unknown) => {
    reply.code(err instanceof RecoveryError ? 409 : 500);
    return { ok: false, code: err instanceof RecoveryError ? err.code : 'ERROR', error: sanitizeError(err).message };
  };
  // Plan a recovery for an incident (zero writes; mints a single-use token).
  app.post<{ Params: { id: string } }>('/api/ai/engineer/incidents/:id/recovery/plan', async (request, reply) => {
    const inc = incidentManager.get(request.params.id);
    if (!inc) {
      reply.code(404);
      return { ok: false, code: 'NOT_FOUND', error: 'unknown incident' };
    }
    try {
      return { ok: true, plan: recoveryManager.plan(inc.correlationId) };
    } catch (err) {
      return recFail(reply, err);
    }
  });
  app.post<{ Params: { id: string } }>('/api/ai/engineer/recovery/:id/simulate', async (request, reply) => {
    try {
      return { ok: true, simulation: recoveryManager.simulate(request.params.id, recFs) };
    } catch (err) {
      return recFail(reply, err);
    }
  });
  app.post<{ Params: { id: string }; Body: { approvalToken?: string } }>('/api/ai/engineer/recovery/:id/apply', async (request, reply) => {
    try {
      return { ok: true, applied: recoveryManager.apply(request.params.id, request.body?.approvalToken ?? '', recFs) };
    } catch (err) {
      return recFail(reply, err);
    }
  });
  app.post<{ Params: { id: string } }>('/api/ai/engineer/recovery/:id/verify', async (request, reply) => {
    try {
      return { ok: true, evidence: recoveryManager.verify(request.params.id, recFs) };
    } catch (err) {
      return recFail(reply, err);
    }
  });
  // Resolve requires passing validation evidence (verify is re-run server-side).
  app.post<{ Params: { id: string } }>('/api/ai/engineer/recovery/:id/resolve', async (request, reply) => {
    try {
      const evidence = recoveryManager.verify(request.params.id, recFs);
      recoveryManager.resolve(request.params.id, evidence);
      return { ok: true, resolved: true, evidence };
    } catch (err) {
      return recFail(reply, err);
    }
  });

  app.post('/api/ai/engineer', async (request, reply) => {
    const parsed = EngineerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        code: 'INVALID_INPUT',
        error: 'Engineer input failed schema validation.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    const body = parsed.data;

    // Correlation id for the WHOLE execution (accept a caller-supplied id via
    // header for cross-service tracing, else mint one). Emits one structured
    // line per stage: request → route → loop-step → tool/proposal → apply → …
    const headerId = String((request.headers['x-correlation-id'] as string | undefined) ?? '').trim();
    const correlationId = headerId || newCorrelationId();
    const stage: StageLogger = makeStageLogger(correlationId, jsonLineSink((line) => request.log.info(line)));
    stage.log('request', { rootPath: body.rootPath, ecosystem: Boolean(body.ecosystem) });
    auditStore.append({ correlationId, type: 'execution.started', component: 'engineer', requestId: headerId || undefined, fields: { workspace: auditHash(body.rootPath), ecosystem: Boolean(body.ecosystem) } });

    // Slice 2 — local-first coding routing. When provider routing is wired, the
    // engineer selects the highest-ranked eligible LOCAL model under the active
    // policy and NEVER invokes cloud; if the policy would prefer cloud (or no
    // local model qualifies) it records fallbackRecommended (advisory only).
    // The normalized coding request used to bind + re-run an escalation (Slice 3).
    const escRequest: ChatTurnRequest = { feature: 'chat', modelProfile: 'default', systemPromptId: 'engineer-v1', userPrompt: body.task, context: {}, outputMode: 'markdown' };
    let decision: { model: ModelDescriptor; reason: string };
    let routing: { policy?: string; requestedPolicy?: string; effectivePolicy?: string; policyReason?: string; fallbackRecommended: boolean; fallbackReasons: string[] } = { fallbackRecommended: false, fallbackReasons: [] };
    // Slice 5: resolve the per-request policy preference to an effective policy.
    const resolved = providerRouting ? resolveEffectivePolicy(body.policy, providerRouting.policy, { cloudUsable: await providerRouting.fleet.hasUsableCloud() }) : undefined;
    const effectiveRouting = providerRouting && resolved ? { ...providerRouting, policy: resolved.effective } : providerRouting;
    if (providerRouting && effectiveRouting && resolved) {
      const local = await selectLocalCoding(effectiveRouting, { preferCoding: true, needsTools: true, tier: tierFromHints({ tier: body.tier }), ...(body.model ? { model: body.model } : {}) });
      routing = { policy: resolved.effective, requestedPolicy: resolved.requested, effectivePolicy: resolved.effective, policyReason: resolved.reason, fallbackRecommended: local.fallbackRecommended, fallbackReasons: local.fallbackReasons };
      if (!local.localModel) {
        // No local model. Slice 3: a DEFINED reason (LOCAL_UNSUPPORTED_CAPABILITY)
        // may mint a cloud-escalation OFFER — but no cloud is called here (approval
        // is a separate request). Impossible under local-only / privacy.
        if (escalation) {
          const off = await escalation.offer({ correlationId, policy: resolved.effective, outcome: { hadLocalModel: false, terminal: 'failed', output: '' }, request: escRequest, requiredCaps: { coding: true } });
          if (off.offered) {
            stage.log('route', { escalationOffered: true, reason: off.reason });
            reply.code(200);
            return { ok: false, code: 'LOCAL_UNSUPPORTED_CAPABILITY', fallbackRecommended: true, escalationOffer: { offerId: off.offerId, token: off.token, reason: off.reason, target: off.target, estimatedCostUsd: off.estimate?.estimatedCostUsd, worstCaseCostUsd: off.worstCaseCostUsd, costCeilingUsd: off.costCeilingUsd, remainingBudgetUsd: off.remainingBudgetUsd, dataLeavesLocal: off.dataLeavesLocal, expiresAt: off.expiresAt, request: escRequest } };
          }
        }
        stage.log('error', { code: 'NO_LOCAL_MODEL' });
        reply.code(503);
        return { ok: false, code: 'NO_LOCAL_MODEL', error: 'No local model available for the engineer loop; cloud fallback is recommended but not enabled in this slice.', fallbackRecommended: true, fallbackReasons: local.fallbackReasons };
      }
      decision = { model: local.localModel, reason: `local-first (${local.policy})` };
    } else {
      const d = await selectModel(modelRegistry, { preferCoding: true, tier: tierFromHints({ tier: body.tier }), ...(body.model ? { model: body.model } : {}) });
      if (!d) {
        stage.log('error', { code: 'NO_MODEL' });
        reply.code(503);
        return { ok: false, code: 'NO_MODEL', error: 'No model available for the engineer loop.' };
      }
      decision = { model: d.model, reason: d.reason };
    }
    const provider = providerFor(decision.model);
    stage.log('route', { model: decision.model.id, provider: decision.model.provider, fallbackRecommended: routing.fallbackRecommended });
    auditStore.append({ correlationId, type: 'execution.routed', component: 'engineer', fields: { model: decision.model.id, provider: decision.model.provider, ...(routing.policy ? { policy: routing.policy, fallbackRecommended: routing.fallbackRecommended } : {}) } });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    request.raw.on('close', () => {
      closed = true;
    });
    const send = (event: string, data: unknown): void => {
      if (closed) return;
      try {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };

    // Surface the correlation id to the client so it can be quoted in support.
    send('route', { model: decision.model.id, provider: decision.model.provider, reason: decision.reason, correlationId, policy: routing.policy, requestedPolicy: routing.requestedPolicy, effectivePolicy: routing.effectivePolicy, policyReason: routing.policyReason, fallbackRecommended: routing.fallbackRecommended });

    // Seed the agent with the SAME tuned lexical grounding the chat path used
    // (definition-first ranking, filename bonus, copy-path penalty). Routing
    // ordinary turns to this loop replaced that with a naive keyword search,
    // which on a large monorepo found the wrong "lint" entirely. Bounded and
    // best-effort: retrieval must never slow down or fail a turn.
    const seededContext = await retrieveContext({
      query: body.task,
      workspaceRoot: body.rootPath,
      feature: 'chat',
      ...(body.history?.length ? { conversationContext: body.history.map((h) => h.text).join('\n') } : {}),
    })
      // Seed only DEFINITION-grade evidence. Scores encode this directly: a
      // definition scores >=0.85, a passing reference ~0.55. Seeding everything
      // fed VS Code language-extension configs into "what is a monad?", and the
      // model then answered that the excerpts did not cover monads instead of
      // just answering. No strong hit => seed nothing and let the agent decide.
      .then((r) => r.chunks.filter((c) => c.score >= 0.8))
      .then((cs) => cs.map((c) => ({ path: c.path, startLine: c.startLine, endLine: c.endLine, snippet: c.snippet })))
      .catch(() => [] as Array<{ path: string; startLine: number; endLine: number; snippet: string }>);
    stage.log('request', { seededChunks: seededContext.length });

    const events = runEngineerTask(
      {
        complete: async (prompt) => {
          const res = await provider.complete({
            feature: 'chat',
            modelProfile: 'default',
            systemPromptId: 'engineer-v1',
            userPrompt: prompt,
            outputMode: 'markdown',
            context: {},
          });
          return res.content;
        },
        // Stream when the resolved provider supports it, so the answer appears as
        // it is written instead of after the whole generation. Feature-detected:
        // the stub provider (and any adapter without `stream`) keeps the buffered
        // path, so tests and non-streaming backends are unaffected.
        ...(typeof (provider as Partial<StreamingProvider>).stream === 'function'
          ? {
              completeStream: async function* (prompt: string): AsyncGenerator<string> {
                const frames = (provider as StreamingProvider).stream({
                  feature: 'chat',
                  modelProfile: 'default',
                  systemPromptId: 'engineer-v1',
                  userPrompt: prompt,
                  outputMode: 'markdown',
                  context: {},
                });
                for await (const frame of frames) {
                  if (frame.delta) yield frame.delta;
                }
              },
            }
          : {}),
        executeTool: async (tool, input) => {
          // Thread the same correlation logger into the tool boundary so
          // proposal/approval/apply stages share this execution's id.
          const outcome = await executeToolCore(toolDeps, { tool, input, requestId: `eng-${Date.now().toString(36)}`, stage });
          if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.error}`);
          // The loop never holds approvals — if a tool unexpectedly parks, that
          // is explicit feedback to the model, never a silent null result.
          if (outcome.status === 'approval_required') {
            throw new Error('APPROVAL_REQUIRED: this tool needs operator approval and cannot run inside the loop.');
          }
          return outcome.result ?? outcome.preview;
        },
        listFiles: async (root) => listWorkspaceFiles(root),
        stage,
        tools: loopTools(),
      },
      { rootPath: body.rootPath, task: body.task, ecosystem: body.ecosystem, history: body.history, context: seededContext },
    );

    auditStore.append({ correlationId, type: 'loop.started', component: 'engineer' });
    let terminal: 'completed' | 'failed' = 'failed';
    let finalText = '';
    try {
      for await (const ev of events) {
        if (closed) break; // client went away — stop driving the model
        if (ev.type === 'final') {
          terminal = 'completed';
          const f = ev as { content?: string; summary?: string; text?: string };
          finalText = String(f.content ?? f.summary ?? f.text ?? '');
        }
        send(ev.type, ev);
      }
    } catch (err) {
      // Failure path uses the SAME redaction as success — errors never bypass it.
      send('error', { type: 'error', code: 'ENGINE_FAILURE', error: sanitizeError(err) });
    }
    if (terminal === 'completed') {
      auditStore.append({ correlationId, type: 'loop.completed', component: 'engineer' });
      auditStore.append({ correlationId, type: 'execution.completed', component: 'engineer', outcome: 'ok' });
    } else {
      auditStore.append({ correlationId, type: 'loop.failed', component: 'engineer' });
      auditStore.append({ correlationId, type: 'execution.failed', component: 'engineer', outcome: 'error' });
    }
    // Slice 2 — advisory fallback signal: policy-preferred-cloud OR a low-quality
    // local outcome.
    const assessment = assessCodingOutcome({ output: finalText, failed: terminal === 'failed' });
    const fallbackRecommended = routing.fallbackRecommended || assessment.fallbackRecommended;
    // Slice 3 — on a genuine local FAILURE with a defined reason, mint a cloud
    // escalation OFFER (no cloud call; approval is a separate /escalation/approve
    // request). Impossible under local-only / privacy; only defined reasons qualify.
    // Slice 4 — a successful LOCAL coding turn records a metadata-only usage entry
    // with a clearly-estimated avoided cloud cost.
    let localSavings: { equivalentCloudCostUsd?: number; estimatedSavingsUsd?: number; localCostStatus: 'estimated' | 'unknown' } | undefined;
    if (escalation && providerRouting && terminal === 'completed') {
      localSavings = escalation.recordLocalUsage({ correlationId, providerId: decision.model.provider, modelId: decision.model.id, mode: 'engineer', policy: String(routing.policy ?? 'auto'), outcome: 'ok', request: escRequest });
    }
    let escalationOffer: Record<string, unknown> | undefined;
    if (escalation && providerRouting && terminal === 'failed') {
      const off = await escalation.offer({ correlationId, policy: resolved?.effective ?? providerRouting.policy, outcome: { hadLocalModel: true, terminal: 'failed', output: finalText, errorMessage: 'local engineer loop failed' }, request: escRequest, requiredCaps: { coding: true } });
      if (off.offered) {
        escalationOffer = { offerId: off.offerId, token: off.token, reason: off.reason, target: off.target, estimatedCostUsd: off.estimate?.estimatedCostUsd, worstCaseCostUsd: off.worstCaseCostUsd, costCeilingUsd: off.costCeilingUsd, remainingBudgetUsd: off.remainingBudgetUsd, dataLeavesLocal: off.dataLeavesLocal, expiresAt: off.expiresAt, request: escRequest };
        send('escalation_offer', escalationOffer);
      }
    }
    send('done', {
      correlationId,
      routing: { policy: routing.policy, requestedPolicy: routing.requestedPolicy, effectivePolicy: routing.effectivePolicy, policyReason: routing.policyReason, model: decision.model.id, providerId: decision.model.provider, fallbackRecommended, reasons: [...routing.fallbackReasons, ...assessment.reasons] },
      ...(escalationOffer ? { escalationOffer } : {}),
      ...(localSavings ? { localSavings } : {}),
    });
    raw.end();
  });
}
