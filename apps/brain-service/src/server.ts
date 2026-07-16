import Fastify from 'fastify';
import cors from '@fastify/cors';
import type {
  BudgetCheckRequest,
  BudgetCheckResponse,
  ChatTurnRequest,
  HealthResponse,
  RetrieveRequest,
  RouteRequest,
  TelemetryEventRequest,
} from '@migrapilot/shared-types';
import { readEnv } from './config/env.js';
import { ProviderRegistry } from './providers/providerRegistry.js';
import { selectEffectiveProfile } from './providers/selectProvider.js';
import { retrieveContext } from './retrieval/retrieve.js';
import { decideRoute } from './router/policy.js';
import { registerToolRoutes } from './tools/index.js';
import { registerAiRoutes } from './engine/aiRoutes.js';
import { registerToolExecutionRoutes } from './engine/toolRoutes.js';
import { registerEngineerRoutes } from './engine/engineerRoutes.js';
import { registerAgentRoutes } from './engine/agentRoutes.js';
import { AgentRegistry } from './engine/agentRegistry.js';
import { AgentService } from './engine/agentRuntime.js';
import { AgentRunStore } from './engine/agentRunStore.js';
import { buildPilotRuntimeClient } from './engine/pilot/pilotApiRuntimeClient.js';
import { WorkspaceManager } from './engine/workspaceManager.js';
import { registerWorkspaceRoutes } from './engine/workspaceRoutes.js';
import { gitInfo } from './engine/gitInfo.js';
import { registerMemoryRoutes } from './engine/memory/memoryRoutes.js';
import { ConversationStore } from './engine/memory/conversationStore.js';
import { QualificationStore } from './engine/qualificationStore.js';
import { SqliteDurableStore } from './engine/persistence/sqliteStore.js';
import { engineVersion } from './engine/version.js';
import { IndexService } from './engine/rag/indexService.js';
import { FsFileSource } from './engine/rag/fsFileSource.js';
import { OllamaEmbedder, CachedEmbedder, FakeEmbedder } from './engine/rag/embedder.js';
import { registerRagRoutes } from './engine/rag/ragRoutes.js';
import path from 'node:path';

const app = Fastify({ logger: true });
const startedAt = Date.now();
const env = readEnv();
const providerRegistry = new ProviderRegistry(env);

/** Durable state adapter (SQLite). Undefined ⇒ persistence unavailable/disabled;
 * the engine still runs (session + inference) but /health reports it and durable
 * memory/indexes do NOT silently appear empty-as-ready. */
let durable: SqliteDurableStore | undefined;
let durableError: string | undefined;

/* ── Production-safe CORS origins ── */
const ALLOWED_ORIGINS = [
  'https://pilot.migrateck.com',
  'https://migrateck.com',
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3377', 'http://localhost:3399', 'http://localhost:3000']
    : []),
];

