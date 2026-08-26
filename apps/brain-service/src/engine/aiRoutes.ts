/**
 * MigraAI Engine — unified public API facade (`/api/ai/*`).
 *
 * This is the single contract every client (VS Code extension, MigraPanel,
 * MigraMail, mobile, future products) speaks to. Clients describe WHAT the turn
 * needs (capabilities + tier) or pass a plain prompt; the engine's registry +
 * capability router decide WHICH model answers, and fail over automatically when
 * a model can't run. Callers never name Ollama, Qwen, DeepSeek, llava, etc.
 *
 * Additive: the legacy `/chat`, `/route`, `/retrieve`, `/tools/*` endpoints keep
 * working unchanged, so existing clients are undisturbed while new clients adopt
 * `/api/ai/*`.
 *
 * Client-facing errors are sanitized: routing hints (which capability/model is
 * missing) are surfaced, but raw provider error bodies / stack traces are logged
 * server-side only and replaced with a generic message + code.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChatAttachment, ChatTurnRequest, RetrieveRequest } from '@migrapilot/shared-types';
import type { BrainEnv } from '../config/env.js';
import type { ProviderAdapter } from '../providers/providerRegistry.js';
import { StubProvider } from '../providers/providerRegistry.js';
import { OpenAiCompatProvider } from '../providers/openAiCompatProvider.js';
import { retrieveContext } from '../retrieval/retrieve.js';
import {
  DEFAULT_MIN_APPROVED_SCORE,
  decideGrounding,
  groundingAuditFields,
  modeFromLegacy,
  refusalMessage,
  type GroundingDecision,
  type GroundingMode,
} from './grounding/groundingDecision.js';
import { ModelRegistry, type ModelDescriptor, type ProviderSource } from './modelRegistry.js';
import { selectModel, tierFromHints, type RouteSpec } from './capabilityRouter.js';
import { selectLocalCoding, type LocalRoutingDeps } from './providers/localCodingRouter.js';
import { resolveEffectivePolicy } from './providers/executionPolicy.js';
import type { EscalationController } from './providers/escalationController.js';
import { QualificationStore } from './qualificationStore.js';
import { ConversationStore, PersistenceUnavailableError, type Scope } from './memory/conversationStore.js';
import { buildContext, type ContextDiagnostics } from './memory/contextBuilder.js';
import { redactSecrets } from './memory/redaction.js';
import { scopeFrom } from './memory/memoryRoutes.js';
import { engineCorrelationId } from './toolRoutes.js';
import { BrainTurnTrace } from './turnTrace.js';
import { classifyGenerationIntent } from './media/generationIntent.js';
import { DEFAULT_STUDIO_CONFIG, generateImage, type GenerationStage } from './media/studioImage.js';
import { describeImageRequest, shapeImagePrompt } from './media/imagePrompt.js';
import { renderTextGlyph } from './media/glyphRender.js';
import type { IndexService } from './rag/indexService.js';
import { auditStore } from './auditLog.js';
import { gateVisionTurn, visionCapabilitySnapshot, type VisionGateDeps } from './media/visionGate.js';

interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AiChatBody {
  prompt?: string;
  messages?: AiChatMessage[];
  attachments?: ChatAttachment[];
  tier?: string;
  model?: string;
  feature?: string;
  profile?: string;
  needsTools?: boolean;
  needsReasoning?: boolean;
  preferCoding?: boolean;
  /** Slice 5: per-request execution-policy preference (server resolves). */
  policy?: string;
  conversationSummary?: string;
  selectionText?: string;
  activeFile?: string;
  /** When set, the engine grounds the turn with repo retrieval (RAG). */
  workspaceRoot?: string;
  /**
   * Answer ONLY from the approved semantic index — an explicit field, never
   * inferred from the prompt. Withholds the working-tree lexical fallback and
   * refuses an insufficiently-grounded turn instead of substituting unapproved
   * evidence. Defaults to false so existing callers are unaffected.
   */
  requireApproved?: boolean;
  /**
   * Restrict grounded retrieval to these files.
   *
   * A BOUNDARY, not a hint: when present, nothing outside the set may be retrieved and
   * there is no fallback to the wider index. This is what makes a conversation's attached
   * files mean something — without it the set only toggled grounding on, and retrieval
   * ranked across every document the caller owned.
   */
  groundingFiles?: string[];
  /** Explicit evidence-source mode; supersedes `requireApproved`. */
  groundingMode?: GroundingMode;
  /** Branch of the caller's checkout, for divergence disclosure. */
  currentBranch?: string;
  /** SSE token streaming when truthy; otherwise a single JSON response. */
  stream?: boolean;
  /** Server-side conversation memory: the engine owns durable history. */
  conversationId?: string;
  memoryPolicy?: { mode?: 'off' | 'session' | 'durable'; retrieve?: boolean; store?: boolean };
  /** Explicit evaluation mode — allows routing to non-approved (but installed,
   * non-rejected) models for benchmarking. Never the default. */
  evaluation?: boolean;
}

interface AiEmbeddingsBody {
  input?: string | string[];
  model?: string;
}

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|bmp)$/i;
/** Max models to try for one chat turn before giving up (winner + failovers). */
const MAX_FAILOVER = 3;

/** Provider adapter that can additionally stream tokens over SSE. */
type StreamingProvider = ProviderAdapter & {
  stream?: (
    request: ChatTurnRequest,
    signal?: AbortSignal,
  ) => AsyncGenerator<{ delta?: string; usage?: { inputTokens: number; outputTokens: number } }>;
};

const STUB_MODEL: ModelDescriptor = {
  id: 'stub-model',
  provider: 'stub',
  tier: 'balanced',
  capabilities: { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true, insert: false },
};

export function sourcesFromEnv(env: BrainEnv): ProviderSource[] {
  return [{ id: 'local', baseUrl: env.providerBaseUrl, apiKey: env.openAiApiKey }];
}

/** Build the engine ModelRegistry exactly as {@link registerAiRoutes} would, so a
 * caller can share ONE registry across the AI facade, the engineer route, and the
 * provider fleet. */
export function buildEngineModelRegistry(env: BrainEnv, qualStore?: QualificationStore): ModelRegistry {
  const real = env.localProvider === 'openai-compat';
  const qual = qualStore ?? new QualificationStore();
  return new ModelRegistry(
    real
      ? { sources: sourcesFromEnv(env), qualify: (id) => qual.get(id) }
      : { sources: [], staticModels: [STUB_MODEL], qualify: (id) => qual.get(id) },
  );
}

