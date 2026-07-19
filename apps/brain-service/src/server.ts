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
import { registerInspectRoutes } from './engine/inspectRoutes.js';
import { registerEngineerRoutes } from './engine/engineerRoutes.js';
import { telemetryHub } from './engine/telemetryHub.js';
import { registerAgentRoutes } from './engine/agentRoutes.js';
import { registerProductionDiagnosticsRoutes } from './engine/production/routes.js';
import { buildProductionDiagnosticsProvider } from './engine/production/config.js';
import { registerProviderRoutes } from './engine/providers/routes.js';
import { buildProviderRegistry } from './engine/providers/config.js';
import { FleetRegistry } from './engine/providers/fleetRegistry.js';
import { PolicyEngine, DEFAULT_POLICY, isExecutionPolicyId, type ExecutionPolicyId } from './engine/providers/executionPolicy.js';
import { makeReachabilityProbe } from './engine/providers/health.js';
import { buildEngineModelRegistry } from './engine/aiRoutes.js';
import type { LocalRoutingDeps } from './engine/providers/localCodingRouter.js';
import { EscalationController } from './engine/providers/escalationController.js';
import { EscalationOfferStore } from './engine/providers/escalationStore.js';
import { CloudEscalationExecutor } from './engine/providers/cloudEscalationExecutor.js';
import { registerEscalationRoutes } from './engine/providers/escalationRoutes.js';
import { buildPricingBook, buildBudgetManager, buildUsageLedger } from './engine/providers/budget/config.js';
import { registerBudgetRoutes } from './engine/providers/budget/budgetRoutes.js';
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
import { wireOperationalPersistence } from './engine/persistence/operationalBridge.js';
import { OperationalMaintenance, buildRetentionConfig } from './engine/persistence/operationalMaintenance.js';
import { auditStore } from './engine/auditLog.js';
import { incidentManager } from './engine/incidents.js';
import { engineVersion } from './engine/version.js';
import { sanitizeError } from './engine/redaction.js';
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
/** Operational retention + integrity + health (ODF Slice 1). Present only when a
 * durable store is present; owns the retention worker + shutdown of it. */
