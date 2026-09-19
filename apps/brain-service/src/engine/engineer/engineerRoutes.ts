import {
  ENGINEER_CHECKPOINT_VERSION,
  type EngineerCheckpointPayloadV1,
  type EngineerCheckpointStore,
  type EngineerWorkspaceSnapshotV1,
} from './engineerCheckpointStore.js';
import {
  engineerWorkspaceSnapshotFromGit,
} from './engineerWorkspaceSnapshot.js';
import { completionCheckpointText } from './engineerCompletionNarrative.js';
// POST /api/ai/engineer — SSE surface for the model-in-the-loop workspace
// engineer (Slice 2). Local-only: no pilot-api involvement anywhere on this
// path, so disabled remote delegation can never block ordinary local work.

import { DEFAULT_TIMEOUTS } from '../../config/timeoutHierarchy.js';
import { classifyOutcome, type OperationOutcome } from '../observability/operationOutcome.js';

/** Which clock a provider timeout code refers to, for an honest message. */
function timeoutClock(code: string): 'connect' | 'idle' | 'response' | 'absolute' {
  if (code === 'PROVIDER_CONNECT_TIMEOUT') return 'connect';
  if (code === 'PROVIDER_IDLE_TIMEOUT') return 'idle';
  if (code === 'PROVIDER_ABSOLUTE_TIMEOUT') return 'absolute';
  return 'response';
}

/** The terminal state a provider failure implies, before other evidence. */
function outcomeFor(code: string): OperationOutcome {
  if (code === 'USER_ABORTED') return 'cancelled';
  return /_TIMEOUT$/.test(code) ? 'timed_out' : 'failed';
}
import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { BrainEnv } from '../../config/env.js';
import type { ModelRegistry, ModelDescriptor } from '../models/modelRegistry.js';
import { selectModel, tierFromHints } from '../models/capabilityRouter.js';
import { capabilityAuditFields, resolveCapability, tierPolicyFor } from '../capability/capabilityGrants.js';
import { ToolGate, permittedTools, toolAuthoritySummary, ToolNotPermittedError } from '../capability/capabilityTools.js';
import { resolveOperatorPrincipal } from '../capability/operatorPrincipal.js';
import { GOVERNED_WORKFLOW_IDS, capabilityDisclosure, principalAuditFields } from '@migrapilot/protocol';
import { selectLocalCoding, type LocalRoutingDeps } from '../providers/localCodingRouter.js';
import { retrieveContext } from '../../retrieval/retrieve.js';
import type { IndexService, Scope } from '../rag/indexService.js';
import { scopeFrom } from '../memory/memoryRoutes.js';
import { lookup as dnsLookup } from 'node:dns/promises';
import { parseLiveKnowledgeMode, type LiveKnowledgeConnector } from '../liveKnowledge/liveKnowledgeDecision.js';
import {
  LiveConnectorRegistry,
  buildLiveKnowledgeFrame,
  liveResearchAuditFields,
  researchLive,
} from '../liveKnowledge/liveResearch.js';
import {
  DEFAULT_MIN_APPROVED_SCORE,
  decideGrounding,
  groundingAuditFields,
  modeFromLegacy,
  refusalMessage,
  withholdsWorkspaceTools,
  type GroundingDecision,
  type GroundingMode,
} from '../grounding/groundingDecision.js';
import { resolveEffectivePolicy } from '../providers/executionPolicy.js';
import { assessCodingOutcome } from '../providers/codingAssessment.js';
import type { EscalationController } from '../providers/escalationController.js';
import type { ChatTurnRequest, EngineeringTask, EngineeringTaskStage } from '@migrapilot/shared-types';
import { StubProvider, type ProviderAdapter } from '../../providers/providerRegistry.js';
import { OpenAiCompatProvider, classifyProviderFailure, type ProviderFailure } from '../../providers/openAiCompatProvider.js';
import { executeToolCore, type ToolExecDeps } from '../tools/toolExecutor.js';
import { newCorrelationId, makeStageLogger, jsonLineSink, type StageLogger } from '../observability/correlation.js';
import {
  runEngineerTask,
  createCompletionEvidenceState,
  snapshotCompletionEvidence,
  type EngineerRuntimeCheckpoint,
  type EngineerToolInfo,
} from './engineerRuntime.js';
import { buildEngineerLoopTools } from './engineerToolCatalog.js';
import { changesetProposals } from '../models/capabilityRegistry.js';
import { telemetryHub } from '../observability/telemetryHub.js';
import { auditStore, auditHash } from '../observability/auditLog.js';
import { incidentManager } from '../observability/incidents.js';
import { sanitizeError } from '../observability/redaction.js';
import { recoveryManager, RecoveryError } from '../recovery/recovery.js';
import { nodeChangesetFs } from '../../tools/changesetFs.js';
import { contractCompatible, WORKSPACE_TOOL_CONTRACT_VERSION } from '@migrapilot/workspace-tools';
import {
  WorkspaceDelegate,
  CLIENT_WORKSPACE_TOOLS,
  registerDelegate,
  unregisterDelegate,
  delegateFor,
} from '../workspace/workspaceDelegation.js';
import { planTurn } from '@migrapilot/shared-types/turn-intent';
import { AdmissionGate } from '../admission/index.js';
import type { TurnIntent as TurnDecisionIntent } from './turnDecision.js';

/** Total characters of seeded code the agent is given. Enough for a few whole
 * definitions; beyond that a small local model loses the question itself. */
const SEEDED_CONTEXT_CHARS = 6_000;

/**
 * What is this turn trying to DO, in the controller's vocabulary.
 *
 * Classified here, from the ONE shared classifier the consumer and the extension
 * already route on — not re-derived with a second set of verbs. The engineer
 * controller previously hard-coded `'UNKNOWN'`, so a request that every other
 * surface had already recognised as a build arrived at the loop with its intent
 * stripped, and the loop could only fail closed.
 */
function controllerIntent(task: string, hasSpecification: boolean): TurnDecisionIntent {
  switch (planTurn({ text: task, hasImageAttachment: hasSpecification }).intent) {
    case 'implement':
      return 'BUILD';
    case 'modify_existing':
      return 'MODIFY';
    case 'analyze':
    case 'describe':
    case 'critique':
      return 'INSPECT';
    default:
      return 'DISCUSS';
  }
}

