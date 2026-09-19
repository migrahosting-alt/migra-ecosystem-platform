import { allowRemoteModelsFromEnv } from '../models/eligibilityPolicy.js';
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
import type { BrainEnv } from '../../config/env.js';
import type { ProviderAdapter } from '../../providers/providerRegistry.js';
import { StubProvider } from '../../providers/providerRegistry.js';
import { OpenAiCompatProvider } from '../../providers/openAiCompatProvider.js';
import { retrieveContext } from '../../retrieval/retrieve.js';
import {
  DEFAULT_MIN_APPROVED_SCORE,
  decideGrounding,
  groundingAuditFields,
  modeFromLegacy,
  refusalMessage,
  type GroundingDecision,
  type GroundingMode,
} from '../grounding/groundingDecision.js';
import { ModelRegistry, type ModelDescriptor, type ProviderSource } from '../models/modelRegistry.js';
import { selectModel, tierFromHints, type RouteSpec } from '../models/capabilityRouter.js';
import { selectLocalCoding, type LocalRoutingDeps } from '../providers/localCodingRouter.js';
import { resolveEffectivePolicy } from '../providers/executionPolicy.js';
import type { EscalationController } from '../providers/escalationController.js';
import { QualificationStore } from '../models/qualificationStore.js';
import { ConversationStore, PersistenceUnavailableError, type Scope } from '../memory/conversationStore.js';
import { buildContext, type ContextDiagnostics } from '../memory/contextBuilder.js';
import { redactSecrets } from '../memory/redaction.js';
import { scopeFrom } from '../memory/memoryRoutes.js';
import { capabilityContext, capabilityOwnedAnswer, capabilityPayload, runChatCapabilities } from './chatCapabilities.js';
import { chatGroundingFor, verifyChatAnswer } from './chatGrounding.js';
import { engineCorrelationId } from '../tools/toolRoutes.js';
import { BrainTurnTrace } from '../observability/turnTrace.js';

import { DEFAULT_STUDIO_CONFIG, generateImage, type GenerationStage } from '../media/studioImage.js';
import { describeImageRequest, shapeImagePrompt } from '../media/imagePrompt.js';
import { classifyImageTurn } from '../media/generationIntent.js';

/**
 * Is there an image editor behind a `transform` turn?
 *
 * No, and saying so honestly is the whole point. Kept as a function so the day
 * an edit pipeline is wired, this answers from its configuration and the
 * refusal disappears by itself.
 */
function imageEditingAvailable(): boolean {
  return false;
}
import { renderTextGlyph } from '../media/glyphRender.js';
import type { IndexService } from '../rag/indexService.js';
import { auditStore } from '../observability/auditLog.js';
import { gateVisionTurn, visionCapabilitySnapshot, approvedByCapability, type VisionGateDeps } from '../media/visionGate.js';
import { checkApprovalIntegrity, INTEGRITY_REASON_TEXT } from '../models/approvalIntegrity.js';
import { documentReaderCapability } from '../rag/documentReaderCapability.js';
import { resolveFamiliesForSurface, resolveFamily } from '../models/modelFamilyResolver.js';
import { decideOrchestration } from '../orchestration/decide.js';
import type { OrchestrationRequest } from '@migrapilot/shared-types/orchestration-decision';
import { MEASURED_GRANTS } from '../capability/capabilityGrants.js';
import {
  familiesForSurface,
  MIGRA_MODEL_CATALOG_REVISION,
  MIGRA_MODEL_FAMILIES,
  type MigraProductSurface,
  type MigraModelFamilyId,
} from '@migrapilot/shared-types/model-families';
import { classifyProviderFailure } from '../observability/providerFailure.js';
import { AdmissionGate, isModelResident, type AdmissionDecision } from '../admission/index.js';

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
  /**
   * The Migra family the USER chose, e.g. `migra-forge`.
   *
   * A product identity, not a model. It is resolved here through the canonical
   * resolver so the mapping stays governed and replaceable — a surface that sent
   * a backend id instead would pin the product to one model and bypass every
   * approval decision behind it.
   */
  modelFamily?: string;
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
/**
 * Whether models that run off this machine may be routed to.
 *
 * Off unless an operator says otherwise. Read here rather than threaded through
 * `BrainEnv` because it is a deployment policy, not a turn-level option a
 * caller can set.
 */
function allowRemoteModels(): boolean {
  return allowRemoteModelsFromEnv();
}