async function registerPlugins(): Promise<void> {
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`), false);
    },
    credentials: true,
  });
}

async function getHealth(): Promise<HealthResponse> {
  const localProvider = providerRegistry.get('local');
  const cheapProvider = providerRegistry.get('cheap');
  const defaultProvider = providerRegistry.get('default');
  const premiumProvider = providerRegistry.get('premium');

  const [localOk, cheapOk, defaultOk, premiumOk] = await Promise.all([
    localProvider.isAvailable(),
    cheapProvider.isAvailable(),
    defaultProvider.isAvailable(),
    premiumProvider.isAvailable(),
  ]);

  const inferenceReady = defaultOk || cheapOk || localOk;

  // Persistence readiness — a running process is NOT proof of full readiness.
  const memoryDisabled = process.env.MIGRAPILOT_STATE_DB === 'off';
  const persistence = durable
    ? durable.health()
    : {
        memoryStore: 'unavailable' as const,
        ragStore: 'unavailable' as const,
        schemaVersion: 0,
        migrationState: memoryDisabled ? 'disabled' : durableError ? 'failed' : 'unavailable',
        detail: durableError,
      };
  // Fail-closed: durable state expected (not explicitly disabled) but not ready ⇒
  // DEGRADED — the engine never reports full "ok" on missing persistence.
  const persistenceExpectedButNotReady = !memoryDisabled && persistence.memoryStore !== 'ready';

  const baseStatus: HealthResponse['status'] =
    env.mode === 'offline' ? (localOk ? 'ok' : 'error') : inferenceReady ? 'ok' : 'degraded';
  const status: HealthResponse['status'] = persistenceExpectedButNotReady && baseStatus === 'ok' ? 'degraded' : baseStatus;

  return {
    status,
    service: 'migrapilot-brain',
    version: '0.1.0',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    providers: [
      { name: 'local', reachable: localOk, role: 'local' },
      { name: 'cheap', reachable: cheapOk, role: 'cheap' },
      { name: 'default', reachable: defaultOk, role: 'default' },
      { name: 'premium', reachable: premiumOk, role: 'premium' },
    ],
    indexes: {
      repoMapReady: persistence.ragStore === 'ready',
      symbolIndexReady: false,
      embeddingsReady: persistence.ragStore === 'ready',
    },
    // A running HTTP process ≠ full readiness. Distinguish the real axes.
    readiness: {
      process: 'running',
      inferenceProviders: inferenceReady ? 'available' : 'unavailable',
      persistence: persistence.memoryStore,
      memory: persistence.memoryStore,
      rag: persistence.ragStore,
      schemaVersion: persistence.schemaVersion,
      migrationState: persistence.migrationState,
      detail: persistence.detail,
    },
    // Precise compatibility contract for clients (see GET /api/ai/version).
    engine: engineVersion(persistence.schemaVersion),
  } as HealthResponse & { readiness: unknown; engine: unknown };
}

function checkBudget(input: BudgetCheckRequest): BudgetCheckResponse {
  if (input.modelProfile === 'premium') {
    return {
      allowed: false,
      downgradedTo: 'default',
      reason: 'Premium model usage is disabled in the starter scaffold.',
    };
  }

  const estimatedTotal = input.estimatedInputTokens + input.estimatedOutputTokens;
  if (estimatedTotal > 12000) {
    return {
      allowed: false,
      downgradedTo: 'cheap',
      reason: 'Estimated request size exceeds starter budget threshold.',
    };
  }

  return { allowed: true };
}

async function handleChat(input: ChatTurnRequest) {
  const effectiveProfile = selectEffectiveProfile(input.modelProfile, env);
  const provider = providerRegistry.get(effectiveProfile);
  return provider.complete({ ...input, modelProfile: effectiveProfile });
}

async function main(): Promise<void> {
  await registerPlugins();

  /* ── Error handler: prevent stack trace leaks ── */
  app.setErrorHandler((error: Error, _request, reply) => {
    app.log.error(error, 'Unhandled route error');
    reply.status(500).send({
      ok: false,
      error: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message,
    });
  });

  app.get('/health', async () => getHealth());
  app.get('/api/ai/version', async () => engineVersion(durable?.health().schemaVersion ?? 0));
  app.post<{ Body: RouteRequest }>('/route', async (request) => decideRoute(request.body));
  app.post<{ Body: RetrieveRequest }>('/retrieve', async (request) => retrieveContext(request.body));
  app.post<{ Body: ChatTurnRequest }>('/chat', async (request) => handleChat(request.body));
  app.post<{ Body: BudgetCheckRequest }>('/budget/check', async (request) => checkBudget(request.body));
  registerToolRoutes(app);
  // ── Durable state (MigraAI Durable State): embedded SQLite adapter. Fail-
  // closed — if the DB can't open or the schema is incompatible, `durable` stays
  // undefined and /health reports persistence degraded/unavailable rather than
  // silently serving empty durable memory/indexes. ──
  const memoryDisabled = process.env.MIGRAPILOT_STATE_DB === 'off';
  const dbPath = memoryDisabled ? '' : (process.env.MIGRAPILOT_STATE_DB ?? path.join(process.cwd(), 'migraai-state.db'));
  if (!memoryDisabled) {
    try {
      durable = new SqliteDurableStore(dbPath);
    } catch (error) {
      durable = undefined;
      durableError = error instanceof Error ? error.message : String(error);
      app.log.error({ err: durableError }, 'durable store unavailable — engine starting in DEGRADED persistence state');
    }
  }

  // MigraAI Engine conversation memory (/api/ai/conversations): the engine owns
  // durable, layered conversational context (scope-isolated, redacted). Durable
  // conversations write through to the store and are hydrated on startup.
  const memoryStore = new ConversationStore(undefined, undefined, durable ?? undefined);
  if (durable) {
    memoryStore.hydrate({ ...durable.loadDurable(), memoryItems: durable.loadMemoryItems() });
  }
  registerMemoryRoutes(app, memoryStore);
  // Model qualification manifest (installing a model does not approve it). The
  // router serves only `approved` models when the manifest is `enforced`.
  const qualStore = QualificationStore.fromFile(
    process.env.MIGRAPILOT_QUALIFICATION_FILE ?? path.join(process.cwd(), 'model-qualification.json'),
  );
  // MigraAI Engine semantic RAG (/api/ai/indexes, /api/ai/retrieve): workspace-
  // scoped vector indexes over nomic-embed-text, exclusion-gated + fail-closed
  // (only an `approved` index backs production chat RAG). Approved indexes +
  // their chunks/embeddings are durable and hydrated on startup.
  // With the deterministic `stub` provider (tests / no local Ollama) use the
  // FakeEmbedder so indexing never depends on a running embedding backend; the
  // real OllamaEmbedder is used whenever a concrete provider is configured.
  const baseEmbedder = env.localProvider === 'stub' ? new FakeEmbedder() : new OllamaEmbedder(env.providerBaseUrl, 'nomic-embed-text:latest', 'v1', env.openAiApiKey);
  const embedder = new CachedEmbedder(baseEmbedder, 20000, durable ?? undefined);
  const indexService = new IndexService(embedder, (rec) => new FsFileSource(rec.root), undefined, undefined, durable ?? undefined);
  if (durable) indexService.hydrate();
  registerRagRoutes(app, indexService);
  // MigraAI Engine unified facade (/api/ai/*): provider-independent chat,
  // capability-routed model selection, model catalog, embeddings. Chat consumes
  // the memory store above for server-side context + commit, and semantic RAG
  // from an APPROVED index when one exists for the workspace.
  const modelRegistry = registerAiRoutes(app, env, undefined, memoryStore, undefined, qualStore, indexService);
  // MigraAI Engine capability execution boundary (/api/ai/tools): the engine owns
  // tool validation, availability, dispatch, and the approval lifecycle. Additive
  // — the legacy /tools/* routes remain for compatibility.
  const toolDeps = registerToolExecutionRoutes(app);
  // MigraAI workspace engineer (/api/ai/engineer): the model-in-the-loop LOCAL
  // engineering agent (Slice 2). Runs through the SAME tool boundary; never
  // mutates (edit.apply is substituted with preview proposals) and never touches
  // the pilot runtime — disabled delegation cannot block local work.
  registerEngineerRoutes(app, env, modelRegistry, toolDeps);
  // MigraAI Engine agent orchestration (/api/ai/agents): the engine owns the
  // public agent contract; runs execute through the SAME tool boundary + approval
  // store above, so agent tool calls are validated + audited identically.
  const agentRegistry = new AgentRegistry();
  // Pilot Runtime Adapter: `runtime: 'pilot'` agents delegate to pilot-api when
  // delegation is explicitly enabled + configured; otherwise NO client is injected
  // and such runs fail closed (never a local mutating fallback).
  const pilotRuntimeClient = buildPilotRuntimeClient(env, (m) => app.log.info(m));
  if (pilotRuntimeClient) app.log.info('Pilot Runtime delegation ENABLED (agent runs may route to pilot-api).');
  const agentStore = new AgentRunStore();
  const agentService = new AgentService(agentRegistry, agentStore, toolDeps, { pilotClient: pilotRuntimeClient });
  registerAgentRoutes(app, { toolDeps, registry: agentRegistry, store: agentStore, service: agentService });
  // MigraAI Workspace Manager (/api/ai/workspaces): the object every client uses —
  // a workspace owns its index, memory, agents, models, health. Clients just
  // "Open" / "Sync"; the engine knows the rest. Durable + scope-isolated.
  const approvedModelsByTier = async (): Promise<import('./engine/workspaceManager.js').WorkspaceView['models']> => {
    const models = (await modelRegistry.list()).filter((m) => m.qualification?.state === 'approved');
    return {
      coding: models.filter((m) => m.capabilities.coding).map((m) => m.id),
      reasoning: models.filter((m) => m.capabilities.reasoning).map((m) => m.id),
      general: models.filter((m) => m.capabilities.chat && !m.capabilities.coding && !m.capabilities.reasoning).map((m) => m.id),
      vision: models.filter((m) => m.capabilities.vision).map((m) => m.id),
      embedding: models.filter((m) => m.capabilities.embedding).map((m) => m.id),
    };
  };
  const workspaceManager = new WorkspaceManager({
    indexService, conversations: memoryStore, agents: agentRegistry, approvedModelsByTier,
    version: engineVersion, schemaVersion: () => durable?.health().schemaVersion ?? 0,
    persistence: durable ?? undefined, gitInfo,
  });
  if (durable) workspaceManager.hydrate();
  registerWorkspaceRoutes(app, workspaceManager);
  app.post<{ Body: TelemetryEventRequest }>('/telemetry/event', async (request, reply) => {
    if (env.enableTelemetry) {
      app.log.info({ telemetry: request.body }, 'Telemetry event received');
    }
    reply.code(202);
    return { accepted: true };
  });

  try {
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`MigraPilot brain listening on http://${env.host}:${env.port}`);
  } catch (error) {
    if (await canReuseExistingServer(error)) {
      return;
    }
    app.log.error(error, 'Failed to start MigraPilot brain service');
    process.exit(1);
  }
}