let opMaintenance: OperationalMaintenance | undefined;

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
    // Operational Data Foundation (Slice 1): durable operational evidence health —
    // reachable, schema-current, integrity, retention worker, write latency, storage.
    operational: opMaintenance ? opMaintenance.health() : { status: memoryDisabled ? 'disabled' : 'unavailable' },
  } as HealthResponse & { readiness: unknown; engine: unknown; operational: unknown };
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
    // Never leak a raw message into an API response — sanitize through the
    // canonical redactor. Raw development detail is opt-in via an explicit debug
    // flag only (NODE_ENV does not gate secret exposure).
    const safe = sanitizeError(error);
    reply.status(500).send({
      ok: false,
      error: 'Internal server error',
      detail: safe,
      ...(process.env.MIGRAPILOT_DEBUG_ERRORS === 'true' ? { debug: { name: error.name, message: safe.message } } : {}),
    });
  });

  app.get('/health', async () => getHealth());
  app.get('/api/ai/version', async () => engineVersion(durable?.health().schemaVersion ?? 0));
  app.post<{ Body: RouteRequest }>('/route', async (request) => decideRoute(request.body));
  app.post<{ Body: RetrieveRequest }>('/retrieve', async (request) => retrieveContext(request.body));
  app.post<{ Body: ChatTurnRequest }>('/chat', async (request) => handleChat(request.body));
  app.post<{ Body: BudgetCheckRequest }>('/budget/check', async (request) => checkBudget(request.body));
  registerToolRoutes(app);
  // Read-only workspace inspection (model-free local runner): lets the chat answer
  // "workspace root / list / search / read / git status·branch·head·remotes /
  // package manager" with real evidence instead of a false "can't access local"
  // refusal. Read-only + workspace-contained + typed errors.
  registerInspectRoutes(app);
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
  // Build ONE model registry + provider fleet + policy engine, shared across the
  // AI facade, the provider inspection routes (Slice 1), and — as of Slice 2 —
  // local-first coding routing on the chat + engineer paths.
  const modelRegistry = buildEngineModelRegistry(env, qualStore);
  const providerRegistry = buildProviderRegistry();
  const providerFleet = new FleetRegistry(providerRegistry, modelRegistry, { probe: makeReachabilityProbe() });
  const policyEngine = new PolicyEngine();
  const activePolicy = isExecutionPolicyId(process.env.MIGRAPILOT_EXECUTION_POLICY ?? '') ? (process.env.MIGRAPILOT_EXECUTION_POLICY as ExecutionPolicyId) : DEFAULT_POLICY;
  const providerRouting: LocalRoutingDeps = { fleet: providerFleet, engine: policyEngine, policy: activePolicy };
  // Slice 3 — cloud escalation control plane. Two-step approval-gated: a local
  // coding failure with a DEFINED reason may mint an offer; a separate approve
  // call runs exactly ONE attributed cloud attempt. Impossible under local-only /
  // privacy; cloud disabled by default. Budget cap per request (Slice 4 extends).
  // Slice 4 — cost & budget governance. Pricing (owner-configured), fail-closed
  // budget scopes, and an append-only usage ledger back the escalation flow: a
  // paid cloud attempt cannot begin without an atomic budget reservation.
  const pricingBook = buildPricingBook(providerRegistry.list());
  const budgetManager = buildBudgetManager();
  const usageLedger = buildUsageLedger();
  // Operational Data Foundation (Slice 1): make operational evidence durable across
  // restarts. Hydrate the audit/usage/incident/budget stores from the durable store,
  // then attach durable writers so new evidence persists. Metadata only — the stores
  // already redact at their append boundary; recovery history rides the audit writer.
  if (durable) {
    wireOperationalPersistence(durable, { auditStore, usageLedger, incidentManager, budgetManager });
    app.log.info('Operational persistence WIRED (audit/usage/incidents/budget durable across restarts).');
    // Retention + integrity + health. Verify integrity on startup (reported via
    // health, never a crash — the engine continues with whatever survived), then
    // start the age-based retention worker.
    opMaintenance = new OperationalMaintenance(durable, buildRetentionConfig(process.env), () => Date.now(), dbPath);
    const integrity = opMaintenance.verifyIntegrity();
    if (integrity !== 'ok') app.log.error({ integrity }, 'durable operational store integrity check FAILED — continuing in degraded state');
    opMaintenance.start();
    app.log.info('Operational retention worker STARTED (age-based; open incidents never pruned).');
    // Shutdown: stop the retention worker + close the durable store cleanly.
    app.addHook('onClose', async () => { opMaintenance?.close(); durable?.close(); });
  }
  const cloudMaxOutputTokens = Number(process.env.MIGRAPILOT_CLOUD_MAX_OUTPUT_TOKENS ?? 2000) || 2000;
  const escalation = new EscalationController(new EscalationOfferStore(), new CloudEscalationExecutor(), providerFleet, providerRegistry, pricingBook, budgetManager, usageLedger, cloudMaxOutputTokens);
  registerEscalationRoutes(app, escalation);
  registerBudgetRoutes(app, { budget: budgetManager, ledger: usageLedger, pricing: pricingBook, maxOutputTokens: cloudMaxOutputTokens });
  // Slice 2: coding turns route local-first (cloud NEVER invoked inline). Slice 3
  // adds the offer path (still no inline cloud — approval is a separate call).
  registerAiRoutes(app, env, modelRegistry, memoryStore, undefined, qualStore, indexService, providerRouting, escalation);
  // Intelligent Provider Router — Slice 1 (/api/ai/providers): read-only, dry-run
  // inspection over the SAME fleet + policy engine. Cloud disabled by default.
  registerProviderRoutes(app, { fleet: providerFleet, engine: policyEngine, defaultPolicy: process.env.MIGRAPILOT_EXECUTION_POLICY });
  // MigraAI Engine capability execution boundary (/api/ai/tools): the engine owns
  // tool validation, availability, dispatch, and the approval lifecycle. Additive
  // — the legacy /tools/* routes remain for compatibility.
  const toolDeps = registerToolExecutionRoutes(app);
  // Route store telemetry (Slice 2) to the app log as structured lines.
  telemetryHub.setWriter((line) => app.log.info(line));
  // MigraAI workspace engineer (/api/ai/engineer): the model-in-the-loop LOCAL
  // engineering agent (Slice 2). Runs through the SAME tool boundary; never
  // mutates (edit.apply is substituted with preview proposals) and never touches
  // the pilot runtime — disabled delegation cannot block local work.
  registerEngineerRoutes(app, env, modelRegistry, toolDeps, undefined, providerRouting, escalation);
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
  // Read-Only Production Diagnostics (Slice 5): a DEDICATED provider, separate
  // from the tool boundary + approval store above. Disabled by default; fails
  // closed; only server-registered targets; no mutation path. Its operator token
  // space is distinct from the workspace approval store.
  const { provider: prodDiagnostics, operatorTokens: prodOperatorTokens } = buildProductionDiagnosticsProvider();
  registerProductionDiagnosticsRoutes(app, prodDiagnostics, prodOperatorTokens);
  if (prodDiagnostics.isEnabled()) app.log.info('Production Diagnostics ENABLED (read-only).');
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

/* ── Graceful shutdown ── close Fastify (runs the onClose hook: stops the
 * retention worker + closes the durable store cleanly, so durable state is
 * flushed and not left mid-write on a restart). ── */
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down MigraPilot brain — closing durable store');
    void app.close().finally(() => process.exit(0));
  });
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
