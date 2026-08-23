import Fastify from 'fastify';
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
import { registerCommandRunRoutes } from './engine/commandRunRoutes.js';
import { registerTestRunRoutes } from './engine/testRunRoutes.js';
import { registerAnswerRoutes } from './engine/answerRoutes.js';
import { lookup as dnsLookup } from 'node:dns/promises';
import { registerEngineerRoutes } from './engine/engineerRoutes.js';
import { LiveConnectorRegistry } from './engine/liveKnowledge/liveResearch.js';
import { buildAuthoritativeConnectors } from './engine/liveKnowledge/connectors/index.js';
import { startMcp } from './mcp/mcpRuntime.js';
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
import { registerAgentModeCommandRoutes } from './engine/agentModeCommandRoutes.js';
import { registerCodingRunRoutes } from './engine/coding/codingRunRoutes.js';
import { registerSpeechRoutes } from './engine/speech/speechRoutes.js';
import { CodingRunService } from './engine/coding/codingRunService.js';
import { createProductionCodingDriver } from './engine/coding/productionCodingDriver.js';
import { PREFERRED_CODING_MODEL } from './engine/capability/capabilityGrants.js';
import { codingCapability, codingStructuredModel, readCodingConfig, readCodingValidationCommand, recoverCodingRuns } from './engine/coding/codingRuntime.js';
import { buildAgentRunJournalConfig } from './engine/agentRunJournal.js';
import { AgentActivationAuthority } from './engine/agentActivation.js';
import { buildAgentModeCommandService } from './engine/agentModeCommandService.js';
import { scavengeStaleAgentSnapshots } from './engine/agentRecipe.js';
import { AgentService } from './engine/agentRuntime.js';
import { AgentRunStore } from './engine/agentRunStore.js';
import { buildPilotRuntimeClient } from './engine/pilot/pilotApiRuntimeClient.js';
import { WorkspaceManager } from './engine/workspaceManager.js';
import { registerWorkspaceRoutes } from './engine/workspaceRoutes.js';
import { gitInfo } from './engine/gitInfo.js';
import { registerMemoryRoutes } from './engine/memory/memoryRoutes.js';
import { installJsonBodyParser } from './http/jsonBodyParser.js';
import { ConversationStore } from './engine/memory/conversationStore.js';
import { QualificationStore } from './engine/qualificationStore.js';
import { PostgresDurableStore } from './engine/persistence/postgresStore.js';
import { PostgresConnection } from './engine/persistence/postgres/pool.js';
import { SqliteDurableStore } from './engine/persistence/sqliteStore.js';
import type { DurableStore } from './engine/persistence/types.js';
import { resolvePersistence, PersistenceConfigError } from './engine/persistence/persistenceConfig.js';
import { wireOperationalPersistence } from './engine/persistence/operationalBridge.js';
import { OperationalMaintenance, buildRetentionConfig, isMaintainable } from './engine/persistence/operationalMaintenance.js';
import { auditStore } from './engine/auditLog.js';
import { incidentManager } from './engine/incidents.js';
import { engineVersion } from './engine/version.js';
import { sanitizeError } from './engine/redaction.js';
import { IndexService } from './engine/rag/indexService.js';
import { FsFileSource } from './engine/rag/fsFileSource.js';
import { OllamaEmbedder, CachedEmbedder, FakeEmbedder } from './engine/rag/embedder.js';
import { registerRagRoutes } from './engine/rag/ragRoutes.js';
import path from 'node:path';
import { registerMigraPilotCors } from './http/corsPolicy.js';

// A code assistant's chat/retrieve requests legitimately carry large payloads —
// multi-file context, retrieved snippets, and base64 VISION image attachments —
// which routinely exceed Fastify's 1 MB default (surfacing as a confusing
// 413→500 on /chat). Raise the ceiling to comfortably fit image attachments.
const app = Fastify({ logger: true, bodyLimit: 32 * 1024 * 1024 });

installJsonBodyParser(app);
const startedAt = Date.now();
const env = readEnv();
// Consume and delete the inherited one-time bootstrap secret before any request
// logging or provider construction can observe it.
const agentActivation = AgentActivationAuthority.fromEnvironment(process.env);
const providerRegistry = new ProviderRegistry(env);

/** Durable state adapter, selected by MIGRAPILOT_PERSISTENCE. Undefined ⇒ persistence unavailable/disabled;
 * the engine still runs (session + inference) but /health reports it and durable
 * memory/indexes do NOT silently appear empty-as-ready. */