export function registerAiRoutes(
  app: FastifyInstance,
  env: BrainEnv,
  registry?: ModelRegistry,
  memoryStore?: ConversationStore,
  providerOverride?: (model: ModelDescriptor) => StreamingProvider,
  qualStore?: QualificationStore,
  indexService?: IndexService,
  /** Slice 2: when provided, CODING chat turns are routed local-first (ranked
   * restricted to local models; never invokes cloud) with a fallback signal.
   * Absent → chat selection is unchanged. */
  providerRouting?: LocalRoutingDeps,
  /** Slice 3: when provided, a CODING chat turn that fails locally with a DEFINED
   * reason may mint a cloud-escalation OFFER (no cloud call here). */
  escalation?: EscalationController,
  /** Branch the APPROVED index was built from, per scope — for divergence
   * disclosure. Absent → divergence is reported as unknown, never as "same". */
  indexedBranch?: (scope: { owner: string; workspace: string }) => string | undefined,
  /**
   * The caller's stored response preferences.
   *
   * LOADED HERE RATHER THAN SENT BY THE CLIENT. The Brain already owns
   * preferences and already resolves the caller's scope, so reading them here
   * means no client can claim a style it was not given, and every client — the
   * consumer, the extension, anything later — gets the behaviour without
   * separately remembering to send it. Absent → no directives, which is exactly
   * how the engine behaved before.
   */
  loadPreferences?: (scope: { owner: string; workspace: string }) => Promise<string[]>,
  /**
   * Access to the governed qualification tables.
   *
   * Absent (no PostgreSQL) means image turns are refused rather than served by
   * whatever happens to be installed — the same fail-closed rule the routes
   * themselves follow, applied to their own wiring.
   */
  visionDeps?: VisionGateDeps,
): ModelRegistry {
  const real = env.localProvider === 'openai-compat';
  const qual = qualStore ?? new QualificationStore();
  // Qualification gating applies only to real discovered models. The deterministic
  // stub backend (tests / no-provider) has one synthetic model and is never gated.
  const enforceQual = real && qual.enforced;
  const reg =
    registry ??
    new ModelRegistry(
      real
        ? { sources: sourcesFromEnv(env), qualify: (id) => qual.get(id) }
        : { sources: [], staticModels: [STUB_MODEL], qualify: (id) => qual.get(id) },
    );

  /** Build a provider bound to a concrete chosen model. Stub backend ignores the
   * model id and returns deterministic output (keeps the engine exercisable with
   * no inference provider present). A test override injects a controllable one. */
  const providerFor = (model: ModelDescriptor, approvedVisionModel?: string): StreamingProvider => {
    if (providerOverride) return providerOverride(model);
    if (!real) return new StubProvider('default');
    return new OpenAiCompatProvider({
      profile: 'default',
      baseUrl: env.providerBaseUrl,
      model: model.id,
      /*
       * THE MODEL THAT ANSWERS AN IMAGE TURN IS THE ONE THAT WAS APPROVED.
       *
       * `approvedVisionModel` comes from the qualification gate — a decision
       * naming an exact digest that a human signed off. Falling back to
       * "whatever model the router picked, if it happens to accept images" would
       * let an image turn be served by a model nobody qualified for it, which
       * makes the gate a formality: it would decide who may ask and then let
       * something else answer.
       *
       * Undefined means no approved vision model for this turn, and the provider
       * then describes attachments textually instead of analysing them — the
       * fail-safe direction.
       */
      visionModel: approvedVisionModel,
      apiKey: env.openAiApiKey,
      connectTimeoutMs: env.providerConnectTimeoutMs,
      idleTimeoutMs: env.providerIdleTimeoutMs,
      responseTimeoutMs: env.providerResponseTimeoutMs,
      absoluteTimeoutMs: env.providerAbsoluteTimeoutMs,
    });
  };

  // ── Catalog ────────────────────────────────────────────────────────────────
  app.get('/api/ai/models', async () => {
    const models = await reg.list();
    return { count: models.length, providers: [...new Set(models.map((m) => m.provider))], models };
  });

  // ── Vision Registry (the vision-model qualification view) ────────────────────
  // Same discipline as the engine/reasoning/RAG registries: a vision model
  // becomes the default only after it is licensed, measured, and proven. This
  // groups vision-capable models by qualification state and names the current
  // production default (the top-tier approved vision model, or none = fail-closed).
  app.get('/api/ai/vision-registry', async () => {
    const vision = (await reg.list()).filter((m) => m.capabilities.vision);
    const entry = (m: (typeof vision)[number]) => ({
      id: m.id,
      provider: m.provider,
      paramCount: m.paramCount,
      state: m.qualification?.state ?? 'installed',
      license: m.qualification?.license,
      commercial: m.qualification?.commercial,
      reason: m.qualification?.reason,
      benchmarkedAt: m.qualification?.benchmarkedAt,
    });
    const byState = {
      qualified: vision.filter((m) => m.qualification?.state === 'approved').map(entry),
      evaluating: vision.filter((m) => m.qualification?.state === 'benchmarking').map(entry),
      installed: vision.filter((m) => (m.qualification?.state ?? 'installed') === 'installed').map(entry),
      restricted: vision.filter((m) => m.qualification?.state === 'restricted').map(entry),
      deprecated: vision.filter((m) => m.qualification?.state === 'deprecated').map(entry),
      rejected: vision.filter((m) => m.qualification?.state === 'rejected').map(entry),
    };
    // Production default = the approved vision model the router would actually
    // pick for an image turn (fail-closed: null when none is approved).
    /*
     * THE GOVERNED ANSWER WINS.
     *
     * `byState` above reflects the deployment manifest, which is a file. The
     * durable decisions are the authority: a human approved an exact digest
     * against a named capability, and a revocation must be visible on the very
     * next request. Reported per operation, because one boolean cannot describe
     * a model that reads a document perfectly and miscounts what is on it.
     */
    const governed = visionDeps ? await visionCapabilitySnapshot(visionDeps) : null;
    const defaultDecision = await selectModel(reg, { needsVision: true, tier: 'balanced', enforce: enforceQual, mode: 'production' });
    return {
      count: vision.length,
      enforced: enforceQual,
      // The model an image turn would ACTUALLY use, which is the governed one
      // whenever governance is wired; the manifest choice only when it is not.
      default: governed ? governed.general.modelId : (defaultDecision?.model.id ?? null),
      governed: governed
        ? {
            source: 'model_qualification_decisions',
            'vision.general': governed.general,
            'vision.object_counting': governed.objectCounting,
          }
        : { source: 'unavailable', reason: 'the governed qualification store is not wired' },
      registry: byState,
    };
  });

  // ── Chat (capability-routed completion, streaming or buffered) ───────────────
  app.post<{ Body: AiChatBody }>('/api/ai/chat', async (request, reply) => {
    const body = request.body ?? {};
    const { userPrompt, summary } = normalizeConversation(body);
    if (!userPrompt && !(body.attachments?.length)) {
      reply.code(400);
      return { ok: false, code: 'BAD_REQUEST', error: 'Provide `prompt`, `messages`, or `attachments`.' };
    }

    const requestId = engineCorrelationId(request);
    /*
     * The engine's own half of the turn, under the caller's id. The consumer can
     * only see this whole route as one opaque stage; when that stage is 89s, the
     * question "where?" has to be answerable from in here.
     */
    const trace = new BrainTurnTrace(requestId);
    await auditStore.append({
      correlationId: requestId,
      requestId,
      type: 'execution.started',
      component: 'chat',
      fields: { streaming: Boolean(body.stream), toolsRequested: Boolean(body.needsTools) },
    });
    trace.mark('audit');

    const hasImage = (body.attachments ?? []).some((a) => IMAGE_MIME.test(a.mimeType));

    /*
     * GOVERNED VISION. The prompt chooses the capability and the capability
     * chooses the model — never a vision-capable model chosen first and asked
     * whatever came in. `vision.general` is approved here; `vision.object_counting`
     * is not, because the model was measured on counting and fails it silently.
     *
     * Refused BEFORE any model call, so a question nothing is qualified for costs
     * nothing and cannot come back as a confident wrong number.
     */
    let visionGate: Awaited<ReturnType<typeof gateVisionTurn>> | null = null;
    if (hasImage && visionDeps) {
      visionGate = await gateVisionTurn(visionDeps, userPrompt);
      if (!visionGate.serve) {
        await auditStore.append({
          correlationId: requestId,
          requestId,
          type: 'capability.refused',
          component: 'chat',
          outcome: 'VISION_NOT_QUALIFIED',
          fields: { operation: visionGate.operation, capability: visionGate.capability },
        });
        reply.code(422);
        return {
          ok: false,
          code: 'VISION_NOT_QUALIFIED',
          error: visionGate.message,
          operation: visionGate.operation,
          capability: visionGate.capability,
        };
      }
    }

    /*
     * Bound once, from the gate. Every provider built for this turn analyses
     * images with the model the approval names, or with none at all.
     */
    const approvedVisionModel = visionGate?.serve ? visionGate.modelId : undefined;
    trace.set('has_image', hasImage);
    if (visionGate) trace.set('vision_capability', visionGate.capability);
    trace.mark('vision_gate');

    /*
     * The attachment NAMES are the canonical refs — the consumer sends the id as
     * the name precisely so nothing here has to trust a filename. Filtered to the
     * canonical shape so a non-image attachment cannot enter the transcript as a
     * picture that will never resolve.
     */
    const turnImageRefs = (body.attachments ?? [])
      .filter((a) => IMAGE_MIME.test(a.mimeType) && /^img_[0-9a-f]{32}$/.test(a.name))
      .map((a) => a.name);

    const spec: RouteSpec = {
      needsVision: hasImage,
      /*
       * The approved decision NAMES the model, so routing follows the durable
       * record rather than re-deriving a choice that could differ from what was
       * qualified. This is what makes a revocation take effect on the next
       * request with nothing to restart.
       */
      ...(visionGate?.serve
        ? { model: visionGate.modelId, governedApproval: visionGate.modelId }
        : {}),
      needsTools: Boolean(body.needsTools),
      needsReasoning: Boolean(body.needsReasoning) || tierFromHints(body) === 'deep',
      preferCoding: Boolean(body.preferCoding) || isCodingIntent(body.feature, userPrompt),
      tier: tierFromHints(body),
      model: body.model,
      enforce: enforceQual,
      mode: body.evaluation ? 'evaluation' : 'production',
    };

    let decision = await selectModel(reg, spec);
    if (!decision) {
      await auditStore.append({
        correlationId: requestId,
        requestId,
        type: 'execution.failed',
        component: 'chat',
        outcome: 'NO_MODEL',
      });
      reply.code(503);
      return {
        ok: false,
        code: 'NO_MODEL',
        error: hasImage
          ? 'No qualified vision-capable model is available. Install and qualify one (e.g. `ollama pull qwen2.5vl:7b`).'
          : 'No suitable model is available from any configured provider.',
      };
    }

    // ── Slice 2 — local-first coding routing. For a CODING chat turn, restrict the
    // failover set to LOCAL models (never invoke cloud) and surface a fallback
    // signal when the active policy would prefer cloud. Non-coding turns and the
    // unwired case are unchanged. Preserves the capability router's ordering +
    // qualification gating; only removes non-local candidates.
    let fallback: { policy?: string; requestedPolicy?: string; effectivePolicy?: string; policyReason?: string; fallbackRecommended: boolean; reasons: string[] } = { fallbackRecommended: false, reasons: [] };
    // Slice 5: resolve the per-request policy preference (server-authoritative).
    const resolved = providerRouting ? resolveEffectivePolicy(body.policy, providerRouting.policy, { cloudUsable: await providerRouting.fleet.hasUsableCloud() }) : undefined;
    const effectiveRouting = providerRouting && resolved ? { ...providerRouting, policy: resolved.effective } : providerRouting;
    if (spec.preferCoding && effectiveRouting && resolved) {
      const local = await selectLocalCoding(effectiveRouting, { preferCoding: true, needsVision: spec.needsVision, needsTools: spec.needsTools, needsReasoning: spec.needsReasoning, tier: spec.tier });
      const localIds = new Set(local.rankedLocalModels.map((m) => m.id));
      const localRanked = decision.ranked.filter((m) => localIds.has(m.id));
      if (localRanked.length > 0) {
        decision = { model: localRanked[0]!, reason: `local-first (${resolved.effective})`, alternatives: localRanked.slice(1).map((m) => m.id), ranked: localRanked };
      }
      fallback = { policy: resolved.effective, requestedPolicy: resolved.requested, effectivePolicy: resolved.effective, policyReason: resolved.reason, fallbackRecommended: local.fallbackRecommended, reasons: local.fallbackReasons };
    }

    /*
     * IMAGE GENERATION IS A DIFFERENT CAPABILITY, ROUTED BEFORE A MODEL IS PICKED.
     *
     * "generate letter A in png" used to return a tutorial listing Photoshop,
     * Canva and Pillow. The routing record said why: `alternatives: []`. Nothing
     * had rejected an image generator — there was never one to consider, so the
     * turn went to a text model, and a text model did what text models do.
     *
     * Decided here rather than after model selection because no completion model
     * is involved at all: the turn is served by Studio's diffusion pipeline.
     * Requires a streaming request, because a generation legitimately takes
     * minutes on a cold checkpoint and a buffered response would just hang.
     */
    if (
      !hasImage &&
      body.stream &&
      classifyGenerationIntent(userPrompt) === 'image_generation'
    ) {
      trace.set('capability', 'image_generation');
      trace.mark('route');
      await streamGeneration(request, reply, requestId, userPrompt, trace);
      return reply;
    }

    trace.set('model', decision.model.id);
    trace.set('provider', decision.model.provider);
    trace.mark('route');

    // ── Conversation memory: the engine decides what prior context enters the
    // window and commits the completed assistant message. Opt-in by policy. ──
    const scope: Scope = scopeFrom(request);
    const policy = { mode: body.memoryPolicy?.mode ?? 'session', retrieve: body.memoryPolicy?.retrieve ?? true, store: body.memoryPolicy?.store ?? true };
    let conv = memoryStore && body.conversationId ? memoryStore.getConversation(body.conversationId, scope) : undefined;
    // Self-heal a stale conversationId: `session` memory is in-memory, so a brain
    // restart clears it while a client keeps a now-unknown id. Rather than silently
    // degrade to amnesia, recreate the conversation so forward storage/retrieval
    // resume. This turn's lost context is still recovered from the client-provided
    // summary (which the client always sends as a fallback). No recreation when the
    // client opted out of memory (mode 'off').
    if (!conv && memoryStore && body.conversationId && policy.mode !== 'off') {
      conv = await memoryStore.createConversation(scope, { memoryMode: policy.mode === 'durable' ? 'durable' : 'session', id: body.conversationId });
    }
    const memoryActive = Boolean(conv && conv.memoryMode !== 'off');

    let effectiveSummary = summary;
    let contextDiagnostics: ContextDiagnostics | undefined;
    if (memoryActive && policy.retrieve) {
      const built = buildContext({ store: memoryStore!, scope, conversationId: conv!.id, currentPrompt: userPrompt, retrieve: true });
      const prior = built.messages.filter((m) => m.role !== 'system').slice(0, -1).map((m) => `${m.role}: ${m.content}`).join('\n');
      effectiveSummary = prior || built.summaryText || summary;
      contextDiagnostics = built.diagnostics;
    }
    // Store the user message BEFORE the model call (idempotent per requestId).
    if (memoryActive && policy.store && userPrompt) {
      // Deliberately NOT guarded: a refused durable write propagates out of the
      // route. Storing the prompt happens before the model runs, so failing here
      // costs no inference — and answering a turn whose prompt was never stored
      // would leave a conversation that cannot be reconstructed.
      /*
       * The refs are recorded ON THE MESSAGE, not inferred later from the
       * conversation's active set. Message one must still show the picture it
       * asked about after that picture is dropped from the active context — a
       * transcript that rewrites itself to match today's context is not a record.
       */
      await memoryStore!.appendMessage(conv!.id, scope, {
        role: 'user', content: redactSecrets(userPrompt).text, status: 'complete', requestId,
        ...(turnImageRefs.length > 0 ? { imageRefs: turnImageRefs } : {}),
      });
    }
    // Commit the assistant message ONLY on successful completion — never a
    // partial/cancelled/failed response.
    const commit = memoryActive && policy.store
      ? async (text: string, modelId: string, providerId: string): Promise<void> => {
          if (!text.trim()) return;
          await memoryStore!.appendMessage(conv!.id, scope, { role: 'assistant', content: redactSecrets(text).text, status: 'complete', requestId, modelId, providerId });
        }
      : undefined;

    // ── Semantic RAG: only an APPROVED index for this workspace backs production
    // chat (fail-closed — no approved index ⇒ no RAG). Retrieved chunks are cited
    // and the model is told to distinguish evidence from inference. ──
    let ragChunks: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number; source: 'embedding' }> | undefined;
    let grounding: GroundingDecision | undefined;
    /*
     * Files the caller explicitly attached to this conversation.
     *
     * Computed once and used for BOTH the retrieval boundary and the grounding decision,
     * so the two cannot disagree about whether this turn is scoped — the retriever
     * narrowing while the floor still judged it globally is precisely how a user's own
     * attached file got refused.
     */
    const scopedFiles = Array.isArray(body.groundingFiles)
      ? body.groundingFiles.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      : [];
    if (indexService && userPrompt && policy.retrieve !== false) {
      grounding = await decideGrounding(
        {
          mode: body.groundingMode ?? modeFromLegacy(body.requireApproved),
          query: userPrompt,
          currentBranch: body.currentBranch,
          ...(scopedFiles.length > 0 ? { scopedFiles } : {}),
        },
        {
          approvedIndexId: () => indexService.approvedIndexFor(scope),
          retrieveApproved: async (indexId, query) => {
            const rag = await indexService.retrieve(indexId, scope, query, {
              maxChunks: 6,
              tokenBudget: 2000,
              requireApproved: true,
              // Same value the grounding decision sees. An empty array is NO scope, never
              // "scope to nothing".
              ...(scopedFiles.length > 0 ? { files: scopedFiles } : {}),
            });
            if (!rag.ok) throw new Error(rag.code);
            return rag.chunks.map((c) => ({ path: c.filePath, startLine: c.startLine, endLine: c.endLine, snippet: c.snippet, score: c.score }));
          },
          indexIdentity: (indexId) => {
            const rec = indexService.status(indexId, scope);
            // `indexedBranch` is the branch the APPROVED generation was built from.
            // It is recorded on the workspace, not the index, so a missing lookup
            // degrades to "unknown" — never to a false "same branch" claim.
            return rec ? { version: rec.version, indexedBranch: indexedBranch?.(scope) } : undefined;
          },
          minScore: DEFAULT_MIN_APPROVED_SCORE,
        },
      );
      await auditStore.append({
        correlationId: requestId,
        requestId,
        type: 'retrieval.decided',
        component: 'chat',
        fields: groundingAuditFields(grounding, DEFAULT_MIN_APPROVED_SCORE),
      });

      // An approved-only request that could not be grounded is REFUSED here. It
      // must not reach the model, because the model would answer from whatever
      // else is in context and the caller asked for approved evidence only.
      if (grounding.mode === 'approved-index' && !grounding.allowed) {
        reply.code(409);
        return { ok: false, code: 'INSUFFICIENT_APPROVED_EVIDENCE', error: refusalMessage(grounding), reason: grounding.reason, sourceMode: 'approved-index' };
      }

      if (grounding.mode === 'approved-index' && grounding.allowed) {
        ragChunks = grounding.chunks.map((c) => ({ ...c, source: 'embedding' as const }));
        const cites = grounding.chunks.map((c) => `${c.path}:${c.startLine}-${c.endLine}`).join(', ');
        const divergence = grounding.branchDiverged
          ? ` NOTE: this evidence was indexed from branch \`${grounding.indexedBranch}\`, but the checkout is \`${grounding.currentBranch}\` — say so if the answer depends on code that may have changed.`
          : '';
        effectiveSummary = `Retrieved workspace evidence from the APPROVED semantic index (version ${grounding.indexVersion}) (cite these when stating repository facts; do NOT claim a repo fact without a cited source; distinguish retrieved evidence from your own inference): ${cites}.${divergence}\n\n${effectiveSummary}`;
      }
    }

    /*
     * Best-effort: a preferences read that fails must not fail the turn. Losing
     * a style directive degrades an answer; refusing to answer destroys it.
     */
    let directives: string[] = [];
    if (loadPreferences) {
      try {
        directives = await loadPreferences(scope);
      } catch {
        directives = [];
      }
    }

    trace.mark('context')
    const chatRequest = await buildChatRequest(body, userPrompt, effectiveSummary, ragChunks, directives);
    trace.mark('request_built');
    await auditStore.append({
      correlationId: requestId,
      requestId,
      type: 'execution.routed',
      component: 'chat',
      fields: {
        model: decision.model.id,
        provider: decision.model.provider,
        toolsRequested: spec.needsTools,
      },
    });

    if (body.stream) {
      await streamChat(request, reply, requestId, decision.ranked, decision.reason,
        (m) => providerFor(m, approvedVisionModel), chatRequest, { contextDiagnostics, commit, fallback, trace });
      return reply; // response already sent via raw stream
    }

    // Buffered path with the same failover semantics.
    const attempts = decision.ranked.slice(0, MAX_FAILOVER);
    const failed: string[] = [];
    for (const candidate of attempts) {
      try {
        const result = await providerFor(candidate, approvedVisionModel).complete(chatRequest);
        await commit?.(result.content, candidate.id, candidate.provider);
        await auditStore.append({
          correlationId: requestId,
          requestId,
          type: 'execution.completed',
          component: 'chat',
          outcome: 'ok',
          fields: { model: candidate.id, provider: candidate.provider, toolCalls: 0 },
        });
        // Slice 4 — a successful LOCAL coding turn records metadata-only usage with
        // a clearly-estimated avoided cloud cost.
        const localSavings = spec.preferCoding && providerRouting && escalation
          ? escalation.recordLocalUsage({ correlationId: requestId, providerId: candidate.provider, modelId: candidate.id, mode: 'chat', policy: String(fallback.policy ?? 'auto'), outcome: 'ok', request: chatRequest })
          : undefined;
        return {
          ok: true,
          model: candidate.id,
          provider: candidate.provider,
          tier: candidate.tier,
          conversationId: conv?.id,
          context: contextDiagnostics,
          routing: {
            reason: candidate.id === decision.model.id ? decision.reason : `failover → ${candidate.id}`,
            alternatives: decision.alternatives,
            failedOver: failed,
            ...(fallback.policy ? { policy: fallback.policy, requestedPolicy: fallback.requestedPolicy, effectivePolicy: fallback.effectivePolicy, policyReason: fallback.policyReason, fallbackRecommended: fallback.fallbackRecommended, fallbackReasons: fallback.reasons } : {}),
          },
          content: result.content,
          usage: { inputTokens: result.telemetry.inputTokens, outputTokens: result.telemetry.outputTokens, latencyMs: result.telemetry.latencyMs },
          ...(localSavings ? { localSavings } : {}),
        };
      } catch (error) {
        // A REFUSED DURABLE WRITE IS NOT A MODEL FAILURE. Swallowing it here
        // would retry the whole turn against the next candidate — burning
        // inference on a storage outage, and eventually reporting "every model
        // failed" for a database that would not open.
        if (error instanceof PersistenceUnavailableError) throw error;
        request.log.warn({ model: candidate.id, err: errText(error) }, 'ai/chat model failed; trying next');
        failed.push(candidate.id);
      }
    }
    // Slice 3 — every LOCAL candidate failed. For a coding turn, a defined reason
    // (LOCAL_MALFORMED_OUTPUT) may mint a cloud-escalation OFFER (no cloud call
    // here; approval is a separate /escalation/approve request). Impossible under
    // local-only / privacy.
    if (spec.preferCoding && providerRouting && escalation) {
      const off = await escalation.offer({ correlationId: requestId, policy: resolved?.effective ?? providerRouting.policy, outcome: { hadLocalModel: true, terminal: 'failed', output: '', errorMessage: 'local completion failed' }, request: chatRequest, requiredCaps: { coding: true, vision: spec.needsVision, tools: spec.needsTools } });
      if (off.offered) {
        await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat', outcome: 'ESCALATION_OFFERED' });
        return { ok: false, code: 'LOCAL_COMPLETION_FAILED', failedOver: failed, escalationOffer: { offerId: off.offerId, token: off.token, reason: off.reason, target: off.target, estimatedCostUsd: off.estimate?.estimatedCostUsd, worstCaseCostUsd: off.worstCaseCostUsd, costCeilingUsd: off.costCeilingUsd, remainingBudgetUsd: off.remainingBudgetUsd, dataLeavesLocal: off.dataLeavesLocal, expiresAt: off.expiresAt, request: chatRequest } };
      }
    }
    await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat', outcome: 'COMPLETION_FAILED' });
    reply.code(502);
    return { ok: false, code: 'COMPLETION_FAILED', error: 'The engine could not complete the request.', failedOver: failed };
  });

  // ── Embeddings ───────────────────────────────────────────────────────────────
  app.post<{ Body: AiEmbeddingsBody }>('/api/ai/embeddings', async (request, reply) => {
    const body = request.body ?? {};
    const input = body.input;
    if (!input || (Array.isArray(input) && input.length === 0)) {
      reply.code(400);
      return { ok: false, code: 'BAD_REQUEST', error: 'Provide `input` (string or string[]).' };
    }
    const decision = await selectModel(reg, { needsEmbedding: true, model: body.model, enforce: enforceQual, mode: 'production' });
    if (!decision) {
      reply.code(503);
      return { ok: false, code: 'NO_MODEL', error: 'No embedding model is available (e.g. `ollama pull nomic-embed-text`).' };
    }
    try {
      const res = await fetch(`${env.providerBaseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(env.openAiApiKey ? { Authorization: `Bearer ${env.openAiApiKey}` } : {}) },
        body: JSON.stringify({ model: decision.model.id, input }),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const data = (await res.json()) as { data?: Array<{ embedding: number[] }>; usage?: { prompt_tokens?: number } };
      return { ok: true, model: decision.model.id, provider: decision.model.provider, embeddings: (data.data ?? []).map((d) => d.embedding), usage: { inputTokens: data.usage?.prompt_tokens ?? 0 } };
    } catch (error) {
      request.log.warn({ model: decision.model.id, err: errText(error) }, 'ai/embeddings failed');
      reply.code(502);
      return { ok: false, code: 'COMPLETION_FAILED', error: 'The engine could not compute embeddings.' };
    }
  });

  return reg;

  async function buildChatRequest(
    body: AiChatBody,
    userPrompt: string,
    summary: string,
    ragChunks?: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number; source: 'embedding' }>,
    responseDirectives: string[] = [],
  ): Promise<ChatTurnRequest> {
    let retrievedChunks: ChatTurnRequest['context']['retrievedChunks'] = ragChunks;
    // ── The silent fallback that made "approved index" a preference ───────────
    // When approved retrieval returned nothing, this quietly replaced it with
    // WORKING-TREE lexical chunks carrying the same "cite these" instruction — so
    // an approved-only request could be answered from unapproved, uncommitted code
    // with no disclosure. An approved-only turn now never reaches here (it was
    // refused above); this guard makes that structural rather than incidental.
    // Gate the lexical fallback on the MODE, not on one boolean: `approved` refuses
    // above, and `none` must gather nothing at all.
    const requestedMode: GroundingMode = body.groundingMode ?? modeFromLegacy(body.requireApproved);
    if (requestedMode === 'approved' || requestedMode === 'none') {
      return finishChatRequest(body, userPrompt, summary, requestedMode === 'none' ? undefined : retrievedChunks, responseDirectives);
    }
    if (!retrievedChunks?.length && body.workspaceRoot) {
      try {
        const retrieveReq: RetrieveRequest = {
          query: userPrompt || 'attached file analysis',
          workspaceRoot: body.workspaceRoot,
          feature: 'chat',
          activeFile: body.activeFile,
          selectionText: body.selectionText,
          // Prior turns let a follow-up ("what ops does IT support?") anchor on
          // the earlier subject instead of drifting to unrelated files.
          conversationContext: summary || undefined,
          maxChunks: 6,
        };
        const r = await retrieveContext(retrieveReq);
        retrievedChunks = r.chunks;
      } catch {
        /* grounding is best-effort — never fail a turn on retrieval */
      }
    }
    return finishChatRequest(body, userPrompt, summary, retrievedChunks, responseDirectives);
  }

  function finishChatRequest(
    body: AiChatBody,
    userPrompt: string,
    summary: string,
    retrievedChunks: ChatTurnRequest['context']['retrievedChunks'],
    responseDirectives: string[] = [],
  ): ChatTurnRequest {
    return {
      feature: 'chat',
      modelProfile: 'default',
      systemPromptId: 'ai-chat-v1',
      userPrompt: userPrompt || 'Analyze the attached file(s).',
      context: {
        conversationSummary: summary || undefined,
        selectionText: body.selectionText,
        activeFile: body.activeFile,
        ...(retrievedChunks?.length ? { retrievedChunks } : {}),
        ...(body.attachments?.length ? { attachments: body.attachments } : {}),
        // Omitted entirely when empty, so a user who changed nothing leaves no
        // trace in the request or the prompt.
        ...(responseDirectives.length ? { responseDirectives } : {}),
      },
      /*
       * DELIBERATION IS OPT-IN, and this is why.
       *
       * `qwen3` thinks before it answers. Asked to "reply with exactly the word:
       * rendered" it produced 718 characters of internal monologue and then the
       * 8-character answer, taking 26.6s; with deliberation off the same prompt
       * answered identically in 0.81s. Traced end-to-end through the product, a
       * real browser turn spent 33.0s of 37.0s waiting for the first CONTENT
       * token while the model deliberated — the stream cannot yield a thinking
       * token, so the page simply sits there.
       *
       * Kept for the turns routed as reasoning: `needsReasoning`, or a `deep`
       * tier, is the caller saying the thinking is the point. Everything else —
       * ordinary chat — gets the answer.
       */
      reasoning:
        Boolean(body.needsReasoning) || tierFromHints(body) === 'deep' ? 'default' : 'none',
      outputMode: 'markdown',
    };
  }
}

/**
 * SSE image generation: `stage` frames while Studio works, then one `image`
 * frame, then `done`.
 *
 * STAGES ARE OBSERVED, NEVER INFERRED FROM ELAPSED TIME. A cold FLUX checkpoint
 * load off Studio's USB disk blocks its HTTP thread for minutes; a progress bar
 * invented from a timer would be lying during exactly the wait that needs
 * explaining. Each frame here corresponds to something that actually happened.
 *
 * A FAILURE IS AN `error` FRAME, NOT A SENTENCE ABOUT PHOTOSHOP. The whole point
 * of this path is that a request for a picture either produces a picture or says
 * truthfully why it could not.
 */
async function streamGeneration(
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
  prompt: string,
  trace?: BrainTurnTrace,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown): void => {
    try {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* connection gone */
    }
  };

  // Named immediately, before any wait: the client can say WHAT it is waiting
  // for rather than showing an unexplained spinner.
  send('route', { requestId, capability: 'image_generation', model: DEFAULT_STUDIO_CONFIG.checkpoint });
  send('stage', { stage: 'submitting', detail: 'Sending your prompt to the image pipeline' });

  const describe = (stage: GenerationStage): { stage: string; detail: string } => {
    switch (stage.kind) {
      case 'submitted':
        return { stage: 'queued', detail: 'Queued in the image pipeline' };
      case 'queued':
        return { stage: 'queued', detail: `Waiting behind ${stage.ahead} job(s)` };
      case 'running':
        // The honest description of a blocked HTTP thread: it IS loading.
        return { stage: 'generating', detail: 'Loading the image model and generating' };
      case 'downloading':
        return { stage: 'downloading', detail: 'Retrieving the finished image' };
    }
  };

  /*
   * The user's sentence is not a diffusion prompt. "generate letter A in png"
   * passed through verbatim produced four overlapping letterforms — a real PNG
   * of the wrong thing. Only the request grammar is removed and only a
   * single-character subject is expanded; a real description goes through as
   * written.
   */
  /*
   * A SINGLE CHARACTER IS DRAWN, NOT SAMPLED.
   *
   * "generate letter A in png" is not an artistic request, and diffusion cannot
   * be made to spell: the same shaped prompt produced a clean capital A at one
   * seed and four glyphs reading "a a I I" at another. A font already contains
   * the exact outline, so this path fills it instead — correct every time rather
   * than most times, in about 170ms rather than seconds of GPU, and with no
   * dependence on Studio being reachable at all.
   */
  const asked = describeImageRequest(prompt);
  if (asked.kind === 'glyph') {
    trace?.set('generator', 'deterministic');
    trace?.set('glyph', asked.text);
    send('stage', { stage: 'generating', detail: `Drawing “${asked.text}” from a typeface` });
    try {
      const drawn = renderTextGlyph(asked.text, { size: 1024, background: 'white' });
      trace?.mark('generation');
      trace?.set('image_bytes', drawn.png.byteLength);
      send('image', {
        mimeType: 'image/png',
        dataBase64: drawn.png.toString('base64'),
        bytes: drawn.png.byteLength,
        model: `typeface:${drawn.fontPath.split('/').pop() ?? 'unknown'}`,
        prompt: `the character ${asked.text}`,
        requestId,
      });
      send('done', {
        requestId,
        capability: 'image_generation',
        model: 'deterministic-glyph',
        timing: { totalMs: 0 },
      });
      trace?.finish('ok');
      raw.end();
      return;
    } catch (error) {
      /*
       * No usable typeface, or a character this font cannot draw. Said plainly
       * rather than silently falling back to a model that would produce
       * something that merely looks like the letter.
       */
      trace?.finish('glyph_unavailable');
      send('error', {
        code: 'IMAGE_GENERATION_FAILED',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'That character could not be drawn.',
      });
      raw.end();
      return;
    }
  }

  const shaped = shapeImagePrompt(prompt);
  trace?.set('generator', 'studio');
  trace?.set('shaped_prompt', shaped !== prompt);
  const result = await generateImage(shaped, DEFAULT_STUDIO_CONFIG, (stage) => send('stage', describe(stage)));
  trace?.mark('generation');

  if (!result.ok) {
    trace?.set('generation_failure', result.code);
    trace?.finish(`generation_${result.code}`);
    send('error', { code: 'IMAGE_GENERATION_FAILED', message: result.message });
    raw.end();
    return;
  }

  trace?.set('image_bytes', result.bytes);
  trace?.set('model', result.model);
  send('image', {
    mimeType: 'image/png',
    dataBase64: result.pngBase64,
    bytes: result.bytes,
    /*
     * PROVENANCE TRAVELS WITH THE BYTES. The consumer stores this on the image
     * record, which is what later makes "make the A blue" answerable: the
     * pipeline that ran, the run that produced it, and the prompt that was
     * actually sent — the shaped one, not the user's raw sentence, because that
     * is what would have to be varied to iterate on the picture.
     */
    model: result.model,
    runId: result.promptId,
    prompt: shaped,
    requestId,
  });
  send('done', {
    requestId,
    capability: 'image_generation',
    model: result.model,
    timing: { totalMs: result.elapsedMs },
  });
  trace?.finish('ok');
  raw.end();
}

/** SSE chat: emit a `route` frame once a model commits (after failover resolves),
 * then `token` frames, then `done` — or `error` (sanitized). Client disconnect
 * aborts upstream work and stops without a `done`, so a cancelled turn never
 * yields a false completed answer. */
async function streamChat(
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
  ranked: ModelDescriptor[],
  primaryReason: string,
  providerFor: (m: ModelDescriptor) => StreamingProvider,
  chatRequest: ChatTurnRequest,
  memory: { contextDiagnostics?: ContextDiagnostics; commit?: (text: string, modelId: string, providerId: string) => void; fallback?: { policy?: string; requestedPolicy?: string; effectivePolicy?: string; policyReason?: string; fallbackRecommended: boolean; reasons: string[] }; trace?: BrainTurnTrace } = {},
): Promise<void> {
  const trace = memory.trace;
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const ac = new AbortController();
  const cancelUpstream = (): void => ac.abort();
  request.raw.once('aborted', cancelUpstream);
  raw.once('close', () => {
    // A normal raw.end() also closes the response; only a premature close is a
    // cancellation signal. This is the event that observes an SSE client
    // disconnect after the inbound request body has already been consumed.
    if (!raw.writableEnded) cancelUpstream();
  });
  const send = (event: string, data: unknown): void => {
    try {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* connection gone */
    }
  };

  // The engine's chosen prior context, surfaced to the client as a sanitized
  // diagnostic BEFORE any token (explainable retrieval).
  if (memory.contextDiagnostics) send('context', memory.contextDiagnostics);

  const attempts = ranked.slice(0, MAX_FAILOVER);
  const failed: string[] = [];
  const primaryId = ranked[0]?.id;

  for (const candidate of attempts) {
    const provider = providerFor(candidate);
    let committed = false;
    let fullText = '';
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    /*
     * TIME TO FIRST TOKEN, measured rather than assumed.
     *
     * Total latency hides the number that decides whether the product feels
     * responsive: a 12s answer that starts drawing at 0.4s reads as fast, and the
     * same answer that appears all at once at 12s reads as broken. Measured from
     * the moment this turn begins routing, so it includes model load — which is
     * the dominant cost on a cold model and invisible in a total.
     */
    const turnStarted = Date.now();
    let firstTokenMs: number | undefined;
    const markFirstToken = () => {
      if (firstTokenMs === undefined) {
        firstTokenMs = Date.now() - turnStarted;
        trace?.mark('first_token');
      }
    };

    try {
      if (typeof provider.stream === 'function') {
        const gen = provider.stream(chatRequest, ac.signal);
        // Pull the first frame: this forces the upstream connection to open, so an
        // open/HTTP failure happens BEFORE we commit and can still fail over.
        const first = await gen.next();
        /*
         * THE STAGE THAT WAS INVISIBLE. Pulling the first frame is what forces
         * the provider to open its connection AND load the model, so a cold or
         * evicted model shows up here and nowhere else. A 90s turn with 600ms of
         * generation is entirely this line.
         */
        trace?.mark('upstream_open');
        send('route', routeFrame(requestId, candidate, primaryId, primaryReason, failed));
        committed = true;
        if (!first.done && first.value) {
          if (first.value.delta) { markFirstToken(); fullText += first.value.delta; send('token', { text: first.value.delta }); }
          if (first.value.usage) usage = first.value.usage;
        }
        for await (const ev of gen) {
          if (ev.delta) { markFirstToken(); fullText += ev.delta; send('token', { text: ev.delta }); }
          if (ev.usage) usage = ev.usage;
        }
      } else {
        const r = await provider.complete(chatRequest);
        send('route', routeFrame(requestId, candidate, primaryId, primaryReason, failed));
        committed = true;
        fullText = r.content;
        // Buffered: the whole answer arrives at once, so first token IS the end.
        markFirstToken();
        send('token', { text: r.content });
        usage = { inputTokens: r.telemetry.inputTokens, outputTokens: r.telemetry.outputTokens };
      }
      // Successful completion → commit the assistant message to memory (only here,
      // never on a partial/cancelled/failed stream).
      try {
        await memory.commit?.(fullText, candidate.id, candidate.provider);
      } catch (error) {
        if (!(error instanceof PersistenceUnavailableError)) throw error;
        // The tokens are already on the client's screen; the turn cannot be
        // un-answered. What CAN be done is refuse to pretend it was kept.
        send('error', {
          code: error.code,
          message: 'The answer was produced but could not be saved, so it will not be here after a reload.',
        });
      }
      await auditStore.append({
        correlationId: requestId,
        requestId,
        type: 'execution.completed',
        component: 'chat',
        outcome: 'ok',
        fields: { model: candidate.id, provider: candidate.provider, toolCalls: 0 },
      });
      send('done', { requestId, model: candidate.id, provider: candidate.provider, tier: candidate.tier, usage, failedOver: failed,
        timing: { firstTokenMs, totalMs: Date.now() - turnStarted }, ...(memory.fallback?.policy ? { policy: memory.fallback.policy, requestedPolicy: memory.fallback.requestedPolicy, effectivePolicy: memory.fallback.effectivePolicy, policyReason: memory.fallback.policyReason, fallbackRecommended: memory.fallback.fallbackRecommended, fallbackReasons: memory.fallback.reasons } : {}) });
      trace?.mark('generation');
      if (usage) trace?.set('tokens', usage);
      trace?.set('served_by', candidate.id);
      trace?.finish('ok');
      raw.end();
      return;
    } catch (error) {
      if (ac.signal.aborted) {
        // Client cancelled — no `done`, no false answer.
        await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat', outcome: 'cancelled', fields: { toolCalls: 0 } });
        trace?.finish('cancelled');
        raw.end();
        return;
      }
      if (committed) {
        // Already streaming this model when it broke — surface a sanitized error;
        // do NOT fail over mid-stream (tokens already emitted).
        request.log.warn({ model: candidate.id, err: errText(error) }, 'ai/chat stream broke mid-turn');
        await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat', outcome: 'STREAM_INTERRUPTED', fields: { model: candidate.id, toolCalls: 0 } });
        send('error', { code: 'COMPLETION_FAILED', message: 'The engine stream was interrupted.' });
        trace?.set('failed_model', candidate.id);
        trace?.finish('stream_interrupted');
        raw.end();
        return;
      }
      request.log.warn({ model: candidate.id, err: errText(error) }, 'ai/chat stream open failed; trying next');
      failed.push(candidate.id);
    }
  }
  await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat', outcome: 'COMPLETION_FAILED', fields: { toolCalls: 0 } });
  send('error', { code: 'COMPLETION_FAILED', message: 'The engine could not complete the request.', failedOver: failed });
  trace?.set('failed_over', failed);
  trace?.finish('completion_failed');
  raw.end();
}

function routeFrame(requestId: string, candidate: ModelDescriptor, primaryId: string | undefined, primaryReason: string, failed: string[]) {
  return {
    requestId,
    model: candidate.id,
    provider: candidate.provider,
    tier: candidate.tier,
    reason: candidate.id === primaryId ? primaryReason : `failover → ${candidate.id}`,
    failedOver: [...failed],
  };
}

/** Never leak stack traces or full provider bodies to clients — this is for
 * server-side logs only. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function normalizeConversation(body: AiChatBody): { userPrompt: string; summary: string } {
  if (body.messages?.length) {
    const msgs = body.messages;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const msg = msgs[i];
      if (msg && msg.role === 'user') {
        const prior = msgs.slice(0, i);
        const summary = prior.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 1500);
        return { userPrompt: msg.content, summary: body.conversationSummary ?? summary };
      }
    }
    return { userPrompt: (body.prompt ?? '').trim(), summary: body.conversationSummary ?? '' };
  }
  return { userPrompt: (body.prompt ?? '').trim(), summary: body.conversationSummary ?? '' };
}

function isCodingIntent(feature?: string, prompt?: string): boolean {
  if (feature && /fix|test|review|explain|refactor|commit/i.test(feature)) return true;
  return Boolean(prompt && /\bcode\b|function|bug|refactor|typescript|python|compile|stack trace/i.test(prompt));
}
