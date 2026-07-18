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
import { ModelRegistry, type ModelDescriptor, type ProviderSource } from './modelRegistry.js';
import { selectModel, tierFromHints, type RouteSpec } from './capabilityRouter.js';
import { selectLocalCoding, type LocalRoutingDeps } from './providers/localCodingRouter.js';
import { QualificationStore } from './qualificationStore.js';
import { ConversationStore, type Scope } from './memory/conversationStore.js';
import { buildContext, type ContextDiagnostics } from './memory/contextBuilder.js';
import { redactSecrets } from './memory/redaction.js';
import { scopeFrom } from './memory/memoryRoutes.js';
import { engineCorrelationId } from './toolRoutes.js';
import type { IndexService } from './rag/indexService.js';

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
  conversationSummary?: string;
  selectionText?: string;
  activeFile?: string;
  /** When set, the engine grounds the turn with repo retrieval (RAG). */
  workspaceRoot?: string;
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
  const providerFor = (model: ModelDescriptor): StreamingProvider => {
    if (providerOverride) return providerOverride(model);
    if (!real) return new StubProvider('default');
    return new OpenAiCompatProvider({
      profile: 'default',
      baseUrl: env.providerBaseUrl,
      model: model.id,
      visionModel: model.capabilities.vision ? model.id : undefined,
      apiKey: env.openAiApiKey,
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
    const defaultDecision = await selectModel(reg, { needsVision: true, tier: 'balanced', enforce: enforceQual, mode: 'production' });
    return {
      count: vision.length,
      enforced: enforceQual,
      default: defaultDecision?.model.id ?? null,
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

    const hasImage = (body.attachments ?? []).some((a) => IMAGE_MIME.test(a.mimeType));
    const spec: RouteSpec = {
      needsVision: hasImage,
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
    let fallback: { policy?: string; fallbackRecommended: boolean; reasons: string[] } = { fallbackRecommended: false, reasons: [] };
    if (spec.preferCoding && providerRouting) {
      const local = await selectLocalCoding(providerRouting, { preferCoding: true, needsVision: spec.needsVision, needsTools: spec.needsTools, needsReasoning: spec.needsReasoning, tier: spec.tier });
      const localIds = new Set(local.rankedLocalModels.map((m) => m.id));
      const localRanked = decision.ranked.filter((m) => localIds.has(m.id));
      if (localRanked.length > 0) {
        decision = { model: localRanked[0]!, reason: `local-first (${local.policy})`, alternatives: localRanked.slice(1).map((m) => m.id), ranked: localRanked };
      }
      fallback = { policy: local.policy, fallbackRecommended: local.fallbackRecommended, reasons: local.fallbackReasons };
    }

    // ── Conversation memory: the engine decides what prior context enters the
    // window and commits the completed assistant message. Opt-in by policy. ──
    const requestId = engineCorrelationId(request);
    const scope: Scope = scopeFrom(request);
    const policy = { mode: body.memoryPolicy?.mode ?? 'session', retrieve: body.memoryPolicy?.retrieve ?? true, store: body.memoryPolicy?.store ?? true };
    const conv = memoryStore && body.conversationId ? memoryStore.getConversation(body.conversationId, scope) : undefined;
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
      memoryStore!.appendMessage(conv!.id, scope, { role: 'user', content: redactSecrets(userPrompt).text, status: 'complete', requestId });
    }
    // Commit the assistant message ONLY on successful completion — never a
    // partial/cancelled/failed response.
    const commit = memoryActive && policy.store
      ? (text: string, modelId: string, providerId: string): void => {
          if (!text.trim()) return;
          memoryStore!.appendMessage(conv!.id, scope, { role: 'assistant', content: redactSecrets(text).text, status: 'complete', requestId, modelId, providerId });
        }
      : undefined;

    // ── Semantic RAG: only an APPROVED index for this workspace backs production
    // chat (fail-closed — no approved index ⇒ no RAG). Retrieved chunks are cited
    // and the model is told to distinguish evidence from inference. ──
    let ragChunks: Array<{ path: string; startLine: number; endLine: number; snippet: string; score: number; source: 'embedding' }> | undefined;
    if (indexService && userPrompt && policy.retrieve !== false) {
      const approvedId = indexService.approvedIndexFor(scope);
      if (approvedId) {
        const rag = await indexService.retrieve(approvedId, scope, userPrompt, { maxChunks: 6, tokenBudget: 2000, requireApproved: true }).catch(() => null);
        if (rag && rag.ok && rag.chunks.length) {
          ragChunks = rag.chunks.map((c) => ({ path: c.filePath, startLine: c.startLine, endLine: c.endLine, snippet: c.snippet, score: c.score, source: 'embedding' as const }));
          const cites = rag.chunks.map((c) => `${c.filePath}:${c.startLine}-${c.endLine}`).join(', ');
          effectiveSummary = `Retrieved workspace evidence (cite these when stating repository facts; do NOT claim a repo fact without a cited source; distinguish retrieved evidence from your own inference): ${cites}\n\n${effectiveSummary}`;
        }
      }
    }

    const chatRequest = await buildChatRequest(body, userPrompt, effectiveSummary, ragChunks);

    if (body.stream) {
      await streamChat(request, reply, decision.ranked, decision.reason, providerFor, chatRequest, { contextDiagnostics, commit, fallback });
      return reply; // response already sent via raw stream
    }

    // Buffered path with the same failover semantics.
    const attempts = decision.ranked.slice(0, MAX_FAILOVER);
    const failed: string[] = [];
    for (const candidate of attempts) {
      try {
        const result = await providerFor(candidate).complete(chatRequest);
        commit?.(result.content, candidate.id, candidate.provider);
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
            ...(fallback.policy ? { policy: fallback.policy, fallbackRecommended: fallback.fallbackRecommended, fallbackReasons: fallback.reasons } : {}),
          },
          content: result.content,
          usage: { inputTokens: result.telemetry.inputTokens, outputTokens: result.telemetry.outputTokens, latencyMs: result.telemetry.latencyMs },
        };
      } catch (error) {
        request.log.warn({ model: candidate.id, err: errText(error) }, 'ai/chat model failed; trying next');
        failed.push(candidate.id);
      }
    }
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
  ): Promise<ChatTurnRequest> {
    let retrievedChunks: ChatTurnRequest['context']['retrievedChunks'] = ragChunks;
    if (!retrievedChunks?.length && body.workspaceRoot) {
      try {
        const retrieveReq: RetrieveRequest = {
          query: userPrompt || 'attached file analysis',
          workspaceRoot: body.workspaceRoot,
          feature: 'chat',
          activeFile: body.activeFile,
          selectionText: body.selectionText,
          maxChunks: 6,
        };
        const r = await retrieveContext(retrieveReq);
        retrievedChunks = r.chunks;
      } catch {
        /* grounding is best-effort — never fail a turn on retrieval */
      }
    }
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
      },
      outputMode: 'markdown',
    };
  }
}