export function buildEngineModelRegistry(env: BrainEnv, qualStore?: QualificationStore): ModelRegistry {
  const real = env.localProvider === 'openai-compat';
  const qual = qualStore ?? new QualificationStore();
  return new ModelRegistry(
    real
      ? { sources: sourcesFromEnv(env), qualify: (id) => qual.get(id), allowRemote: allowRemoteModels() }
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
        ? { sources: sourcesFromEnv(env), qualify: (id) => qual.get(id), allowRemote: allowRemoteModels() }
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

  /*
   * The capacity reading, built once so chat and /health cannot disagree.
   *
   * `real` mirrors providerFor: with a stub provider there is no GPU to be busy,
   * and gating tests behind a probe of a machine that is not there would make
   * the suite depend on the workstation being awake.
   */
  const chatAdmissionGate = new AdmissionGate({
    providerBaseUrl: env.providerBaseUrl,
    ...(process.env.MIGRAPILOT_STUDIO_URL ? { studioBaseUrl: process.env.MIGRAPILOT_STUDIO_URL } : {}),
    enabled: real,
  });
  /* Built ONCE and shared with the engineer path's sibling gate: both reach the
   * same card, and a per-request gate would throw away the cache and the
   * single-flight latch that stop the probe amplifying the contention it reads. */
  const capacityProbe = real
    ? (model?: string) => chatAdmissionGate.admit({ ...(model ? { model } : {}) })
    : undefined;

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
  /*
   * MIGRA MODELS v1 — the one endpoint every surface derives its selector from.
   *
   * Returns the canonical catalog PLUS what each family resolves to right now,
   * so the consumer and the extension cannot drift into two different lists or
   * two different ideas of what is available. Backend ids appear here under
   * `selectedBackend` for provenance and diagnostics; they are deliberately NOT
   * what a surface shows as the choice.
   */
  /*
   * ORCHESTRATION — the Brain's routing answer, and the only one a client acts on.
   *
   * Deliberately a decision rather than an execution: the client already holds
   * the workspace and already executes delegated tools, so having it EXECUTE the
   * sequence the Brain ORDERED keeps the authority split intact. What it must
   * never do again is decide the sequence.
   *
   * `surface` is recorded for provenance and is not read when deciding. A
   * decision that varied by surface would recreate "consumer = planner,
   * extension = builder" through the back door.
   */
  app.post('/api/ai/orchestrate', async (request, reply) => {
    const body = (request.body ?? {}) as Partial<OrchestrationRequest>;
    if (typeof body.objective !== 'string' || !body.objective.trim()) {
      reply.code(400);
      return { ok: false, code: 'INVALID_INPUT', error: 'objective is required.' };
    }
    const decision = decideOrchestration({
      objective: body.objective,
      attachmentMimeTypes: Array.isArray(body.attachmentMimeTypes) ? body.attachmentMimeTypes : [],
      // An absent authority is NO authority, never an assumed one.
      authority: body.authority ?? { kind: 'none' },
      surface: body.surface === 'migrapilot-consumer' ? 'migrapilot-consumer' : 'vscode-extension',
    });
    return decision;
  });

  app.get('/api/ai/model-families', async (request, reply) => {
    /*
     * VALIDATE THE SURFACE — an unknown one is a 400, not an empty list.
     *
     * It previously fell through to a cast and returned `families: []` while
     * echoing the bogus name back as if it were real. A caller asking for
     * "consumer" therefore rendered an EMPTY selector and looked like a product
     * with no models, which is indistinguishable from everything being
     * unavailable. A typo in a surface name must fail loudly at the boundary.
     *
     * `consumer` is accepted as a documented alias because it is the obvious
     * short form and was already in use; it resolves to the canonical id rather
     * than becoming a second surface with its own list.
     */
    const raw = String((request.query as { surface?: string })?.surface ?? 'vscode-extension').trim();
    const ALIASES: Record<string, MigraProductSurface> = {
      consumer: 'migrapilot-consumer',
      'migrapilot-consumer': 'migrapilot-consumer',
      extension: 'vscode-extension',
      'vscode-extension': 'vscode-extension',
    };
    const surface = ALIASES[raw];
    if (!surface) {
      reply.code(400);
      return {
        ok: false,
        code: 'UNKNOWN_SURFACE',
        error: `Unknown surface "${raw}". Valid: ${[...new Set(Object.values(ALIASES))].join(', ')}.`,
      };
    }
    const models = await reg.list();
    /*
     * Ask governance about exactly the capabilities THE CATALOG declares.
     *
     * Derived from the catalog rather than listed here, so a family that starts
     * requiring a new capability is answered correctly with no change to this
     * route — which is the whole point of the families being a contract.
     */
    const declared = [
      ...new Set(
        familiesForSurface(surface)
          .map((f) => f.requirements.governedCapability)
          .filter((c): c is string => Boolean(c)),
      ),
    ];
    const rawGoverned = visionDeps
      ? await approvedByCapability(visionDeps, declared as never)
      : new Map<string, { qualified: boolean; modelId: string | null; digest: string | null }>();

    /*
     * 🚨 AN APPROVAL IS FOR BYTES, NOT FOR A NAME — AND UNTIL NOW NOTHING CHECKED.
     *
     * The decision has always stored the digest it was granted against, and the
     * approve route has always refused evidence without one, precisely because
     * "a tag can be repointed at different weights afterwards". Nothing ever
     * compared it to the installed model, so that exact failure was live: pull
     * the same tag, get different bytes, and yesterday's approval covers them.
     *
     * FAIL CLOSED, including when the answer is "I cannot tell". A governed
     * capability that cannot verify its own integrity declines rather than
     * assumes — otherwise its guarantee quietly degrades to "probably".
     */
    const liveDigest = (modelId: string): string | undefined => {
      const m = models.find((x) => x.id === modelId);
      return m ? (m.digest ?? '') : undefined;   // '' = present but unverifiable
    };
    const integrityRefusals = new Map<string, string>();
    const governedByCapability = new Map<string, { qualified: boolean; modelId: string | null; digest: string | null }>();
    for (const [capability, decision] of rawGoverned) {
      if (!decision.qualified || !decision.modelId) {
        governedByCapability.set(capability, decision);
        continue;
      }
      const verdict = checkApprovalIntegrity(
        { modelId: decision.modelId, modelDigest: decision.digest ?? undefined },
        liveDigest,
      );
      if (verdict.ok) {
        governedByCapability.set(capability, decision);
        continue;
      }
      // Refused, and the reason travels with it so the family can say WHY
      // rather than collapsing to "no approved model".
      integrityRefusals.set(capability, INTEGRITY_REASON_TEXT[verdict.reason]);
      governedByCapability.set(capability, { qualified: false, modelId: null, digest: null });
      const correlationId = engineCorrelationId(request);
      await auditStore.append({
        correlationId,
        requestId: correlationId,
        type: 'qualification.integrity_refused',
        component: 'governance',
        fields: {
          capability, modelId: decision.modelId,
          reason: verdict.reason, detail: verdict.detail,
        },
      }).catch(() => {});
    }

    const resolutions = resolveFamiliesForSurface(surface, {
      models,
      // A durable human decision, not a capability flag.
      /*
       * GENERIC, not a list of known capabilities.
       *
       * An if/else over capability names would be the same hard-coded truth in a
       * different shape: adding a governed capability would then require editing
       * this route, and until someone did, a family declaring it would silently
       * resolve as if no governance existed. The decision table is queried by
       * whatever name the catalog declares.
       */
      governedDecision: (capability) => governedByCapability.get(capability),
      // Only models carrying an APPROVED grant for that task class.
      // MEASURED_GRANTS is one entry per (model, task class) WITH evidence, so the
      // approved set is derived from actual measurements rather than a policy list.
      approvedForTaskClass: (taskClass) =>
        MEASURED_GRANTS.filter((g) => g.taskClass === taskClass).map((g) => g.model),
      /*
       * Runnable under the CURRENT policy, not merely listed.
       *
       * Ollama surfaces its cloud-hosted models (`…-cloud`) in the same catalog
       * as local ones, and this deployment runs local-only — the router itself
       * reports "Cloud providers are disabled or unavailable". Offering one would
       * make four families look available while every turn failed, which is
       * exactly the fake readiness this catalog forbids. The suffix is Ollama's
       * own convention; the check fails CLOSED because wrongly excluding a usable
       * model is far cheaper than wrongly offering an unusable one.
       */
      executable: (m) => !/-cloud$/i.test(m.id),
      // Exactly the rule the router applies: under enforcement, only an approved
      // model may run. Without this the catalog names one backend and the turn
      // executes another.
      routerAccepts: (m) => !enforceQual || m.qualification?.state === 'approved',
    });

    return {
      catalogRevision: MIGRA_MODEL_CATALOG_REVISION,
      surface,
      families: familiesForSurface(surface).map((f) => {
        const r = resolutions.find((x) => x.family === f.id)!;
        return {
          id: f.id,
          displayName: f.displayName,
          tagline: f.tagline,
          description: f.description,
          recommended: Boolean(f.recommended),
          // Live resolution — computed now, never asserted by the catalog.
          available: r.available,
          governed: r.governed,
          /*
           * An integrity refusal is a DIFFERENT fact from "nobody approved one",
           * and the operator action is different too — requalify vs qualify. It
           * replaces the resolver's generic sentence rather than sitting beside
           * it, so the user is told the specific truth.
           */
          ...(integrityRefusals.has(f.requirements.governedCapability ?? '')
            ? { unavailableReason: integrityRefusals.get(f.requirements.governedCapability ?? '')! }
            : r.unavailableReason ? { unavailableReason: r.unavailableReason } : {}),
          ...(r.selectedBackend ? { selectedBackend: r.selectedBackend } : {}),
          ...(r.basis ? { basis: r.basis } : {}),
        };
      }),
    };
  });

  /*
   * WHAT THIS HOST CAN ACTUALLY READ — measured, not declared.
   *
   * The consumer answered "Reading documents you attach — yes. PDF, …" from a
   * hard-coded format list. On a host without pdfinfo/pdftoppm/tesseract that
   * sentence is half false: a text-layer PDF reads, a scanned one cannot be
   * read at all. Declared support is not capability; capability is declared
   * support AND runtime dependencies AND configuration.
   */
  app.get('/api/ai/document-reader', async () => documentReaderCapability());

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
     * WHAT THE USER ASKED FOR, decided before anything is gated on the presence
     * of a picture. An explicit request to CREATE outranks an image that merely
     * happens to be in scope: "generate letter C in png" sent after an upload
     * used to be answered as a question about the upload, because the route was
     * gated on `!hasImage` and the user's verb never got a vote.
     */
    const imageTurn = classifyImageTurn(userPrompt, hasImage);
    const wantsNewImage = imageTurn === 'create';

    /*
     * FAIL CLOSED ON A CAPABILITY THAT DOES NOT EXIST.
     *
     * Classifying a turn as `transform` and then handing it to a text model is
     * worse than not classifying it: asked to "make this one blue", the model
     * cheerfully answered "Sure! Here's the text in blue: blue" — an invented
     * edit result for an edit that never happened. A router that identifies an
     * operation it cannot perform must say so, not improvise.
     *
     * A CONDITION, NOT A HARDCODED REFUSAL. When an edit pipeline is wired this
     * becomes the check for it, and the refusal stops firing on its own rather
     * than needing to be hunted down and removed.
     */
    if (imageTurn === 'transform' && !imageEditingAvailable()) {
      await auditStore.append({
        correlationId: requestId,
        requestId,
        type: 'capability.refused',
        component: 'chat',
        outcome: 'IMAGE_EDITING_UNAVAILABLE',
        fields: { operation: 'image.transform' },
      });
      trace.set('capability', 'image_transform');
      trace.mark('route');
      reply.code(422);
      return {
        ok: false,
        code: 'IMAGE_EDITING_UNAVAILABLE',
        error:
          'I can understand the image, but image editing is not available in MigraPilot yet. ' +
          'I can generate a new image based on your requested change instead.',
        operation: 'image.transform',
      };
    }

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
    // A turn that asks for a NEW picture is not a vision turn, even with an image
    // attached — gating it on vision qualification would refuse a creation
    // request for failing a test about reading the old image.
    if (hasImage && visionDeps && !wantsNewImage) {
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
    trace.set('image_turn', imageTurn);
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

    /*
     * RESOLVE THE REQUESTED FAMILY, OR REFUSE.
     *
     * A family that cannot be served must fail the turn, not quietly fall
     * through to whatever tier-matching finds. The user asked for a capability;
     * answering from something else while keeping the label is the substitution
     * this whole layer exists to forbid. Provenance keeps requested and executed
     * separate, so a divergence stays visible rather than being reconciled away.
     */
    let requestedFamily: string | undefined;
    if (body.modelFamily) {
      requestedFamily = body.modelFamily;
      /*
       * The SAME inputs the catalog endpoint uses, resolved the SAME generic way.
       *
       * A family must not resolve one way when listed and another way when
       * actually used — that is drift inside a single request, and it is exactly
       * what an if/else over capability names produces the moment the two lists
       * fall out of step.
       */
      const capability = MIGRA_MODEL_FAMILIES[body.modelFamily as MigraModelFamilyId]
        ?.requirements.governedCapability;
      const governedForTurn =
        visionDeps && capability
          ? await approvedByCapability(visionDeps, [capability] as never)
          : new Map<string, { qualified: boolean; modelId: string | null; digest: string | null }>();
      const resolved = resolveFamily(body.modelFamily as MigraModelFamilyId, {
        models: await reg.list(),
        governedDecision: (cap: string) => governedForTurn.get(cap),
        approvedForTaskClass: (taskClass: string) =>
          MEASURED_GRANTS.filter((g) => g.taskClass === taskClass).map((g) => g.model),
        executable: (m: ModelDescriptor) => !/-cloud$/i.test(m.id),
        routerAccepts: (m: ModelDescriptor) => !enforceQual || m.qualification?.state === 'approved',
      });
      if (!resolved.available || !resolved.selectedBackend) {
        reply.code(409);
        return {
          ok: false,
          code: 'FAMILY_UNAVAILABLE',
          family: body.modelFamily,
          error: resolved.unavailableReason ?? 'That model family has no qualified path right now.',
        };
      }
      spec.model = resolved.selectedBackend;
      spec.governedApproval = resolved.governed ? resolved.selectedBackend : undefined;
    }

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
    if (wantsNewImage && body.stream) {
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
    /*
     * ── The capability half of the turn ──────────────────────────────────
     *
     * 🚨 BEFORE REPOSITORY PLANNING, WHICH IS THE WHOLE POINT OF THE ORDER.
     *
     * A mailbox question that pre-loads source files hands the model
     * repository evidence to answer from, and it will: the retrieved code is
     * right there and the mailbox is not. So the capability decision runs
     * first and can say "do not plan repository evidence for this turn".
     *
     * Everything capability-specific lives behind this one call. The route
     * learns a plan, some evidence and a caveat — never an operation, a
     * provider, or a message id.
     */
    const capabilityTurn = userPrompt
      ? await runChatCapabilities({
        prompt: userPrompt,
        scope,
        conversationId: conv?.id ?? body.conversationId ?? requestId,
        turnId: requestId,
        requestId,
      })
      : null;
    if (capabilityTurn) {
      const context = capabilityContext(capabilityTurn);
      // Prepended, so it sits closest to the question it answers.
      if (context) effectiveSummary = `${context}\n\n${effectiveSummary}`;
      trace.mark('capabilities');
    }

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
    /*
     * 🚨 `repoPlanning === false` MEANS THE REQUEST WAS ABOUT SOMETHING ELSE.
     * It is set only when a capability was actually selected, so a repository
     * question — or any turn with no capabilities wired — reaches the index
     * exactly as it always has.
     */
    const planRepoEvidence = capabilityTurn?.turn.repoPlanning !== false;
    if (indexService && userPrompt && policy.retrieve !== false && planRepoEvidence) {
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
            return rag.chunks.map((c) => ({
              path: c.filePath, startLine: c.startLine, endLine: c.endLine,
              snippet: c.snippet, score: c.score,
              // Carried, not inferred — this is the page the chunk was indexed from.
              ...(c.symbol ? { location: c.symbol } : {}),
            }));
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

    /*
     * ── The grounding gate for this turn ─────────────────────────────────
     *
     * 🚨 DECIDED ONCE, HERE, SO THE TWO ANSWER PATHS CANNOT DISAGREE. Streaming
     * and buffered are separate code paths in this route, and a gate wired into
     * one of them is a gate with a documented way around it — ask for
     * `stream: true` and the check is gone.
     *
     * Null means the turn retrieved no capability evidence, and repository-only
     * chat behaves exactly as it always has.
     */
    /*
     * ── The capability owns this answer ──────────────────────────────────
     *
     * 🚨 NO MODEL CALL AT ALL. The facts are typed and the text was rendered
     * from them by code, so there is nothing here for a model to improve that
     * it could not also corrupt — and everything that went wrong in owner
     * acceptance was corruption of exactly this kind: an invented filename, a
     * list missing its first entry, a flat refusal, all from the same correct
     * retrieval.
     *
     * It is also not sent through the grounding gate. The gate exists to check
     * GENERATED prose against evidence; this text was not generated, and
     * re-verifying it would only reintroduce the stochastic refusal it was
     * written to remove.
     */
    const ownedAnswer = capabilityTurn ? capabilityOwnedAnswer(capabilityTurn) : null;
    /*
     * 🚨 A HYBRID TURN'S FACTS ARE FIXED BEFORE A TOKEN IS GENERATED. The model
     * still writes — it may explain, contextualise, answer the narrow question
     * — but it writes AROUND this block. If everything it writes is refused,
     * the payload stands on its own, which is why a figure can no longer go
     * missing because of how a sentence came out.
     */
    const payload = capabilityTurn ? capabilityPayload(capabilityTurn) : null;

    const groundingSources = chatGroundingFor({ capability: capabilityTurn, ragChunks });
    const verifyFinalAnswer = groundingSources
      ? (raw: string) => verifyChatAnswer(raw, groundingSources)
      : undefined;

    trace.mark('context')
    const chatRequest = await buildChatRequest(body, userPrompt, effectiveSummary, ragChunks, directives);
    trace.mark('request_built');
    await auditStore.append({
      correlationId: requestId,
      requestId,
      type: 'execution.routed',
      component: 'chat',
      fields: {
        /*
         * REQUESTED AND EXECUTED, KEPT APART.
         *
         * `requestedFamily` is what the user asked for; `model` is what actually
         * ran. They are recorded as separate fields on purpose — collapsing them
         * into one "model" line is how a divergence stops being visible, and a
         * divergence is exactly the thing an audit needs to see.
         */
        ...(requestedFamily ? { requestedFamily } : {}),
        model: decision.model.id,
        provider: decision.model.provider,
        toolsRequested: spec.needsTools,
      },
    });

    /*
     * 🚨 EMITTED HERE, BEFORE ANY GENERATION. Placed after routing is decided
     * so the audit trail still records what WOULD have served the turn, and
     * before a single token is requested, because a capability-owned answer
     * that still paid for inference would be the same design mistake wearing a
     * cheaper hat.
     */
    if (ownedAnswer) {
      trace.set('answer_owner', 'capability');
      await commit?.(ownedAnswer, decision.model.id, decision.model.provider);
      await auditStore.append({
        correlationId: requestId, requestId, type: 'execution.completed', component: 'chat',
        outcome: 'ok',
        fields: { model: 'capability-owned', provider: 'engine', toolCalls: 0 },
      });
      trace.mark('generation');
      trace.finish('ok');
      if (body.stream) {
        return streamOwnedAnswer(request, reply, requestId, ownedAnswer, contextDiagnostics);
      }
      return {
        ok: true,
        model: 'capability-owned',
        provider: 'engine',
        tier: decision.model.tier,
        conversationId: conv?.id,
        context: contextDiagnostics,
        routing: { reason: 'answered by the capability that retrieved it', alternatives: [], failedOver: [] },
        content: ownedAnswer,
        usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      };
    }

    if (body.stream) {
      await streamChat(request, reply, requestId, decision.ranked, decision.reason,
        (m) => providerFor(m, approvedVisionModel), chatRequest,
        { contextDiagnostics, commit, fallback, trace, capacityProbe, verifyFinalAnswer, payload });
      return reply; // response already sent via raw stream
    }

    // Buffered path with the same failover semantics.
    const attempts = decision.ranked.slice(0, MAX_FAILOVER);
    const failed: string[] = [];
    /* Kept so the terminal error can name a cause the user can act on. */
    let lastError: string | undefined;
    for (const candidate of attempts) {
      try {
        const result = await providerFor(candidate, approvedVisionModel).complete(chatRequest);
        /*
         * 🚨 VERIFIED BEFORE IT IS KEPT, and kept as what was verified. Storing
         * the model's raw text and returning the checked one would put an
         * unverified answer in the conversation, where the next turn reads it
         * back as context and the gate never sees it again.
         */
        const checked = verifyFinalAnswer?.(result.content);
        const generated = checked ? checked.text : result.content;
        // 🚨 PAYLOAD FIRST, AND NEVER REGENERATED.
        const answerText = payload
          ? [payload, checked?.refused ? '' : generated].filter((p) => p && p.trim()).join('\n\n')
          : generated;
        if (checked) trace.set('grounding', { removed: checked.removed, refused: checked.refused });
        await commit?.(answerText, candidate.id, candidate.provider);
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
          content: answerText,
          usage: { inputTokens: result.telemetry.inputTokens, outputTokens: result.telemetry.outputTokens, latencyMs: result.telemetry.latencyMs },
          ...(localSavings ? { localSavings } : {}),
        };
      } catch (error) {
        // A REFUSED DURABLE WRITE IS NOT A MODEL FAILURE. Swallowing it here
        // would retry the whole turn against the next candidate — burning
        // inference on a storage outage, and eventually reporting "every model
        // failed" for a database that would not open.
        if (error instanceof PersistenceUnavailableError) throw error;
        lastError = errText(error);
        request.log.warn({ model: candidate.id, err: lastError }, 'ai/chat model failed; trying next');
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
    const failure = classifyProviderFailure(lastError);
    return { ok: false, code: failure.code, error: failure.message, failedOver: failed };
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

  /*
   * The generator is named AFTER the request is classified, because a single
   * character is drawn from a typeface and never reaches Studio. Announcing the
   * diffusion checkpoint first was a small lie in the record: the frame named a
   * model the turn was not going to use.
   */
  const asked = describeImageRequest(prompt);
  const usesTypeface = asked.kind === 'glyph';
  send('route', {
    requestId,
    capability: 'image_generation',
    generator: usesTypeface ? 'typeface' : 'studio',
    model: usesTypeface ? 'deterministic-glyph' : DEFAULT_STUDIO_CONFIG.checkpoint,
  });
  if (!usesTypeface) {
    send('stage', { stage: 'submitting', detail: 'Sending your prompt to the image pipeline' });
  }

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
    /*
     * 🚨 "NOT CONFIGURED" IS NOT A FAILURE, AND THIS LINE USED TO SAY IT WAS.
     *
     * Every outcome went out as IMAGE_GENERATION_FAILED — including the one
     * where nothing was attempted because no Studio endpoint is set. Measured
     * on staging: asking for a picture returned HTTP 200 carrying
     * `error: brain_error`, "Image generation is not configured on this
     * server." The sentence was right and the code said the Brain broke.
     *
     * The classification was already in hand — the line above writes it to the
     * trace — so nothing here is inferred from the message text. A client can
     * now tell an unconfigured feature from an outage, which are the two things
     * a user would do completely different things about.
     */
    send('error', {
      code: result.code === 'not_configured' ? 'IMAGE_GENERATION_NOT_CONFIGURED' : 'IMAGE_GENERATION_FAILED',
      message: result.message,
    });
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
/**
 * Stream an answer the capability already wrote.
 *
 * ---------------------------------------------------------------------------
 * 🚨 STREAMING IS A PRESENTATION CHOICE, NOT A LICENCE TO CHANGE THE TEXT.
 *
 * The client asked for a stream and gets one — the same SSE frames, in the same
 * order, so nothing downstream needs to know which path produced the answer.
 * What it does NOT get is a model: the text is emitted in chunks exactly as
 * rendered, so what arrives concatenates back to the verified payload
 * character for character.
 *
 * Chunked rather than sent whole because a long summary should appear the way
 * every other answer appears. The boundaries are arbitrary and carry no
 * meaning, which is precisely why they are safe.
 */
async function streamOwnedAnswer(
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
  answer: string,
  contextDiagnostics?: ContextDiagnostics,
): Promise<FastifyReply> {
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
  request.raw.once('aborted', () => { if (!raw.writableEnded) raw.end(); });

  if (contextDiagnostics) send('context', contextDiagnostics);
  send('route', { requestId, model: 'capability-owned', provider: 'engine', reason: 'answered by the capability that retrieved it' });

  // 🚨 SPLIT ONLY. Never reflowed, never re-cased, never trimmed per chunk —
  // the concatenation is the payload, byte for byte.
  const CHUNK = 240;
  for (let at = 0; at < answer.length; at += CHUNK) {
    send('token', { text: answer.slice(at, at + CHUNK) });
  }
  send('done', { requestId, model: 'capability-owned', provider: 'engine', usage: { inputTokens: 0, outputTokens: 0 } });
  raw.end();
  return reply;
}

async function streamChat(
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
  ranked: ModelDescriptor[],
  primaryReason: string,
  providerFor: (m: ModelDescriptor) => StreamingProvider,
  chatRequest: ChatTurnRequest,
  memory: {
    capacityProbe?: (model?: string) => Promise<AdmissionDecision>;
    contextDiagnostics?: ContextDiagnostics;
    commit?: (text: string, modelId: string, providerId: string) => void;
    fallback?: { policy?: string; requestedPolicy?: string; effectivePolicy?: string; policyReason?: string; fallbackRecommended: boolean; reasons: string[] };
    trace?: BrainTurnTrace;
    /**
     * The grounding gate for this turn, when one applies.
     *
     * 🚨 ITS PRESENCE TURNS STREAMING INTO BUFFERING, and that is the whole
     * design. A token already on the screen cannot be un-said, so an answer
     * that has to be checked is not emitted a fragment at a time and then
     * corrected — it is withheld until it has been checked, and only the
     * checked text is ever sent.
     *
     * Verifying fragments instead was considered and rejected: a claim is a
     * sentence, half a sentence supports nothing, and a gate that judged
     * partial text would reject true statements for being incomplete.
     */
    verifyFinalAnswer?: (raw: string) => { text: string; refused: boolean; removed: number };
    /** An immutable capability payload this answer is built around, if any. */
    payload?: string | null;
  } = {},
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

  /*
   * WHICH FILES THIS ANSWER WAS BUILT FROM, stated by the engine.
   *
   * The consumer used to derive its "From your files" attribution by checking
   * whether the model's prose happened to contain a filename. That made
   * provenance a property of WORDING: the same grounded turn showed a source for
   * one document and none for another, purely because one answer mentioned the
   * name and the other did not. Attribution is something we KNOW — these are the
   * chunks that were put in front of the model — so it is reported rather than
   * inferred from the reply.
   *
   * Emitted once, before any model call, so failover cannot change it and a
   * cancelled turn still told the client what it was grounded in.
   */
  const groundedChunks = chatRequest.context.retrievedChunks ?? [];
  const groundedIn = [...new Set(groundedChunks.map((c) => c.path).filter(Boolean))];

  /*
   * PAGES ARE REPORTED AS NUMBERS, not as a pre-formatted phrase.
   *
   * The consumer decides how to render "page 7" versus "pages 7-8" versus a
   * scattered set, and it can only do that honestly if it receives what was
   * actually retrieved. Sending a formatted string would force this layer to
   * guess the presentation and would make a fabricated range easy — three chunks
   * from pages 2, 9 and 40 must never collapse into "pages 2-40".
   *
   * Deduplicated and sorted here so the same page cited by two chunks appears
   * once.
   */
  const pages: Record<string, number[]> = {};
  for (const chunk of groundedChunks) {
    const label = (chunk as { location?: string }).location;
    if (!chunk.path || !label) continue;
    const found = [...label.matchAll(/\d+/g)].map((m) => Number(m[0])).filter(Number.isFinite);
    if (found.length === 0) continue;
    const [first, last] = [found[0]!, found[found.length - 1]!];
    const span = new Set(pages[chunk.path] ?? []);
    for (let page = first; page <= last; page += 1) span.add(page);
    pages[chunk.path] = [...span].sort((a, b) => a - b);
  }

  if (groundedIn.length > 0) {
    send('grounding', {
      files: groundedIn,
      ...(Object.keys(pages).length > 0 ? { pages } : {}),
    });
  }


  // The engine's chosen prior context, surfaced to the client as a sanitized
  // diagnostic BEFORE any token (explainable retrieval).
  if (memory.contextDiagnostics) send('context', memory.contextDiagnostics);

  /*
   * CAPACITY IS CHECKED BEFORE ANY MODEL REQUEST IS SENT.
   *
   * Reachability said yes while the card was pinned — `GET /models` needs no
   * GPU — so the turn was accepted and then could not be served. Refusing here
   * means no request is submitted at all, and the user learns in under three
   * seconds instead of watching nothing happen for eight minutes.
   *
   * A probe that cannot read its signals returns `unknown` and does NOT refuse:
   * a monitoring outage must never become a chat outage. The first-token
   * deadline below is what protects that turn instead.
   */
  if (memory.capacityProbe) {
    const reading = await memory.capacityProbe(ranked[0]?.id).catch(() => undefined);
    if (reading && reading.outcome === 'refused') {
      await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat',
        outcome: reading.code!, fields: { toolCalls: 0, reason: reading.reason, cached: reading.cached } });
      send('error', {
        code: reading.code,
        message: reading.message,
        capacity: reading.state,
        reason: reading.reason,
      });
      trace?.set('capacity', reading.state);
      trace?.finish(reading.state === 'busy' ? 'gpu_busy' : 'engine_unavailable');
      raw.end();
      return;
    }
    if (reading) trace?.set('capacity', reading.state);

    /*
     * SAY THAT THE MODEL IS LOADING, BECAUSE THAT IS WHAT THE WAIT IS.
     *
     * A cold model costs seconds before a single token exists, and the text path
     * emitted nothing across that gap — meta, then silence, then the answer. The
     * image path already solved this and its comment says why: an observed stage
     * is "the difference between 'still loading the image model' and a spinner
     * that is indistinguishable from a hang". Text had the same gap and none of
     * the same honesty.
     *
     * OBSERVED, NOT GUESSED. `/api/ps` is authoritative for what is resident, and
     * this fires only when the probe SUCCEEDED and the chosen model is absent
     * from it. If the probe failed, residentModels is undefined and nothing is
     * claimed — silence is the correct output when the evidence is missing, and
     * a confident "Loading…" over a model that was already warm would be exactly
     * the fabricated progress this codebase refuses elsewhere.
     *
     * Matched on the tag-stripped name because a provider id and an Ollama tag
     * are not guaranteed to be spelled identically; a mismatch here would invent
     * a load that is not happening.
     */
    const resident = reading?.signals?.residentModels;
    const chosenId = ranked[0]?.id;
    if (resident && chosenId) {
      if (!isModelResident(resident, chosenId)) {
        /*
         * 🚨 `detail` IS DIAGNOSTIC, NOT USER-FACING COPY. `stage` is the fact.
         *
         * This sentence was rendered verbatim to a user mid-conversation in
         * production, because the consumer forwarded `detail` to the browser
         * and displayed it. The consumer now drops it at its stream boundary
         * and maps the STAGE CODE to its own wording.
         *
         * A client that displays this string is reintroducing that defect:
         * infrastructure describing itself to someone who asked a question
         * about their own work. Consume `stage`; write your own copy.
         */
        send('stage', {
          stage: 'loading_model',
          detail: 'Loading the language model — the first answer after a pause takes longer to start.',
        });
        trace?.set('cold_model', chosenId);
      }
    }
  }

  const attempts = ranked.slice(0, MAX_FAILOVER);
  const failed: string[] = [];
  /* Kept so the terminal error can name a cause the user can act on. */
  let lastError: string | undefined;
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
        const first = await withFirstTokenDeadline(gen.next(), ac);
        /*
         * THE STAGE THAT WAS INVISIBLE. Pulling the first frame is what forces
         * the provider to open its connection AND load the model, so a cold or
         * evicted model shows up here and nowhere else. A 90s turn with 600ms of
         * generation is entirely this line.
         */
        trace?.mark('upstream_open');
        send('route', routeFrame(requestId, candidate, primaryId, primaryReason, failed));
        committed = true;
        /*
         * 🚨 ONE PLACE DECIDES WHETHER A FRAGMENT MAY BE SENT.
         *
         * With a gate on this turn, nothing goes out until the answer is
         * complete and checked. `markFirstToken` still fires, because the
         * timing it records is when the MODEL started producing — a real
         * measurement that must not be distorted by our own buffering.
         */
        const emit = (text: string): void => {
          markFirstToken();
          fullText += text;
          if (!memory.verifyFinalAnswer) send('token', { text });
        };
        if (!first.done && first.value) {
          if (first.value.delta) emit(first.value.delta);
          if (first.value.usage) usage = first.value.usage;
        }
        for await (const ev of gen) {
          if (ev.delta) emit(ev.delta);
          if (ev.usage) usage = ev.usage;
        }
      } else {
        const r = await provider.complete(chatRequest);
        send('route', routeFrame(requestId, candidate, primaryId, primaryReason, failed));
        committed = true;
        fullText = r.content;
        // Buffered: the whole answer arrives at once, so first token IS the end.
        markFirstToken();
        if (!memory.verifyFinalAnswer) send('token', { text: r.content });
        usage = { inputTokens: r.telemetry.inputTokens, outputTokens: r.telemetry.outputTokens };
      }

      /*
       * 🚨 THE GATE, THEN THE ONLY TOKEN THE CLIENT EVER SEES.
       *
       * Held back until here so an unsupported sentence is never on screen,
       * not even briefly, and never in a form the client could persist. What
       * the user receives and what the conversation stores are the same string
       * — the verified one — because those two diverging is how an unchecked
       * answer becomes next turn's context.
       */
      if (memory.verifyFinalAnswer) {
        send('stage', { stage: 'verifying', detail: 'Checking the answer against what was retrieved' });
        const checked = memory.verifyFinalAnswer(fullText);
        /*
         * 🚨 THE PAYLOAD LEADS, VERBATIM. Commentary follows only if it
         * survived the gate; a refusal costs the commentary, never the facts.
         */
        fullText = memory.payload
          ? [memory.payload, checked.refused ? '' : checked.text].filter((p) => p && p.trim()).join('\n\n')
          : checked.text;
        trace?.set('grounding', { removed: checked.removed, refused: checked.refused });
        send('token', { text: fullText });
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
      /*
       * 🚨 CHECKED BEFORE THE ABORT TEST, AND THE ORDER IS THE WHOLE POINT.
       *
       * The deadline enforces itself by calling ac.abort(), so by the time this
       * catch runs `signal.aborted` is true and the clause below would file a
       * starved turn as a CLIENT CANCELLATION — ending the stream with no
       * error, no answer and no explanation. That is precisely the silent
       * failure this deadline exists to remove, reintroduced by the mechanism
       * meant to fix it.
       */
      if (error instanceof FirstTokenTimeout) {
        await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat', outcome: 'FIRST_TOKEN_TIMEOUT', fields: { model: candidate.id, toolCalls: 0 } });
        send('error', {
          code: 'GENERATION_TIMEOUT',
          message: `The AI engine did not begin responding within ${Math.round(error.waitedMs / 1000)} seconds, `
            + 'so the request was stopped. The graphics card is most likely busy with another task — '
            + 'nothing was lost, try again in a moment.',
          waitedMs: error.waitedMs,
        });
        trace?.set('failed_model', candidate.id);
        trace?.finish('first_token_timeout');
        raw.end();
        return;
      }
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
      lastError = errText(error);
      request.log.warn({ model: candidate.id, err: lastError }, 'ai/chat stream open failed; trying next');
      failed.push(candidate.id);
    }
  }
  await auditStore.append({ correlationId: requestId, requestId, type: 'execution.failed', component: 'chat', outcome: 'COMPLETION_FAILED', fields: { toolCalls: 0 } });
  const failure = classifyProviderFailure(lastError);
  send('error', { code: failure.code, message: failure.message, failedOver: failed });
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
/**
 * How long a turn may wait for its FIRST frame before it is called a failure.
 *
 * The provider's own ceiling is 480s, which is where "no answer for eight
 * minutes" came from. Measured on a free card: 0.29s warm, and 5.9s cold
 * including loading a 13.5 GB vision model from disk. 60s is therefore ten times
 * the worst measured cold path and eight times tighter than the ceiling — long
 * enough to never trip on a legitimately slow load, short enough that a starved
 * turn ends while the person is still watching.
 */
const FIRST_TOKEN_DEADLINE_MS = Number(process.env.MIGRAPILOT_FIRST_TOKEN_DEADLINE_MS ?? 60_000);

export class FirstTokenTimeout extends Error {
  constructor(readonly waitedMs: number) {
    super(`no first token within ${Math.round(waitedMs / 1000)}s`);
    this.name = 'FirstTokenTimeout';
  }
}

/**
 * Race the first frame against the deadline, aborting upstream when it expires.
 *
 * Aborting matters as much as returning: without it the provider keeps the
 * request open and the GPU keeps queueing work nobody is waiting for any more.
 */
async function withFirstTokenDeadline<T>(pending: Promise<T>, ac: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(new FirstTokenTimeout(FIRST_TOKEN_DEADLINE_MS));
        }, FIRST_TOKEN_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