let durable: DurableStore | undefined;
let durableError: string | undefined;
/** Which adapter was selected. Read by /health, so it lives at module scope. */
let selectionKind: 'postgres' | 'sqlite' | 'off' = 'sqlite';
/** Operational retention + integrity + health (ODF Slice 1). Present only when a
 * durable store is present; owns the retention worker + shutdown of it. */
let opMaintenance: OperationalMaintenance | undefined;

async function registerPlugins(): Promise<void> {
  await registerMigraPilotCors(app);
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
  const memoryDisabled = selectionKind === 'off';
  const persistence = durable
    ? await durable.health()
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

  // `health()` became Promise-returning in the durable persistence migration.
  // Awaited here rather than inside the response literal, where an un-awaited
  // Promise would have serialized as `{}` and reported empty operational health.
  const operational = opMaintenance
    ? await opMaintenance.health()
    : { status: memoryDisabled ? ('disabled' as const) : ('unavailable' as const) };

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
    operational,
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
  app.get('/api/ai/version', async () => engineVersion((await durable?.health())?.schemaVersion ?? 0));
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
  registerCommandRunRoutes(app);
  registerTestRunRoutes(app);
  // ── Agentic answer path (`POST /api/ai/answer`): the model gathers real
  // workspace evidence with read-only tools before answering — Copilot-style,
  // grounded + cited. Read-only by construction. Uses a tool-capable local model.
  registerAnswerRoutes(app, {
    providerBaseUrl: env.providerBaseUrl,
    defaultModel: process.env.MIGRAPILOT_AGENT_MODEL ?? 'qwen3-coder:30b',
    cloudModel: process.env.MIGRAPILOT_AGENT_CLOUD_MODEL ?? 'gpt-oss:120b-cloud',
  });
  // ── Durable state (MigraAI Durable State) ──────────────────────────────────
  // The adapter is chosen explicitly (MIGRAPILOT_PERSISTENCE); PostgreSQL is the
  // production architecture and SQLite is a local/dev/test adapter.
  //
  // Two different failure modes, deliberately handled differently:
  //
  //   MISCONFIGURATION is fatal. `resolvePersistence` throws when production
  //   would reach a local database, and that must abort startup — a Brain that
  //   silently serves VM-local state looks healthy while its data diverges.
  //
  //   AN UNAVAILABLE STORE is degraded, not fatal. If a correctly-configured
  //   database cannot be opened, `durable` stays undefined and /health reports
  //   it, preserving the existing fail-closed behaviour rather than serving
  //   empty durable memory as if it were ready.
  let selection: ReturnType<typeof resolvePersistence>;
  try {
    selection = resolvePersistence(process.env, process.cwd());
  } catch (error) {
    if (error instanceof PersistenceConfigError) {
      app.log.fatal({ err: error.message }, 'persistence misconfigured — refusing to start');
      throw error;
    }
    throw error;
  }
  app.log.info({ persistence: selection.kind, reason: selection.reason }, 'durable persistence selected');
  selectionKind = selection.kind;

  const memoryDisabled = selection.kind === 'off';
  if (selection.kind === 'sqlite') {
    // SQLite is the local/dev/test adapter. An unavailable local database stays
    // DEGRADED rather than fatal: `resolvePersistence` has already refused to
    // let production reach this branch, so nothing here can be serving real
    // tenants.
    try {
      durable = new SqliteDurableStore(selection.sqlitePath!);
    } catch (error) {
      durable = undefined;
      durableError = error instanceof Error ? error.message : String(error);
      app.log.error({ err: durableError }, 'durable store unavailable — engine starting in DEGRADED persistence state');
    }
  } else if (selection.kind === 'postgres') {
    // PostgreSQL is the durable backend. SQLite remains a local/dev adapter only,
    // pending removal.
    //
    // NEVER FALLS BACK. If PostgreSQL cannot be reached or migrated, this stays
    // undefined and the engine runs in a DEGRADED persistence state that refuses
    // durable writes — it does not quietly serve from a local SQLite file while
    // reporting success. A silent downgrade is how durable state goes missing.
    try {
      const connection = new PostgresConnection({ databaseUrl: selection.databaseUrl! });
      const store = new PostgresDurableStore(connection);
      // Migrations run BEFORE the store is published, so nothing can read or
      // write against a schema that has not been brought current.
      await store.initialize();
      durable = store;
      app.log.info('postgres durable store ready');
    } catch (error) {
      durable = undefined;
      durableError = error instanceof Error ? error.message : String(error);
      app.log.error({ err: durableError }, 'postgres persistence unavailable — refusing to fall back to SQLite');
    }
  }

  // MigraAI Engine conversation memory (/api/ai/conversations): the engine owns
  // durable, layered conversational context (scope-isolated, redacted). Durable
  // conversations write through to the store and are hydrated on startup.
  const memoryStore = new ConversationStore(undefined, undefined, durable ?? undefined);
  /*
   * NO GLOBAL HYDRATION AT STARTUP.
   *
   * This used to load every conversation in the database. Under PostgreSQL
   * row-level security that read returns ZERO rows — a connection that has not
   * declared a scope sees nothing — so the Brain would have booted reporting an
   * empty history while all of it sat safe in the database.
   *
   * Hydration now follows the request: `registerMemoryRoutes` installs a
   * preHandler that loads the caller's own scope, once, before any handler
   * reads. Nothing is loaded for tenants who never connect.
   */
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
  // AWAITED: the vector indexes, their approved pointers and any startup
  // quarantine all load here. Detached, the engine answered retrieval requests
  // against an empty index set while claiming it had hydrated.
  // NOT hydrated globally: under row-level security a scope-less read returns
  // zero rows, and an empty index fails quietly — chat keeps answering while
  // silently ignoring the caller's documents. Scopes load on their first request.
  // The branch an APPROVED generation was built from lives on the workspace record,
  // not the index. Resolved lazily per request so a later sync is reflected without
  // a restart; undefined when unknown, which the grounding boundary reports as
  // "unknown" rather than assuming the branches match.
  const indexedBranchFor = (scope: { owner: string; workspace: string }): string | undefined =>
    workspaceManager?.list(scope)[0]?.gitBranch;
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
    // AWAITED: this hydrates budget scopes, reservations, incidents and audit
    // history from disk. Left detached, the server began accepting requests
    // while those stores were still empty — budget enforcement would have
    // started the process believing nothing had been spent or reserved.
    const operational = await wireOperationalPersistence(durable, { auditStore, usageLedger, incidentManager, budgetManager });
    app.log.info('Operational persistence WIRED (audit/usage/incidents/budget durable across restarts).');
    // Retention + integrity + health. Verify integrity on startup (reported via
    // health, never a crash — the engine continues with whatever survived), then
    // start the age-based retention worker.
    // Capability-based, not type-based: any adapter that implements the
    // maintenance surface gets maintenance. An adapter that does not is skipped
    // LOUDLY, because silently running without retention or integrity checks is
    // the failure mode worth preventing here.
    if (isMaintainable(durable)) {
      opMaintenance = new OperationalMaintenance(
        durable,
        buildRetentionConfig(process.env),
        () => Date.now(),
      );
      // Awaited: `verifyIntegrity` became Promise-returning, so the un-awaited
      // comparison was never equal to 'ok' and reported a FAILED integrity check
      // on every boot, logging an empty object instead of the real verdict.
      const integrity = await opMaintenance.verifyIntegrity();
      if (integrity !== 'ok') app.log.error({ integrity }, 'durable operational store integrity check FAILED — continuing in degraded state');
      opMaintenance.start();
      app.log.info('Operational retention worker STARTED (age-based; open incidents never pruned).');
    } else {
      app.log.error(
        { persistence: selection.kind },
        'durable store does not implement the maintenance capability — retention and integrity checks are NOT running',
      );
    }
    // Shutdown: stop the retention worker + close the durable store cleanly.
    app.addHook('onClose', async () => {
      opMaintenance?.close();
      // Drain BEFORE closing. The usage/incident/budget writers are detached by
      // contract, so at this point durable writes may still be queued; closing the
      // store first discards operational evidence that was already accepted in
      // memory. `close()` is itself asynchronous — un-awaited, shutdown raced it.
      await operational.drain();
      await durable?.close();
    });
  }
  const cloudMaxOutputTokens = Number(process.env.MIGRAPILOT_CLOUD_MAX_OUTPUT_TOKENS ?? 2000) || 2000;
  const escalation = new EscalationController(new EscalationOfferStore(), new CloudEscalationExecutor(), providerFleet, providerRegistry, pricingBook, budgetManager, usageLedger, cloudMaxOutputTokens);
  registerEscalationRoutes(app, escalation);
  registerBudgetRoutes(app, { budget: budgetManager, ledger: usageLedger, pricing: pricingBook, maxOutputTokens: cloudMaxOutputTokens });
  // Slice 2: coding turns route local-first (cloud NEVER invoked inline). Slice 3
  // adds the offer path (still no inline cloud — approval is a separate call).
  registerAiRoutes(app, env, modelRegistry, memoryStore, undefined, qualStore, indexService, providerRouting, escalation, indexedBranchFor);
  // Intelligent Provider Router — Slice 1 (/api/ai/providers): read-only, dry-run
  // inspection over the SAME fleet + policy engine. Cloud disabled by default.
  registerProviderRoutes(app, { fleet: providerFleet, engine: policyEngine, defaultPolicy: process.env.MIGRAPILOT_EXECUTION_POLICY });
  // MigraAI Engine capability execution boundary (/api/ai/tools): the engine owns
  // tool validation, availability, dispatch, and the approval lifecycle. Additive
  // — the legacy /tools/* routes remain for compatibility.
  const toolDeps = registerToolExecutionRoutes(app);
  // Stage 2: explicit local Agent Mode command lifecycle. This dedicated route
  // renders server-authoritative proposals and resumes by run id; ordinary chat
  // has no reference to it and cannot approve or execute commands.
  const agentModeCommands = buildAgentModeCommandService(toolDeps, durable ?? undefined);
  registerAgentModeCommandRoutes(app, toolDeps, agentActivation, agentModeCommands);
  // Governed coding runs (/api/ai/coding/runs). The ONLY Brain capability that
  // writes to a user's repository, so every precondition must hold before the
  // routes exist at all: explicitly enabled, a validated workspace boundary, and
  // a durable journal. A run whose record cannot outlive the process that made the
  // changes is exactly the state this workflow exists to prevent, so an in-memory
  // journal disqualifies it rather than downgrading it.
  const codingConfig = readCodingConfig();
  // The coding model is explicit: an unset local model would otherwise silently
  // fall back to whatever the provider defaults to, and this one authors edits.
  //
  // It defaults to the MEASURED preferred coder rather than to the general chat
  // model. Inheriting `localModel` meant the model that writes changes was chosen
  // by whatever happened to be configured for conversation; on the coding-reliability
  // evaluation that model landed the change 1 time in 8 against 7 in 8 for this one.
  // Nothing is opened by defaulting it: governed coding still requires
  // MIGRAPILOT_CODING_ENABLED=1 and a validated workspace boundary.
  const codingModelId = process.env.MIGRAPILOT_CODING_MODEL ?? PREFERRED_CODING_MODEL;
  const codingReady = codingConfig.enabled && durable !== undefined && Boolean(codingModelId);
  if (codingReady) {
    const codingDriver = createProductionCodingDriver({
      plannerModel: codingStructuredModel(env.providerBaseUrl, codingModelId),
      proposalModel: codingStructuredModel(env.providerBaseUrl, codingModelId),
      validationCommand: readCodingValidationCommand(),
      onPlanRefused: (runId, reason) => app.log.warn({ runId, reason }, 'governed coding: planning produced no usable plan'),
    });
    registerCodingRunRoutes(app, {
      service: new CodingRunService({
        journal: agentModeCommands.agentRunJournal(),
        driver: codingDriver,
        boundary: { allowedRoots: codingConfig.allowedRoots },
        config: buildAgentRunJournalConfig(),
        // Boundary trace for the dispatch invariant. Non-secret facts only, and
        // the refusal CODE in particular — a refused child registration is
        // otherwise indistinguishable from a run that never began.
        diagnostic: (event) => app.log.info({ coding: event }, 'governed coding boundary'),
      }),
    });
    // Classify, never auto-resume. Nothing below re-invokes a model or re-applies
    // a changeset — an apply live at process death leaves a tree only the diff can
    // describe.
    const codingRecovery = await recoverCodingRuns({
      journal: agentModeCommands.agentRunJournal(),
      readSpan: () => async () => undefined,
      now: Date.now(),
    });
    if (codingRecovery.length) app.log.warn({ codingRecovery }, 'governed coding runs required restart classification');
    app.log.info({ workspaceRootsConfigured: codingConfig.allowedRoots.length }, 'governed coding run API enabled');
  } else {
    // Diagnostics name the missing precondition. A write capability that is quietly
    // absent is indistinguishable from one that is broken.
    for (const diagnostic of codingConfig.diagnostics) app.log.info({ capability: 'governedCoding' }, diagnostic);
    if (codingConfig.enabled && durable === undefined) {
      app.log.warn({ capability: 'governedCoding' }, 'governed coding is enabled but no durable store is available; routes were not mounted.');
    }
  }
  // Always registered, even when the capability is off: a client must be able to
  // discover that governed coding is unavailable and why, rather than inferring it
  // from a 404 on a route that might simply have moved.
  const governedCoding = codingCapability({ config: codingConfig, durable: durable !== undefined, driverReady: codingReady });
  app.get('/api/ai/coding/capability', async () => ({ governedCoding }));
  // Speech, on the same terms: always mounted so "unavailable and why" is discoverable,
  // and delegating to a configured runtime rather than reaching into another application.
  registerSpeechRoutes(app);
  const agentModeReconciliation = await agentModeCommands.reconcileOnStartup();
  if (agentModeReconciliation.scanned > 0) app.log.info({ agentModeReconciliation }, 'Agent Mode durable run reconciliation completed');
  // Private snapshots are released with their proposal, but a process killed
  // mid-preparation cannot run its own cleanup. Reclaim only stale, owner-owned
  // Agent snapshot directories left by such a death.
  const agentSnapshotScavenge = await scavengeStaleAgentSnapshots();
  if (agentSnapshotScavenge.removed > 0) app.log.warn({ agentSnapshotScavenge }, 'Reclaimed stale Agent Mode snapshot directories');
  app.addHook('onClose', async () => { await agentModeCommands.shutdown(); agentActivation.shutdown(); });
  // Connect configured MCP servers and register their tools (best-effort; the
  // brain runs fine with none). Fire-and-forget so a slow server never delays
  // startup — tools appear in the catalog as each server connects.
  void startMcp(toolDeps.registry, env.mcpConfigPath, { log: (m) => app.log.info(m) }).catch(() => {});
  // Route store telemetry (Slice 2) to the app log as structured lines.
  telemetryHub.setWriter((line) => app.log.info(line));
  // MigraAI workspace engineer (/api/ai/engineer): the model-in-the-loop LOCAL
  // engineering agent (Slice 2). Runs through the SAME tool boundary; never
  // mutates (edit.apply is substituted with preview proposals) and never touches
  // the pilot runtime — disabled delegation cannot block local work.
  // The agent path grounds on APPROVED evidence through the shared grounding
  // boundary; `indexedBranchFor` supplies the branch that generation was built
  // from, so branch divergence is disclosed instead of silently ignored.
  // ── Live-knowledge connectors ─────────────────────────────────────────────
  // The authoritative set only: seven Tier 1 connectors reading first-party APIs. No
  // general-web provider is registered, so `web` mode has real evidence and NOT broad
  // coverage — and the host frame says exactly that rather than implying a web search.
  //
  // Registering them grants nothing on its own: live knowledge defaults to `off` and
  // returns before the registry is touched, so no request is made until an operator
  // selects a mode for a turn.
  const liveKnowledgeRegistry = new LiveConnectorRegistry();
  if (env.liveKnowledgeConnectorsEnabled !== false) {
    liveKnowledgeRegistry.registerAuthoritative(
      buildAuthoritativeConnectors({
        fetch: {
          // Resolved addresses are what the fetch layer validates, not just the
          // hostname: a name that answers publicly during validation can answer with a
          // private address a moment later, and hostname-only checks never see it.
          resolve: async (hostname: string) => {
            const records = await dnsLookup(hostname, { all: true });
            return records.map((r) => ({ address: r.address, family: r.family === 6 ? (6 as const) : (4 as const) }));
          },
        },
        // Credentials are read by NAME from the environment at availability time and
        // never stored, logged or rendered. Every one is optional, so a deployment with
        // none configured loses rate limit rather than connectors.
        env: process.env,
        now: () => new Date().toISOString(),
      }),
    );
  }

  registerEngineerRoutes(
    app,
    env,
    modelRegistry,
    toolDeps,
    undefined,
    providerRouting,
    escalation,
    indexService,
    indexedBranchFor,
    undefined,
    liveKnowledgeRegistry,
  );
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
  // `health()` is now async, but `WorkspaceManager` requires a synchronous
  // `() => number`. The schema version is fixed once startup migrations have run,
  // so it is resolved once here and closed over — rather than making the
  // WorkspaceManager contract async for a value that cannot change at runtime.
  const durableSchemaVersion = durable ? (await durable.health()).schemaVersion : 0;
  const workspaceManager = new WorkspaceManager({
    indexService, conversations: memoryStore, agents: agentRegistry, approvedModelsByTier,
    version: engineVersion, schemaVersion: () => durableSchemaVersion,
    persistence: durable ?? undefined, gitInfo,
  });
  // AWAITED for the same reason: workspace→index bindings must exist before the
  // routes below can serve them.
  // Scope-loaded on first request, for the same reason as the index above.
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