/** SSE chat: emit a `route` frame once a model commits (after failover resolves),
 * then `token` frames, then `done` — or `error` (sanitized). Client disconnect
 * aborts upstream work and stops without a `done`, so a cancelled turn never
 * yields a false completed answer. */
async function streamChat(
  request: FastifyRequest,
  reply: FastifyReply,
  ranked: ModelDescriptor[],
  primaryReason: string,
  providerFor: (m: ModelDescriptor) => StreamingProvider,
  chatRequest: ChatTurnRequest,
  memory: { contextDiagnostics?: ContextDiagnostics; commit?: (text: string, modelId: string, providerId: string) => void; fallback?: { policy?: string; fallbackRecommended: boolean; reasons: string[] } } = {},
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const ac = new AbortController();
  request.raw.on('close', () => ac.abort());
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
    try {
      if (typeof provider.stream === 'function') {
        const gen = provider.stream(chatRequest, ac.signal);
        // Pull the first frame: this forces the upstream connection to open, so an
        // open/HTTP failure happens BEFORE we commit and can still fail over.
        const first = await gen.next();
        send('route', routeFrame(candidate, primaryId, primaryReason, failed));
        committed = true;
        if (!first.done && first.value) {
          if (first.value.delta) { fullText += first.value.delta; send('token', { text: first.value.delta }); }
          if (first.value.usage) usage = first.value.usage;
        }
        for await (const ev of gen) {
          if (ev.delta) { fullText += ev.delta; send('token', { text: ev.delta }); }
          if (ev.usage) usage = ev.usage;
        }
      } else {
        const r = await provider.complete(chatRequest);
        send('route', routeFrame(candidate, primaryId, primaryReason, failed));
        committed = true;
        fullText = r.content;
        send('token', { text: r.content });
        usage = { inputTokens: r.telemetry.inputTokens, outputTokens: r.telemetry.outputTokens };
      }
      // Successful completion → commit the assistant message to memory (only here,
      // never on a partial/cancelled/failed stream).
      memory.commit?.(fullText, candidate.id, candidate.provider);
      send('done', { model: candidate.id, provider: candidate.provider, tier: candidate.tier, usage, failedOver: failed, ...(memory.fallback?.policy ? { policy: memory.fallback.policy, fallbackRecommended: memory.fallback.fallbackRecommended, fallbackReasons: memory.fallback.reasons } : {}) });
      raw.end();
      return;
    } catch (error) {
      if (ac.signal.aborted) {
        // Client cancelled — no `done`, no false answer.
        raw.end();
        return;
      }
      if (committed) {
        // Already streaming this model when it broke — surface a sanitized error;
        // do NOT fail over mid-stream (tokens already emitted).
        request.log.warn({ model: candidate.id, err: errText(error) }, 'ai/chat stream broke mid-turn');
        send('error', { code: 'COMPLETION_FAILED', message: 'The engine stream was interrupted.' });
        raw.end();
        return;
      }
      request.log.warn({ model: candidate.id, err: errText(error) }, 'ai/chat stream open failed; trying next');
      failed.push(candidate.id);
    }
  }
  send('error', { code: 'COMPLETION_FAILED', message: 'The engine could not complete the request.', failedOver: failed });
  raw.end();
}

function routeFrame(candidate: ModelDescriptor, primaryId: string | undefined, primaryReason: string, failed: string[]) {
  return {
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