const EngineerBodySchema = z.object({
  rootPath: z.string().min(1),
  task: z.string().min(1),

  /**
   * Explicit durable continuation request.
   * x-correlation-id alone never means resume.
   */
  resumeCorrelationId: z.string().trim().min(1).optional(),
  ecosystem: z.boolean().optional(),
  /**
   * Answer ONLY from the approved semantic index.
   *
   * An explicit field, never inferred from the prompt: a governance boundary that
   * depended on phrasing ("using only the approved index...") would be a boundary
   * in name only. When set, working-tree tools are withheld from the loop and an
   * insufficiently-grounded request is refused rather than answered from the
   * checkout. Defaults to false, so existing callers keep today's behaviour — but
   * their evidence is now LABELLED with its source mode.
   */
  /**
   * The CALLER holds the workspace, so the caller runs the workspace tools.
   *
   * Opt-in and explicit: an older client that cannot service tool_request frames
   * must keep today's behaviour rather than deadlock waiting for an answer it
   * will never send. When set, filesystem tools are delegated back over the SSE
   * stream instead of being run against this host — which is the only correct
   * answer once the Brain and the files live on different machines.
   */
  clientWorkspaceTools: z.boolean().optional(),
  /**
   * The workspace-tool contract the client speaks.
   *
   * Checked rather than trusted: a MAJOR mismatch means an existing tool's
   * meaning or result shape changed, so the client's answer would be WRONG while
   * still parsing — the failure mode with no symptom. Refusing the run is louder
   * and cheaper than reasoning over a confidently mis-shaped result.
   */
  workspaceToolContract: z.string().optional(),
  requireApproved: z.boolean().optional(),
  /**
   * Explicit evidence-source mode. Supersedes `requireApproved`, which is kept for
   * older callers and maps to `approved`. Never inferred from the prompt.
   */
  groundingMode: z.enum(['auto', 'approved', 'workspace', 'none']).optional(),
  /** Branch of the caller's checkout, for divergence disclosure. */
  currentBranch: z.string().optional(),
  /**
   * May this turn consult information OUTSIDE the repository, and from which trust
   * class? INDEPENDENT of `groundingMode`: neither implies the other. Absent means
   * `off` — external access is never granted to a caller that did not ask.
   */
  liveKnowledgeMode: z.enum(['off', 'official', 'web']).optional(),
  /**
   * What KIND of work this turn is, declared by the caller.
   *
   * Drives capability authority — whether the routed model has measured standing for this
   * task class. Absent means `unclassified`, which grants nothing and is disclosed as
   * outside the capability system; it is NOT inferred from the prompt, because a model
   * able to widen its own authority by phrasing would make the boundary decorative.
   */
  taskClass: z
    .enum([
      'repository-diagnosis', 'typed-implementation', 'regression-repair', 'test-generation',
      'refactoring', 'patch-planning', 'dependency-analysis', 'security-review',
      'governance-compliance', 'tool-use-decision', 'multi-file-change', 'code-review',
    ])
    .optional(),
  /**
   * Which host workflow produced `taskClass`. PROVENANCE ONLY.
   *
   * Audited so an operator can see WHICH action claimed a class, which is what makes
   * host-ownership auditable rather than asserted. Authority is resolved from `taskClass`
   * alone — deriving it from the workflow would create a second, unmeasured path to
   * authority, and a caller that could name a workflow could then pick its own class.
   */
  workflow: z.enum(GOVERNED_WORKFLOW_IDS).optional(),
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
  /**
   * The specification the caller was asked to build FROM — today, a design read
   * out of an attached mockup by the vision model.
   *
   * A SEPARATE FIELD ON PURPOSE. The client used to paste this onto the end of
   * `task`, which made it indistinguishable from the user's own words: the
   * controller could not tell "build me a website" (no requirement given) from
   * "build this mockup" (the requirement is right here), and answered the second
   * by asking the user to supply what they had already supplied. Sending it
   * apart also keeps it out of the retrieval query, where a paragraph of design
   * prose is noise.
   */
  designSpec: z.string().max(20_000).optional(),
});

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
  /** The semantic index, so the agent path can ground on APPROVED evidence rather
   * than a lexical scan of the checkout. Absent → working-tree mode only, and an
   * approved-only request is refused rather than silently downgraded. */
  indexService?: IndexService,
  /** Branch the approved index was built from, per scope (divergence disclosure). */
  indexedBranch?: (scope: Scope) => string | undefined,
  /**
   * Live-knowledge connector. ABSENT by default: no search provider ships yet, so a
   * request for `official`/`web` reports `live-research-failed` with
   * `no-connector` rather than silently behaving like `off`.
   */
  liveKnowledgeConnector?: LiveKnowledgeConnector,
  /**
   * The connector registry. ABSENT by default: no provider is wired into the running
   * service yet, so `official`/`web` report `live-research-failed` with `no-connector`
   * rather than silently behaving like `off` — an outage must not hide behind a setting.
   *
   * A single `liveKnowledgeConnector` is still accepted and adapted into a registry, so
   * existing callers and tests keep working.
   */
  liveKnowledgeRegistry?: LiveConnectorRegistry,
  /**
   * Durable semantic continuation store.
   *
   * Absent on SQLite/off/degraded persistence: the route remains usable but
   * restart-safe continuation is unavailable rather than simulated in memory.
   */
  checkpointStore?: EngineerCheckpointStore,
): void {
  /**
   * Real DNS resolution for the fetch layer's address checks.
   *
   * Resolved addresses are what get validated, not just the hostname: a name that
   * answers publicly during validation can answer with 10.0.0.1 a moment later, and
   * hostname-only checks do not see it.
   */
  const resolveHostAddresses = async (hostname: string) => {
    const records = await dnsLookup(hostname, { all: true });
    return records.map((r) => ({ address: r.address, family: r.family === 6 ? (6 as const) : (4 as const) }));
  };

  const liveRegistry =
    liveKnowledgeRegistry ??
    (liveKnowledgeConnector
      ? new LiveConnectorRegistry().register(liveKnowledgeConnector, ['official', 'web'])
      : new LiveConnectorRegistry());
  const real = env.localProvider === 'openai-compat';
  /*
   * ONE gate for this deployment, built once. Per-request construction would
   * discard the cache and the single-flight latch between turns, which are the
   * entire reason the compute probe does not amplify the contention it measures.
   */
  const admissionGate = new AdmissionGate({
    providerBaseUrl: env.providerBaseUrl,
    ...(process.env.MIGRAPILOT_STUDIO_URL ? { studioBaseUrl: process.env.MIGRAPILOT_STUDIO_URL } : {}),
    enabled: real,
  });
  const providerFor = (model: ModelDescriptor): ProviderAdapter => {
    if (providerOverride) return providerOverride(model);
    if (!real) return new StubProvider('default');
    return new OpenAiCompatProvider({
      profile: 'default',
      baseUrl: env.providerBaseUrl,
      model: model.id,
      apiKey: env.openAiApiKey,
      connectTimeoutMs: env.providerConnectTimeoutMs,
      idleTimeoutMs: env.providerIdleTimeoutMs,
      responseTimeoutMs: env.providerResponseTimeoutMs,
      absoluteTimeoutMs: env.providerAbsoluteTimeoutMs,
    });
  };

  /** The loop's tool surface: read-only capabilities plus edit.preview.
   * edit.apply is deliberately ABSENT — the loop never mutates. */
  /**
   * @param approvedOnly Withhold every capability that can read the checkout.
   *
   * The loop's own `plan.update` survives because it touches nothing outside the
   * loop. This is what makes "approved evidence only" enforceable rather than
   * advisory: a model that cannot call a file tool cannot quietly ground itself in
   * unapproved code, no matter how the prompt is phrased.
   */
  const loopTools = (approvedOnly = false): EngineerToolInfo[] =>
    buildEngineerLoopTools(toolDeps.registry, approvedOnly);

  // Read-only store health/telemetry (Slice 2). Aggregate health + counters +
  // eviction stats + a small recent-events window — NO proposal bodies, approval
  // tokens, raw paths, or request data. Local, non-production.
  /*
   * The other half of delegation: the client's answer to one tool_request.
   *
   * Addressed by correlation id + call id. The correlation id is already
   * unguessable and already how the audit trail names a run, so there is one
   * notion of "which run" rather than a second parallel token. An unknown pair
   * is a 404 rather than a silent success: a result that lands nowhere means the
   * run is waiting on something it will never receive, and that must be visible.
   */
  app.post<{ Body: { correlationId?: string; callId?: string; ok?: boolean; result?: unknown; error?: string } }>(
    '/api/ai/engineer/tool-result',
    async (request, reply) => {
      const body = request.body ?? {};
      const correlationId = String(body.correlationId ?? '').trim();
      const callId = String(body.callId ?? '').trim();
      if (!correlationId || !callId) {
        reply.code(400);
        return { ok: false, code: 'INVALID_INPUT', error: 'correlationId and callId are required.' };
      }
      const delegate = delegateFor(correlationId);
      if (!delegate) {
        reply.code(404);
        return { ok: false, code: 'UNKNOWN_RUN', error: 'No active run is waiting on that correlation id.' };
      }
      const settled = delegate.settle(
        callId,
        body.ok === false
          ? { ok: false, error: String(body.error ?? 'the client could not run that tool') }
          : { ok: true, result: body.result },
      );
      if (!settled) {
        reply.code(404);
        return { ok: false, code: 'UNKNOWN_CALL', error: 'That call is not in flight — it may have timed out already.' };
      }
      return { ok: true };
    },
  );

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
      return { ok: true, plan: await recoveryManager.plan(inc.correlationId) };
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
      return { ok: true, applied: await recoveryManager.apply(request.params.id, request.body?.approvalToken ?? '', recFs) };
    } catch (err) {
      return recFail(reply, err);
    }
  });
  app.post<{ Params: { id: string } }>('/api/ai/engineer/recovery/:id/verify', async (request, reply) => {
    try {
      return { ok: true, evidence: await recoveryManager.verify(request.params.id, recFs) };
    } catch (err) {
      return recFail(reply, err);
    }
  });
  // Resolve requires passing validation evidence (verify is re-run server-side).
  app.post<{ Params: { id: string } }>('/api/ai/engineer/recovery/:id/resolve', async (request, reply) => {
    try {
      const evidence = await recoveryManager.verify(request.params.id, recFs);
      await recoveryManager.resolve(request.params.id, evidence);
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
    const resolvedControllerIntent = controllerIntent(
      body.task,
      Boolean(body.designSpec),
    );

    const headerId = String(
      (request.headers['x-correlation-id'] as string | undefined) ?? '',
    ).trim();

    const scope: Scope = scopeFrom(request);
    const requestedResumeId = body.resumeCorrelationId;

    if (
      requestedResumeId &&
      headerId &&
      headerId !== requestedResumeId
    ) {
      reply.code(409);
      return {
        ok: false,
        code: 'ENGINEER_RESUME_CORRELATION_MISMATCH',
        error:
          'x-correlation-id and resumeCorrelationId identify different Engineer runs.',
      };
    }

    let resumeCheckpoint: EngineerCheckpointPayloadV1 | undefined;

    if (requestedResumeId) {
      if (!checkpointStore) {
        reply.code(409);
        return {
          ok: false,
          code: 'ENGINEER_RESUME_UNAVAILABLE',
          error:
            'Durable Engineer continuation is unavailable on this Brain.',
        };
      }

      let loaded: EngineerCheckpointPayloadV1 | null;

      try {
        loaded = await checkpointStore.load(
          {
            owner: scope.owner,
            workspace: scope.workspace,
          },
          requestedResumeId,
        );
      } catch {
        reply.code(409);
        return {
          ok: false,
          code: 'ENGINEER_RESUME_CHECKPOINT_INVALID',
          error:
            'The durable Engineer checkpoint could not be validated.',
        };
      }

      if (!loaded) {
        reply.code(404);
        return {
          ok: false,
          code: 'ENGINEER_RESUME_NOT_FOUND',
          error:
            'No durable Engineer checkpoint exists in this owner/workspace scope.',
        };
      }

      if (loaded.status === 'COMPLETED') {
        reply.code(409);
        return {
          ok: false,
          code: 'ENGINEER_RESUME_ALREADY_COMPLETED',
          error:
            'This Engineer task is already durably complete.',
        };
      }

      if (loaded.status === 'FAILED') {
        reply.code(409);
        return {
          ok: false,
          code: 'ENGINEER_RESUME_FAILED_TASK',
          error:
            'FAILED Engineer checkpoints are not resumable in the R2 contract.',
        };
      }

      if (
        loaded.rootPath !== body.rootPath ||
        loaded.objective !== body.task ||
        loaded.intent !== resolvedControllerIntent
      ) {
        reply.code(409);
        return {
          ok: false,
          code: 'ENGINEER_RESUME_IDENTITY_MISMATCH',
          error:
            'Workspace, objective, or controller intent does not match the durable checkpoint.',
        };
      }

      resumeCheckpoint = loaded;
    }

    const correlationId =
      resumeCheckpoint?.correlationId ??
      (headerId || newCorrelationId());

    const stage: StageLogger = makeStageLogger(
      correlationId,
      jsonLineSink((line) => request.log.info(line)),
    );
    stage.log('request', { rootPath: body.rootPath, ecosystem: Boolean(body.ecosystem) });
    await auditStore.append({ correlationId, type: 'execution.started', component: 'engineer', requestId: headerId || undefined, fields: { workspace: auditHash(body.rootPath), ecosystem: Boolean(body.ecosystem) } });

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
    await auditStore.append({ correlationId, type: 'execution.routed', component: 'engineer', fields: { model: decision.model.id, provider: decision.model.provider, ...(routing.policy ? { policy: routing.policy, fallbackRecommended: routing.fallbackRecommended } : {}) } });

    const KEEPALIVE_MS = DEFAULT_TIMEOUTS.keepaliveMs;
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
        lastWriteAt = Date.now();
      } catch {
        closed = true;
      }
    };

    const task: EngineeringTask = {
      taskId: correlationId,
      workspaceRoot: body.rootPath,
      stage: 'inspect',
      checkpoint: 'Brain accepted the engineering request and is gathering repository evidence.',
      observedFiles: [],
      evidence: [],
      commands: [],
      repairAttempts: 0,
      completion: 'in_progress',
    };
    const taskStage = (stage: EngineeringTaskStage, checkpoint: string): void => {
      task.stage = stage;
      task.checkpoint = checkpoint;
      send('task', { task: { ...task, observedFiles: [...task.observedFiles], evidence: [...task.evidence], commands: [...task.commands] } });
    };

    /*
     * The client runs the workspace tools when it says it can. The delegate is
     * created here because it needs `send`, and registered under the run's
     * correlation id so the separate result callback can find this suspended run.
     */
    if (body.clientWorkspaceTools) {
      const compat = contractCompatible(body.workspaceToolContract);
      if (!compat.compatible) {
        // Fail the run rather than fall back to running these on THIS host: the
        // fallback answers questions about a filesystem the caller does not have,
        // which is the original defect wearing a compatibility hat.
        send('error', {
          type: 'error',
          code: 'WORKSPACE_CONTRACT_MISMATCH',
          error: `${compat.reason}. Update the MigraPilot extension.`,
          serverContract: WORKSPACE_TOOL_CONTRACT_VERSION,
        });
        send('done', { correlationId, outcome: 'refused', code: 'WORKSPACE_CONTRACT_MISMATCH' });
        // No keepalive exists yet — the refusal happens before the heartbeat starts.
        raw.end();
        return;
      }
    }
    const delegate = body.clientWorkspaceTools
      ? // The client answers on a SEPARATE request, so the frame must carry the run's
        // identity: a callId alone would not tell it which run to reply to.
        new WorkspaceDelegate((call) => send('tool_request', { ...call, correlationId }))
      : undefined;
    if (delegate) {
      registerDelegate(correlationId, delegate);
      // A client that disconnects must not leave the loop waiting on a tool that
      // can no longer be answered.
      request.raw.on('close', () => unregisterDelegate(correlationId));
    }

    // KEEPALIVE — the only thing that distinguishes slow work from dead work.
    //
    // A local model can spend minutes on prefill before its first token, during
    // which the stream is silent and indistinguishable from a hung one. Every
    // patience clock in the chain resets on ANY frame, so a periodic heartbeat is
    // what lets those clocks stay short: the UI can give up after two minutes of
    // real silence without ever cutting off work that is genuinely running.
    //
    // It carries elapsed time so a client can show honest progress, and it is the
    // only frame with no meaning for the answer — clients ignore its content.
    let lastWriteAt = Date.now();
    const startedAt = Date.now();
    const keepalive = setInterval(() => {
      if (closed) return;
      if (Date.now() - lastWriteAt < KEEPALIVE_MS) return; // real output already proved life
      send('keepalive', { elapsedMs: Date.now() - startedAt });
    }, KEEPALIVE_MS);
    keepalive.unref?.();
    request.raw.on('close', () => clearInterval(keepalive));
    taskStage('inspect', task.checkpoint);

    // ── Capability authority: does this model have STANDING for this work? ─────
    // Computed from measured benchmark grants, disclosed by the host, and audited. This
    // commit does NOT change which model was selected — `decision.model` above is
    // untouched. Enforcement is a separate step on purpose: a routing regression and a
    // disclosure bug arriving together could not be isolated. What lands here is
    // observability, including the case where the routed model has no standing for the
    // declared class.
    const capability = resolveCapability({ taskClass: body.taskClass, model: decision.model.id });

    // STEP 4 — the tool gate opens only now. Sealed until this line, so any attempt to
    // derive or expose a tool earlier throws instead of quietly succeeding. That makes the
    // ordering invariant structural rather than a matter of nobody reordering two lines.
    const toolGate = new ToolGate().open(capability);

    // The acting operator, DERIVED at a trusted boundary and never read from the request.
    // No override exists yet; the principal lands first so that when one does, the audit
    // names somebody it did not learn from the requester.
    const principal = resolveOperatorPrincipal({ headers: request.headers as Record<string, string | undefined>, env: process.env });

    await auditStore.append({
      correlationId,
      type: 'capability.decided',
      component: 'engineer',
      requestId: headerId || undefined,
      fields: {
        ...capabilityAuditFields(capability),
        ...principalAuditFields(principal),
        // Provenance: which host action claimed this class. Never an authority input.
        ...(body.workflow ? { workflow: body.workflow } : {}),
      },
    });

    // Surface the correlation id to the client so it can be quoted in support.
    send('route', { model: decision.model.id, provider: decision.model.provider, reason: decision.reason, correlationId, policy: routing.policy, requestedPolicy: routing.requestedPolicy, effectivePolicy: routing.effectivePolicy, policyReason: routing.policyReason, fallbackRecommended: routing.fallbackRecommended });

    /*
     * 🚨 CAN THE CARD ACTUALLY SERVE THIS TURN? ASK BEFORE SPENDING THE USER'S TIME.
     *
     * The chat path has gated on this for a while. THIS path — the coding agent,
     * which is the product — never did, and the gap is not theoretical: measured
     * 2026-09-03, a build-from-mockup turn sat for the full 240 s provider deadline
     * and then returned a generic failure, while a ComfyUI render held the GPU. The
     * user waits four minutes to be told nothing useful, having been given no way to
     * know the card was already committed.
     *
     * Refusing here costs a probe and returns in seconds with a sentence that says
     * what is actually happening and that nothing was lost.
     *
     * `real` mirrors providerFor: with a stub provider there is no GPU to be busy,
     * so the suite must not depend on the workstation being awake. An unreadable
     * probe returns `unknown` and does NOT refuse — a monitoring outage must never
     * become an outage of the thing being monitored.
     */
    const admission = await admissionGate.admit({ model: decision.model.id });
    if (admission.outcome === 'refused') {
      stage.log('error', { code: admission.code });
      await auditStore.append({
        correlationId,
        type: 'execution.failed',
        component: 'engineer',
        requestId: headerId || undefined,
        outcome: admission.code!,
        fields: {
          refusedBeforeModelCall: true,
          capacity: admission.state,
          reason: admission.reason,
          cached: admission.cached,
        },
      });
      send('refusal', { code: admission.code, message: admission.message, capacity: admission.state, reason: admission.reason });
      send('done', { ok: false, code: admission.code, outcome: 'refused', correlationId });
      raw.end();
      return;
    }

    // Seed the agent with the SAME tuned lexical grounding the chat path used
    // (definition-first ranking, filename bonus, copy-path penalty). Routing
    // ordinary turns to this loop replaced that with a naive keyword search,
    // which on a large monorepo found the wrong "lint" entirely. Bounded and
    // best-effort: retrieval must never slow down or fail a turn.
    // ── Where does this turn's evidence come from? ONE decision, both paths. ──
    // This route used to seed the loop from a LEXICAL retriever over the live
    // checkout and never consult the approved index at all. Asked about code that
    // existed only on an unmerged branch, it seeded three `package.json` files and
    // a `PROVENANCE.md` — high lexical scores, no relevance — and the model cited
    // them as though they were approved evidence.
    // The mode wins when both are sent; the legacy boolean only fills in for callers
    // that predate it.
    const groundingMode: GroundingMode = body.groundingMode ?? modeFromLegacy(body.requireApproved);
    // Enforcement, not decoration: in `approved`/`none` the loop is handed no
    // repo-reading capability at all, so it cannot re-acquire by hand what the mode
    // forbids.
    const toolsWithheld = withholdsWorkspaceTools(groundingMode);
    const grounding: GroundingDecision | undefined = indexService
      ? await decideGrounding(
          { mode: groundingMode, query: body.task, currentBranch: body.currentBranch },
          {
            approvedIndexId: () => indexService.approvedIndexFor(scope),
            retrieveApproved: async (indexId, query) => {
              const rag = await indexService.retrieve(indexId, scope, query, { maxChunks: 6, tokenBudget: 2000, requireApproved: true });
              if (!rag.ok) throw new Error(rag.code);
              return rag.chunks.map((c) => ({ path: c.filePath, startLine: c.startLine, endLine: c.endLine, snippet: c.snippet, score: c.score }));
            },
            indexIdentity: (indexId) => {
              const rec = indexService.status(indexId, scope);
              return rec ? { version: rec.version, indexedBranch: indexedBranch?.(scope) } : undefined;
            },
            minScore: DEFAULT_MIN_APPROVED_SCORE,
          },
        )
      : undefined;

    // ── Live knowledge: a SECOND, independent evidence dimension ──────────────
    // Resolved separately from grounding and audited separately. `off` (including a
    // request that omits the field) returns before any connector is touched, so a
    // turn that did not ask for external access performs none.
    const liveMode = parseLiveKnowledgeMode(body.liveKnowledgeMode);
    const liveStartedAt = new Date().toISOString();
    const liveT0 = Date.now();
    const live = await researchLive(
      { mode: liveMode, query: body.task },
      {
        registry: liveRegistry,
        fetch: { resolve: resolveHostAddresses, now: () => new Date() },
        now: () => new Date().toISOString(),
      },
    );
    await auditStore.append({
      correlationId,
      type: 'liveKnowledge.decided',
      component: 'engineer',
      requestId: headerId || undefined,
      // Metadata only. The query, the page bodies and the excerpts have no path in.
      fields: liveResearchAuditFields(live, { startedAt: liveStartedAt, durationMs: Date.now() - liveT0 }),
    });

    if (grounding) {
      await auditStore.append({
        correlationId,
        type: 'retrieval.decided',
        component: 'engineer',
        requestId: headerId || undefined,
        fields: groundingAuditFields(grounding, DEFAULT_MIN_APPROVED_SCORE),
      });
    }

    // Provenance FIRST, so the badge renders above whatever follows — including a
    // refusal. Emitting it after the refusal meant a refused turn carried no source
    // label at all, which is precisely the disclosure this slice exists to enforce.
    if (grounding) {
      // The host renders provenance from this frame, so it carries BOTH what was
      // requested and what was actually used — a fallback must be visible as one.
      send('grounding', {
        requestedMode: grounding.requested,
        sourceMode: grounding.mode,
        currentBranch: grounding.currentBranch,
        ...(grounding.mode === 'approved-index'
          ? {
              indexVersion: grounding.indexVersion,
              indexedBranch: grounding.indexedBranch,
              ...(grounding.allowed ? { branchDiverged: grounding.branchDiverged } : {}),
            }
          : grounding.mode === 'working-tree'
            ? { indexedBranch: grounding.indexedBranch, branchDiverged: grounding.branchDiverged, forced: grounding.forced }
            : {}),
      });
    }

    // The SECOND provenance frame, emitted whether or not repository grounding ran and
    // before any answer text — including before a refusal. The host renders it; the model
    // never sees these labels and so cannot alter them.
    send('liveKnowledge', buildLiveKnowledgeFrame(live));

    // The THIRD frame: which model acted, with what standing, and what went unverified.
    // Separate from the other two because it answers a different question — those describe
    // the EVIDENCE a turn used, this describes the AUTHORITY it had to use it.
    send('capability', {
      taskClass: capability.taskClass,
      model: capability.model,
      authority: capability.authority,
      requiredTier: capability.requiredTier,
      routedTier: capability.routedTier,
      belowRequiredTier: capability.belowRequiredTier,
      evidenceBacked: capability.evidenceBacked,
      reason: capability.reason,
      unverified: capability.unverified,
      disclosure: capabilityDisclosure(capability),
    });

    // ── STEP 6a — DENIED: refuse before the model is called ───────────────────
    // A host-owned refusal, rendered from the decision with no model involvement. The
    // point is not politeness: presenting generated prose as a security review is the
    // dishonesty this exists to prevent, so a denied governed action produces THIS instead
    // of analysis. The capability frame was already emitted above, so the refusal arrives
    // after its own provenance.
    if (capability.authority === 'denied') {
      const policy = tierPolicyFor(capability.taskClass);
      const evidence = policy?.evidence
        ? `benchmark ${policy.evidence.benchCommit}, sample size ${policy.evidence.sampleSize}`
        : undefined;
      send('refusal', {
        code: 'CAPABILITY_DENIED',
        taskClass: capability.taskClass,
        availableTier: capability.routedTier,
        requiredTier: capability.requiredTier,
        ...(policy ? { basis: policy.basis } : {}),
        ...(evidence ? { evidence } : {}),
        message: [
          'Capability authority: Denied',
          `Task class: ${capability.taskClass}`,
          `Available tier: ${capability.routedTier}`,
          `Required tier: ${capability.requiredTier}`,
          ...(policy ? [`Basis: ${policy.basis}`] : []),
          ...(evidence ? [`Evidence: ${evidence}`] : []),
          'Action: escalation required',
          '',
          capability.reason,
        ].join('\n'),
      });
      await auditStore.append({
        correlationId,
        type: 'capability.refused',
        component: 'engineer',
        outcome: 'refused',
        requestId: headerId || undefined,
        fields: { ...capabilityAuditFields(capability), refusedBeforeModelCall: true },
      });
      send('done', { ok: false, code: 'CAPABILITY_DENIED' });
      raw.end();
      return;
    }

    // Approved-only and not groundable ⇒ refuse BEFORE the loop starts, so no
    // working-tree tool is ever reachable for this turn.
    if (grounding && grounding.mode === 'approved-index' && !grounding.allowed) {
      send('refusal', { code: 'INSUFFICIENT_APPROVED_EVIDENCE', reason: grounding.reason, sourceMode: 'approved-index', message: refusalMessage(grounding) });
      send('done', { ok: false, code: 'INSUFFICIENT_APPROVED_EVIDENCE' });
      raw.end();
      return;
    }

    // Approved evidence, when the decision produced it. The lexical retriever is
    // reached ONLY in working-tree mode, which is disclosed to the model below.
    const approvedSeed = grounding && grounding.mode === 'approved-index' && grounding.allowed
      ? grounding.chunks.map((c) => ({ path: c.path, startLine: c.startLine, endLine: c.endLine, snippet: c.snippet }))
      : undefined;

    // `none` must gather NOTHING: not approved chunks, not a lexical scan. Reaching
    // the lexical retriever here would make the mode a label rather than a rule.
    const seededContext = groundingMode === 'none'
      ? []
      : approvedSeed ?? await retrieveContext({
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
      // Budget the seeded context. Reading each definition to its END made the
      // excerpts complete but much longer, and six long excerpts buried the
      // question: the same query that had answered correctly started replying
      // that the excerpts did not cover it. Keep the best few, whole.
      .then((cs) => {
        const kept: typeof cs = [];
        let budget = SEEDED_CONTEXT_CHARS;
        for (const c of cs) {
          if (kept.length > 0 && c.snippet.length > budget) break;
          kept.push(c);
          budget -= c.snippet.length;
        }
        return kept;
      })
      .then((cs) => cs.map((c) => ({ path: c.path, startLine: c.startLine, endLine: c.endLine, snippet: c.snippet })))
      .catch(() => [] as Array<{ path: string; startLine: number; endLine: number; snippet: string }>);
    stage.log('request', { seededChunks: seededContext.length });

    /*
     * R2 — DURABLE ENGINEER SEMANTIC LIFECYCLE.
     *
     * The checkpoint begins HERE, after routing/capability/admission/grounding
     * have succeeded and immediately before the semantic controller begins.
     *
     * A refusal before this point is not resumable work and must not create a
     * misleading RUNNING row.
     */
    const checkpointCreatedAt =
      resumeCheckpoint?.createdAt ??
      new Date().toISOString();

    const checkpointResumeEpoch =
      resumeCheckpoint
        ? resumeCheckpoint.resumeEpoch + 1
        : 0;

    const workspaceSnapshotFrom = (
      state: EngineerRuntimeCheckpoint | undefined,
    ): EngineerWorkspaceSnapshotV1 => {
      const observations = state?.observations ?? [];

      const statusObservation = [...observations]
        .reverse()
        .find((observation) => observation.tool === 'git.status');

      const overviewObservation = [...observations]
        .reverse()
        .find((observation) => observation.tool === 'git.overview');

      /*
       * Restart-safe repository identity needs both authoritative views:
       *
       *   git.overview -> HEAD + branch
       *   git.status   -> exact per-file working-tree state
       *
       * Partial evidence is UNKNOWN, not equivalence.
       */
      if (!statusObservation || !overviewObservation) {
        return {
          gitHead: null,
          gitBranch: null,
          dirtyFingerprint: null,
        };
      }

      try {
        return engineerWorkspaceSnapshotFromGit(
          statusObservation.result,
          overviewObservation.result,
        );
      } catch {
        /*
         * Malformed historical/tool evidence cannot become durable continuation
         * authority. Persist UNKNOWN so later resume revalidation fails closed.
         */
        return {
          gitHead: null,
          gitBranch: null,
          dirtyFingerprint: null,
        };
      }
    };

    const initialEvidence = snapshotCompletionEvidence(
      createCompletionEvidenceState({
        rootPath: body.rootPath,
        task: body.task,
        ...(body.designSpec ? { specification: body.designSpec } : {}),
        intent: resolvedControllerIntent,
      }),
    );

    let latestRuntimeCheckpoint: EngineerRuntimeCheckpoint | undefined;

    let revalidatedWorkspaceSnapshot:
      | EngineerWorkspaceSnapshotV1
      | undefined;

    const executeResumePrecondition = async (
      tool: string,
      input: unknown,
    ): Promise<unknown> => {
      if (delegate && CLIENT_WORKSPACE_TOOLS.has(tool)) {
        stage.log('tool', {
          tool,
          delegated: true,
          resumeRevalidation: true,
        });

        return delegate.request(tool, input);
      }

      const known = toolDeps.registry
        .list({ includeUnavailable: true })
        .find((candidate) => candidate.id === tool);

      toolGate.assertPermitted(
        tool,
        known?.readOnly ?? false,
      );

      const outcome = await executeToolCore(toolDeps, {
        tool,
        input,
        requestId: `eng-resume-${Date.now().toString(36)}`,
        stage,
      });

      if (!outcome.ok) {
        throw new Error(`${outcome.code}: ${outcome.error}`);
      }

      if (outcome.status === 'approval_required') {
        throw new Error(
          'APPROVAL_REQUIRED: resume revalidation must remain read-only.',
        );
      }

      return outcome.result ?? outcome.preview;
    };

    let restoredResume:
      | {
          plan: EngineerCheckpointPayloadV1['plan'];
          completionEvidence:
            EngineerCheckpointPayloadV1['completionEvidence'];
          observations:
            EngineerCheckpointPayloadV1['observations'];
        }
      | undefined;

    let resumeWorkspaceState:
      | 'fresh'
      | 'unchanged'
      | 'changed' = 'fresh';

    if (resumeCheckpoint) {
      let freshStatus: unknown;
      let freshOverview: unknown;

      try {
        await executeResumePrecondition(
          'workspace.list',
          {
            rootPath: body.rootPath,
            path: '.',
            depth: 0,
            limit: 1,
          },
        );

        freshStatus = await executeResumePrecondition(
          'git.status',
          {
            rootPath: body.rootPath,
          },
        );

        freshOverview = await executeResumePrecondition(
          'git.overview',
          {
            rootPath: body.rootPath,
          },
        );

        revalidatedWorkspaceSnapshot =
          engineerWorkspaceSnapshotFromGit(
            freshStatus,
            freshOverview,
          );
      } catch (err) {
        stage.log('error', {
          code: 'ENGINEER_RESUME_REVALIDATION_FAILED',
        });

        send('error', {
          type: 'error',
          code: 'ENGINEER_RESUME_REVALIDATION_FAILED',
          error:
            'The workspace could not be freshly revalidated. No resumed model work was started.',
          detail: sanitizeError(err),
        });

        send('done', {
          correlationId,
          outcome: 'refused',
          code: 'ENGINEER_RESUME_REVALIDATION_FAILED',
        });

        clearInterval(keepalive);
        unregisterDelegate(correlationId);
        raw.end();
        return;
      }

      const priorSnapshot =
        resumeCheckpoint.workspaceSnapshot;
      const freshSnapshot =
        revalidatedWorkspaceSnapshot;

      const unchanged =
        priorSnapshot.dirtyFingerprint !== null &&
        priorSnapshot.gitHead === freshSnapshot.gitHead &&
        priorSnapshot.gitBranch === freshSnapshot.gitBranch &&
        priorSnapshot.dirtyFingerprint ===
          freshSnapshot.dirtyFingerprint;

      if (unchanged) {
        resumeWorkspaceState = 'unchanged';

        restoredResume = {
          plan: resumeCheckpoint.plan.map(
            (step) => ({ ...step }),
          ),
          completionEvidence: {
            enabled:
              resumeCheckpoint.completionEvidence.enabled,
            satisfied: [
              ...resumeCheckpoint.completionEvidence.satisfied,
            ],
            evidence:
              resumeCheckpoint.completionEvidence.evidence.map(
                ([id, evidence]) => [
                  id,
                  [...evidence],
                ],
              ),
          },
          observations:
            resumeCheckpoint.observations.map(
              (observation) => ({
                tool: observation.tool,
                input: observation.input,
                result: observation.result,
              }),
            ),
        };

        latestRuntimeCheckpoint = {
          sequence: 0,
          plan: restoredResume.plan.map(
            (step) => ({ ...step }),
          ),
          completionEvidence: {
            enabled:
              restoredResume.completionEvidence.enabled,
            satisfied: [
              ...restoredResume.completionEvidence.satisfied,
            ],
            evidence:
              restoredResume.completionEvidence.evidence.map(
                ([id, evidence]) => [
                  id,
                  [...evidence],
                ],
              ),
          },
          observations:
            restoredResume.observations.map(
              (observation) => ({
                tool: observation.tool,
                input: observation.input,
                result: observation.result,
              }),
            ),
        };
      } else {
        resumeWorkspaceState = 'changed';
        restoredResume = undefined;
        latestRuntimeCheckpoint = undefined;
      }

      send('resume', {
        correlationId,
        resumeEpoch: checkpointResumeEpoch,
        workspaceState: resumeWorkspaceState,
        restoredSemanticState:
          resumeWorkspaceState === 'unchanged',
      });
    } else {
      /*
       * A FRESH run establishes its own durable repository identity.
       *
       * This used to come ONLY from git.status/git.overview OBSERVATIONS — that is,
       * from tools the model might simply never call. Across five real runs it never
       * called git.status once, so every fresh checkpoint stored {null,null,null},
       * and `unchanged` (which requires dirtyFingerprint !== null) could never hold.
       * Every FIRST interruption was therefore forced to resume as
       * workspaceState=changed with its accepted work discarded: restart-safe
       * continuation existed but was unreachable by construction.
       *
       * Repository identity is INFRASTRUCTURE, not a model choice, so it is captured
       * here on the same read-only precondition path resume already uses.
       *
       * Deliberately non-fatal. A workspace that cannot be read still runs; it just
       * stores UNKNOWN and resumes fail-closed, exactly as it did before.
       * Establishing identity must never be able to refuse a run.
       */
      try {
        const initialStatus = await executeResumePrecondition(
          'git.status',
          { rootPath: body.rootPath },
        );

        const initialOverview = await executeResumePrecondition(
          'git.overview',
          { rootPath: body.rootPath },
        );

        revalidatedWorkspaceSnapshot =
          engineerWorkspaceSnapshotFromGit(
            initialStatus,
            initialOverview,
          );
      } catch (err) {
        stage.log('error', {
          code: 'ENGINEER_INITIAL_SNAPSHOT_UNAVAILABLE',
          detail: sanitizeError(err),
        });
      }
    }


    const durableCheckpoint = (
      runtime: EngineerRuntimeCheckpoint | undefined,
      status: EngineerCheckpointPayloadV1['status'],
      updatedAt: string,
    ): EngineerCheckpointPayloadV1 => ({
      taskStateVersion: ENGINEER_CHECKPOINT_VERSION,
      correlationId,
      rootPath: body.rootPath,
      objective: body.task,
      intent: resolvedControllerIntent,
      plan: runtime?.plan.map((step) => ({ ...step })) ?? [],
      completionEvidence:
        runtime?.completionEvidence ?? initialEvidence,
      observations:
        runtime?.observations.map((observation) => ({
          tool: observation.tool,
          input: observation.input,
          result: observation.result,
        })) ?? [],
      workspaceSnapshot: (() => {
        const runtimeSnapshot = workspaceSnapshotFrom(runtime);

        if (
          runtimeSnapshot.gitHead !== null ||
          runtimeSnapshot.gitBranch !== null ||
          runtimeSnapshot.dirtyFingerprint !== null
        ) {
          return runtimeSnapshot;
        }

        return (
          revalidatedWorkspaceSnapshot ??
          runtimeSnapshot
        );
      })(),
      resumeEpoch: checkpointResumeEpoch,
      status,
      createdAt: checkpointCreatedAt,
      updatedAt,
    });

    if (checkpointStore) {
      try {
        await checkpointStore.save(
          { owner: scope.owner, workspace: scope.workspace },
          durableCheckpoint(
            latestRuntimeCheckpoint,
            'RUNNING',
            new Date().toISOString(),
          ),
        );
      } catch (err) {
        stage.log('error', {
          code: 'ENGINEER_CHECKPOINT_UNAVAILABLE',
        });
        await auditStore.append({
          correlationId,
          type: 'execution.failed',
          component: 'engineer',
          outcome: 'ENGINEER_CHECKPOINT_UNAVAILABLE',
          fields: {
            refusedBeforeModelCall: true,
          },
        });
        send('error', {
          type: 'error',
          code: 'ENGINEER_CHECKPOINT_UNAVAILABLE',
          error:
            'Durable Engineer continuation could not be initialized. No model work was started.',
        });
        send('done', {
          correlationId,
          outcome: 'failed',
          code: 'ENGINEER_CHECKPOINT_UNAVAILABLE',
        });
        clearInterval(keepalive);
        unregisterDelegate(correlationId);
        raw.end();
        return;
      }
    }

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
          /*
           * DELEGATE FIRST, before this host's registry is consulted at all.
           *
           * These tools answer questions about the CALLER's filesystem. Running
           * them here would not merely fail — workspace.list happily reported an
           * empty directory for a path that simply is not on this machine, which
           * is how an agent ends up inventing files. Whoever holds the workspace
           * answers, or nobody does.
           */
          if (delegate && CLIENT_WORKSPACE_TOOLS.has(tool)) {
            stage.log('tool', { tool, delegated: true });
            return delegate.request(tool, input);
          }
          // AUTHORITY IS CHECKED HERE, not only in the advertised list. `executeToolCore`
          // validates that a tool exists, is available and is approved — it never checked
          // the tool against what THIS turn was shown, so a model naming an unadvertised
          // tool reached the executor regardless. Withholding from the prompt was a hope;
          // this is the boundary.
          const known = toolDeps.registry.list({ includeUnavailable: true }).find((t) => t.id === tool);
          try {
            toolGate.assertPermitted(tool, known?.readOnly ?? false);
          } catch (err) {
            if (err instanceof ToolNotPermittedError) {
              stage.log('error', { tool, code: 'CAPABILITY_TOOL_DENIED', detail: err.message.slice(0, 200) });
              await auditStore.append({
                correlationId,
                type: 'capability.tool_denied',
                component: 'engineer',
                outcome: 'refused',
                requestId: headerId || undefined,
                fields: { ...capabilityAuditFields(capability), deniedTool: tool, deniedToolClass: err.toolClass },
              });
            }
            throw err;
          }
          // Thread the same correlation logger into the tool boundary so
          // proposal/approval/apply stages share this execution's id.
          const outcome = await executeToolCore(toolDeps, { tool, input, requestId: `eng-${Date.now().toString(36)}`, stage });
          if (!outcome.ok) {
            // Record WHY. A failed tool previously logged only outcome:"error",
            // so a build that called fs.proposeChangeset and produced nothing was
            // undiagnosable — the run just ended with the model apologising.
            stage.log('error', { tool, code: outcome.code, detail: String(outcome.error ?? '').slice(0, 300) });
            throw new Error(`${outcome.code}: ${outcome.error}`);
          }
          // The loop never holds approvals — if a tool unexpectedly parks, that
          // is explicit feedback to the model, never a silent null result.
          if (outcome.status === 'approval_required') {
            throw new Error('APPROVAL_REQUIRED: this tool needs operator approval and cannot run inside the loop.');
          }
          return outcome.result ?? outcome.preview;
        },
        listFiles: async (root) => listWorkspaceFiles(root),
        stage,

        ...(checkpointStore
          ? {
              checkpoint: async (
                runtimeCheckpoint: EngineerRuntimeCheckpoint,
              ): Promise<void> => {
                /*
                 * Controller-authoritative state becomes durable before the
                 * corresponding visible semantic transition. runEngineerTask
                 * owns that ordering; this callback only persists its snapshot.
                 */
                latestRuntimeCheckpoint = runtimeCheckpoint;

                await checkpointStore.save(
                  {
                    owner: scope.owner,
                    workspace: scope.workspace,
                  },
                  durableCheckpoint(
                    runtimeCheckpoint,
                    'RUNNING',
                    new Date().toISOString(),
                  ),
                );
              },
            }
          : {}),

        // Advertised set and executed set are filtered by the SAME gate object, so they
        // cannot drift apart the way an advertisement-only narrowing did.
        tools: permittedTools(toolGate, loopTools(toolsWithheld)),
      },
      {
        rootPath: body.rootPath,
        task: body.task,
        // Passed through, never spliced into the message. The runtime owns prompt
        // assembly, so there is exactly ONE place that decides how a specification
        // is presented to the model — and the controller keeps it as evidence.
        ...(body.designSpec ? { specification: body.designSpec } : {}),
        intent: resolvedControllerIntent,
        ...(restoredResume
          ? {
              resume: {
                plan: restoredResume.plan.map(
                  (step) => ({ ...step }),
                ),
                completionEvidence: {
                  enabled:
                    restoredResume.completionEvidence.enabled,
                  satisfied: [
                    ...restoredResume.completionEvidence.satisfied,
                  ],
                  evidence:
                    restoredResume.completionEvidence.evidence.map(
                      ([id, evidence]) => [
                        id,
                        [...evidence],
                      ],
                    ),
                },
                observations:
                  restoredResume.observations.map(
                    (observation) => ({
                      tool: observation.tool,
                      input: observation.input,
                      result: observation.result,
                    }),
                  ),
              },
            }
          : {}),
        ecosystem: body.ecosystem,
        history: body.history,
        context: seededContext,
        // Label the evidence so the answer can state its provenance.
        contextSource: groundingMode === 'none' ? 'none' : approvedSeed ? 'approved-index' : 'working-tree',
        ...(grounding && grounding.mode === 'approved-index' && grounding.allowed
          ? { contextIndexVersion: grounding.indexVersion }
          : {}),
        ...(grounding && grounding.mode === 'approved-index' && grounding.allowed && grounding.branchDiverged
          ? { contextBranchNotice: `NOTE: this evidence was indexed from branch \`${grounding.indexedBranch}\`, but the checkout is \`${grounding.currentBranch}\` — say so if the answer depends on code that may have changed since.` }
          : {}),
      },
    );

    await auditStore.append({ correlationId, type: 'loop.started', component: 'engineer' });
    let failure: ProviderFailure | undefined;

    /*
     * A controller-accepted final is provisional until the terminal COMPLETED
     * checkpoint is durable.
     */
    let pendingFinalEvent: unknown;
    let terminalCheckpointWriteFailed = false;

    // FIVE terminal states, not two. `completed | failed` could not say that a
    // deadline fired while the work was still running, that a human stopped it, or
    // that the client went away mid-answer — so all three were reported as
    // `failed`, which blamed the model for two of them.
    let terminal: OperationOutcome = 'failed';
    let engineCompleted = false;
    let finalText = '';
    try {
      for await (const ev of events) {
        if (closed) break; // client went away — stop driving the model
        if (ev.type === 'step') {
          const step = ev as { tool?: string; summary?: string };
          if (step.tool && !task.observedFiles.includes(step.tool)) task.observedFiles.push(step.tool);
          taskStage(step.tool?.includes('search') || step.tool?.includes('read') ? 'inspect' : 'plan', step.summary ?? 'Brain completed an engineering step.');
        } else if (ev.type === 'proposal') {
          const preview = (ev as {
            preview?: {
              proposalHash?: string;
              ops?: Array<{ path?: string; op?: string; kind?: string; before?: string | null; after?: string | null; content?: string }>;
              files?: Array<{ path?: string; before?: string | null; after?: string | null }>;
            };
          }).preview;
          if (preview?.proposalHash) {
            const operations = preview.ops?.length
              ? preview.ops.map((op) => ({
                  path: op.path ?? '',
                  operation: op.kind ?? op.op ?? 'modify',
                  ...(op.before !== undefined ? { before: op.before } : {}),
                  ...(op.after !== undefined ? { after: op.after } : {}),
                  ...(op.content !== undefined ? { after: op.content } : {}),
                }))
              : (preview.files ?? []).map((file) => ({
                  path: file.path ?? '',
                  operation: 'edit',
                  ...(file.before !== undefined ? { before: file.before } : {}),
                  ...(file.after !== undefined ? { after: file.after } : {}),
                }));
            task.proposal = {
              proposalHash: preview.proposalHash,
              approvalState: 'pending',
              operations,
              expectedVerification: ['Run the narrowest repository test or build command that covers the changed files.'],
            };
          }
          taskStage('awaiting_approval', 'A structured changeset is ready for operator review.');
        } else if (ev.type === 'final') {
          engineCompleted = true;
          terminal = 'completed';
          const f = ev as { content?: string; summary?: string; text?: string };
          finalText = String(f.content ?? f.summary ?? f.text ?? '');

          // Controller-accepted, but not yet durably terminal.
          pendingFinalEvent = ev;
          continue;
        }

        send(ev.type, ev);
      }
    } catch (err) {
      // Failure path uses the SAME redaction as success — errors never bypass it.
      // The CAUSE is named: a bare ENGINE_FAILURE/AbortError could not distinguish
      // "too slow to start" from "went silent" from "the user pressed Stop", which
      // made a 60s total-deadline defect look like an unexplained engine fault.
      failure = classifyProviderFailure(err);
      taskStage('failed', 'The Brain could not complete the engineering task.');
      send('error', {
        type: 'error', code: failure.code, cause: failure.cause,
        ...(failure.limitMs ? { limitMs: failure.limitMs } : {}),
        error: sanitizeError(err),
        outcome: outcomeFor(failure.code),
      });
    }

    // Decide the terminal state from what was OBSERVED, in one place.
    terminal = classifyOutcome({
      ...(failure?.code === 'USER_ABORTED' ? { cancelled: true } : {}),
      ...(failure && /_TIMEOUT$/.test(failure.code)
        ? { timedOut: { clock: timeoutClock(failure.code), limitMs: failure.limitMs ?? 0, elapsedMs: Date.now() - startedAt } }
        : {}),
      // A client that went away is never a completed answer, however much of it
      // was generated before the socket closed.
      ...(closed && !engineCompleted ? { streamEndedEarly: true } : {}),
      engineCompleted,
      ...(failure && failure.code === 'ENGINE_FAILURE' ? { error: { message: failure.cause } } : {}),
    });
    /*
     * The route owns process/request lifecycle, so it owns terminal checkpoint
     * classification too.
     *
     * A stale RUNNING row after a hard process death remains intentionally
     * possible; recovery/resume code treats that as interrupted work, never as
     * permission to auto-execute.
     */
    if (checkpointStore) {
      const checkpointStatus =
        terminal === 'completed'
          ? 'COMPLETED'
          : terminal === 'failed'
            ? 'FAILED'
            : 'INTERRUPTED';

      const updatedAt = new Date().toISOString();

      try {
        /*
         * Save the last semantic state with the terminal status when one exists.
         * This is stronger than status-only mutation because it makes terminal
         * durability self-contained even if the last semantic callback occurred
         * immediately before process/request teardown.
         */
        await checkpointStore.save(
          {
            owner: scope.owner,
            workspace: scope.workspace,
          },
          durableCheckpoint(
            latestRuntimeCheckpoint,
            checkpointStatus,
            updatedAt,
          ),
        );
      } catch (err) {
        stage.log('error', {
          code: 'ENGINEER_CHECKPOINT_TERMINAL_WRITE_FAILED',
        });
        await auditStore.append({
          correlationId,
          type: 'execution.failed',
          component: 'engineer',
          outcome: 'ENGINEER_CHECKPOINT_TERMINAL_WRITE_FAILED',
          fields: {
            terminal,
          },
        });

        if (terminal === 'completed') {
          terminalCheckpointWriteFailed = true;
          terminal = 'failed';

          taskStage(
            'failed',
            'The Brain accepted the answer but could not durably record completion.',
          );

          send('error', {
            type: 'error',
            code: 'ENGINEER_CHECKPOINT_TERMINAL_WRITE_FAILED',
            error:
              'The answer was generated, but durable completion could not be recorded. The accepted final was not published.',
            outcome: 'failed',
          });
        }
      }
    }

    /*
     * DURABLE-BEFORE-VISIBLE.
     *
     * At this point terminal=completed means the terminal COMPLETED checkpoint
     * succeeded. Only now may the accepted final become client-visible.
     */
    if (terminal === 'completed' && pendingFinalEvent) {
      send('final', pendingFinalEvent);
    }

    if (terminal === 'completed') {
      if (task.stage !== 'awaiting_approval') {
        taskStage('verified', completionCheckpointText(task));
      }
      task.completion = 'complete';
      send('task', { task });
      await auditStore.append({ correlationId, type: 'loop.completed', component: 'engineer' });
      await auditStore.append({ correlationId, type: 'execution.completed', component: 'engineer', outcome: 'ok' });
    } else {
      await auditStore.append({ correlationId, type: 'loop.failed', component: 'engineer' });
      // Metadata only — the cause CLASS and the limit that expired, never the
      // provider's text or the prompt.
      await auditStore.append({
        correlationId,
        type: 'execution.failed',
        component: 'engineer',
        outcome: failure?.cause ?? 'error',
        ...(failure ? { fields: { cause: failure.cause, ...(failure.limitMs ? { limitMs: failure.limitMs } : {}) } } : {}),
      });
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
    if (
      escalation &&
      providerRouting &&
      terminal === 'failed' &&
      !terminalCheckpointWriteFailed
    ) {
      const off = await escalation.offer({ correlationId, policy: resolved?.effective ?? providerRouting.policy, outcome: { hadLocalModel: true, terminal: 'failed', output: finalText, errorMessage: 'local engineer loop failed' }, request: escRequest, requiredCaps: { coding: true } });
      if (off.offered) {
        escalationOffer = { offerId: off.offerId, token: off.token, reason: off.reason, target: off.target, estimatedCostUsd: off.estimate?.estimatedCostUsd, worstCaseCostUsd: off.worstCaseCostUsd, costCeilingUsd: off.costCeilingUsd, remainingBudgetUsd: off.remainingBudgetUsd, dataLeavesLocal: off.dataLeavesLocal, expiresAt: off.expiresAt, request: escRequest };
        send('escalation_offer', escalationOffer);
      }
    }
    send('done', {
      correlationId,
      outcome: terminal,
      ...(terminalCheckpointWriteFailed
        ? { code: 'ENGINEER_CHECKPOINT_TERMINAL_WRITE_FAILED' }
        : {}),
      routing: { policy: routing.policy, requestedPolicy: routing.requestedPolicy, effectivePolicy: routing.effectivePolicy, policyReason: routing.policyReason, model: decision.model.id, providerId: decision.model.provider, fallbackRecommended, reasons: [...routing.fallbackReasons, ...assessment.reasons] },
      ...(escalationOffer ? { escalationOffer } : {}),
      ...(localSavings ? { localSavings } : {}),
    });
    // The heartbeat must not outlive the request it was proving alive. `unref` kept
    // it from holding the process open, but one interval per completed request is
    // still an orphan, and "no orphan remains" is the contract.
    clearInterval(keepalive);
    // Same contract for the delegate: the run is over, so nothing may still be
    // waiting on a client answer, and the registry must not accumulate entries.
    unregisterDelegate(correlationId);
    raw.end();
  });
}