void main();

async function canReuseExistingServer(error: unknown): Promise<boolean> {
  const isAddrInUse =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EADDRINUSE';

  if (!isAddrInUse) {
    return false;
  }

  const probeUrl = `http://${env.host}:${env.port}/health`;

  try {
    const response = await fetch(probeUrl);
    if (!response.ok) {
      return false;
    }

    // Only reuse if the occupant actually identifies as a MigraPilot brain.
    // A different service (e.g. pilot-api) can also answer /health with 200 on
    // this port; reusing it would silently point clients at the wrong backend.
    const body = (await response.json().catch(() => null)) as { service?: unknown } | null;
    if (body?.service !== 'migrapilot-brain') {
      app.log.error(
        { host: env.host, port: env.port, probeUrl, occupantService: body?.service ?? 'unknown' },
        'MigraPilot brain port is occupied by a different service; refusing to reuse it. ' +
          'Free the port or set MIGRAPILOT_BRAIN_PORT to an available port.',
      );
      return false;
    }

    app.log.warn(
      { host: env.host, port: env.port, probeUrl },
      'MigraPilot brain port already in use; reusing the existing healthy local service',
    );
    return true;
  } catch {
    return false;
  }
}

/* ── Crash safety ── */
process.on('unhandledRejection', (reason) => {
  app.log.error(reason, 'Unhandled rejection — shutting down');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  app.log.error(err, 'Uncaught exception — shutting down');
  process.exit(1);
});
