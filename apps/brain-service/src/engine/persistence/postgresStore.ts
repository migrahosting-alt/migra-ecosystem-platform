/**
 * The PostgreSQL DurableStore.
 *
 * PostgreSQL is the ONLY supported persistence backend for MigraPilot. This
 * aggregate is thin by design: the repositories under `postgres/` already hold
 * the SQL and are tested; what was missing was something that implements
 * `DurableStore` by delegating to them and owns the connection and transaction
 * boundary.
 *
 * TRANSACTION GRANULARITY — one transaction per public method.
 *
 * `DurableStore` does not express a transaction lifetime, so this must not
 * secretly hold one open across independent calls. Two ordinary calls are two
 * transactions, and a caller that needs them to succeed or fail together gets an
 * explicit method for that (see {@link createConversationWithFirstMessage})
 * rather than a transaction handle it has to manage. The rule:
 *
 *   primitive persistence methods are atomic individually;
 *   multi-record business invariants get explicit transactional operations.
 *
 * SCOPE — declared, never inferred.
 *
 * The conversation tables run FORCE ROW LEVEL SECURITY with policies reading
 * `migrapilot.owner_scope`, so a connection that has not declared its scope sees
 * nothing at all. `withScope` sets those settings transaction-locally, so a
 * pooled connection can never leak one caller's scope to the next.
 *
 * A commit failure REJECTS. That is what keeps the durable-write guarantee
 * honest: `durable: true` is only ever returned after persistence really
 * committed, so a caller is never told its data was stored when it was not.
 */

import type { PoolClient } from 'pg';
import * as quota from './postgres/anonymousQuotaRepo.js';
import * as prefs from './postgres/preferencesRepo.js';
import * as claim from './postgres/anonymousClaimRepo.js';
import type { Conversation, Message, Summary, MemoryItem } from '../memory/conversationStore.js';
import type {
  DurableStore,
  PersistenceHealth,
  StoreHealth,
  PersistenceScope,
  PersistedIndexRecord,
  PersistedChunk,
  PersistedWorkspace,
  DurableAuditEvent,
  DurableUsageRecord,
  DurableIncident,
  DurableRecoveryEvent,
  DurableBudgetScope,
  DurableReservation,
  OperationalCounts,
  DurableAgentRun,
  DurableAgentRunEvent,
  DurableAgentRunTombstone,
  DurableAgentRunChild,
  AgentRunChildWriteResult,
  AgentRunChildTransitionInput,
  AgentRunFencedEventInput,
  AgentRunReconciliationClaim,
  AgentRunTransitionInput,
  AgentRunReproposalInput,
  AgentRunReproposalResult,
} from './types.js';

import * as conversations from './postgres/conversationRepo.js';
import * as memoryWorkspaces from './postgres/memoryWorkspaceRepo.js';
import * as rag from './postgres/ragRepo.js';
import * as docs from './postgres/documentProcessingRepo.js';
import * as feedback from './postgres/messageFeedbackRepo.js';
import * as operational from './postgres/operationalRepo.js';
import * as agentRuns from './postgres/agentRunRepo.js';
import * as agentRunChildren from './postgres/agentRunChildRepo.js';
import { latestVersion } from './postgres/migrations.js';
import type { PostgresConnection } from './postgres/pool.js';

/** The pg-side shape. Kept separate so the domain does not import pg types. */
const scoped = (s: PersistenceScope): conversations.ScopedRequest => ({
  ownerScope: s.owner,
  workspaceScope: s.workspace,
});

export class PostgresDurableStore implements DurableStore {
  /**
   * Owns the pool, the transaction helper, migrations and readiness. The
   * aggregate deliberately holds no pool of its own — two owners of one pool is
   * how connections leak.
   */
  constructor(private readonly connection: PostgresConnection) {}

  /* ── connection + transaction boundary ─────────────────────────────────── */

  /**
   * One transaction, one method. Rolls back on any throw and always releases the
   * client — a leaked client is a pool exhaustion that surfaces much later as an
   * unrelated timeout.
   */
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    // Delegates to the connection's transaction helper, which already begins,
    // commits, rolls back on throw and always releases. Re-implementing it here
    // would be a second, divergent copy of the rule that keeps the durable-write
    // guarantee honest.
    return this.connection.transaction(fn);
  }

  /**
   * An UNSCOPED transaction, for platform-global tables.
   *
   * Model qualification is not tenant data: an approval is a statement about
   * which model may serve anyone, so there is no owner scope to declare and
   * `inScope` would be meaningless. Deliberately narrow — anything holding rows
   * that belong to a tenant goes through `inScope`, where row-level security
   * decides what is visible.
   */
  async platformTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.tx(fn);
  }

  /** A transaction that has declared its tenant scope to row-level security. */
  private async inScope<T>(scope: PersistenceScope, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.tx((client) => conversations.withScope(client, scoped(scope), () => fn(client)));
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  async initialize(): Promise<void> {
    await this.connection.migrate();
  }

  async health(): Promise<PersistenceHealth> {
    /*
     * READABLE AND WRITABLE ARE DIFFERENT QUESTIONS.
     *
     * A read-only database answers SELECT perfectly while every durable write
     * fails — a state the canary reproduced, where `/health` said `ready` and
     * writes were refused. Probing both is the only way the answer means
     * anything.
     */
    let readable = false;
    let writable = false;
    let schemaVersion = 0;
    let detail: string | undefined;

    try {
      // schema_meta is a KEY/VALUE table, not a column named `version`. Read it
      // the way pool.ts does, so the two cannot drift into disagreeing about
      // what the schema version is.
      const rows = await this.connection.query<{ value: string }>(
        `SELECT value FROM schema_meta WHERE key = 'schema_version'`,
      );
      schemaVersion = Number(rows[0]?.value ?? 0);
      readable = true;

      // A transaction that is deliberately rolled back: it proves write
      // permission without leaving anything behind.
      await this.connection.transaction(async (client) => {
        await client.query('CREATE TEMP TABLE migrapilot_write_probe(x int) ON COMMIT DROP');
        throw new Error('write probe rollback');
      }).catch((error) => {
        if (error instanceof Error && error.message === 'write probe rollback') {
          writable = true;
          return;
        }
        throw error;
      });
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }

    const migrationsReady = readable && schemaVersion >= latestVersion();

    /*
     * The probe distinguishes READABLE from WRITABLE, which the current public
     * shape cannot express — that widening is Phase 7. Until then the richer
     * fact is mapped conservatively: a store that reads but cannot write is
     * reported DEGRADED rather than ok, because reporting it healthy is exactly
     * the defect the canary caught, where /health said ready while every durable
     * write was refused.
     */
    const status: StoreHealth = !readable ? 'unavailable' : !writable ? 'degraded' : migrationsReady ? 'ready' : 'degraded';
    const why = detail ?? (readable && !writable ? 'database is readable but refuses writes' : undefined);

    return {
      memoryStore: status,
      ragStore: status,
      schemaVersion,
      migrationState: !readable ? 'failed' : migrationsReady ? 'current' : 'pending',
      ...(why ? { detail: why } : {}),
    };
  }

  async integrityCheck(): Promise<string> {
    // PostgreSQL has no `PRAGMA integrity_check`; the equivalent assurance is
    // that the connection is live and the schema is at the expected version.
    const h = await this.health();
    return h.memoryStore === 'ready' && h.migrationState === 'current' ? 'ok' : `degraded: ${h.migrationState}`;
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  /* ── conversations ─────────────────────────────────────────────────────── */

  async saveConversation(c: Conversation): Promise<void> {
    // The conversation carries its own scope, so nothing has to be passed in.
    await this.inScope({ owner: c.ownerScope, workspace: c.workspaceScope }, (client) =>
      conversations.saveConversation(client, c),
    );
  }

  async deleteConversation(id: string, scope: PersistenceScope): Promise<void> {
    // The scope must be DECLARED, not merely relied upon. Under FORCE RLS an
    // undeclared DELETE matches zero rows and reports success — a delete that
    // silently did nothing, and a conversation that returns after a restart.
    await this.inScope(scope, (client) => conversations.deleteConversation(client, id));
  }

  async saveMessage(m: Message, scope: PersistenceScope): Promise<void> {
    await this.inScope(scope, (client) => conversations.saveMessage(client, m, scoped(scope)));
  }

  async saveSummary(s: Summary, scope: PersistenceScope): Promise<void> {
    await this.inScope(scope, (client) => conversations.saveSummary(client, s, scoped(scope)));
  }

  /**
   * A conversation and its first message, atomically.
   *
   * The explicit transactional operation the rule calls for: a caller making two
   * ordinary calls would get two transactions, and a crash between them leaves a
   * conversation whose opening message is missing — acknowledged as stored and
   * absent on reload.
   */
  async createConversationWithFirstMessage(c: Conversation, m: Message): Promise<void> {
    const scope = { owner: c.ownerScope, workspace: c.workspaceScope };
    await this.inScope(scope, async (client) => {
      await conversations.saveConversation(client, c);
      await conversations.saveMessage(client, m, scoped(scope));
    });
  }

  /**
   * Hydration for ONE scope.
   *
   * Deliberately not a global read. Under FORCE RLS an undeclared scope returns
   * zero rows, so a "load everything at startup" call would boot an apparently
   * empty Brain while every row sat safe in the database — a silent, total data
   * loss to anyone reading the UI. Callers load the scope they need.
   */
  async loadDurableForScope(
    scope: PersistenceScope,
  ): Promise<{ conversations: Conversation[]; messages: Message[]; summaries: Summary[] }> {
    return this.inScope(scope, (client) => conversations.loadDurable(client));
  }

  /**
   * @deprecated Global hydration cannot work under row-level security.
   *
   * Kept only so the `DurableStore` shape is satisfied while callers migrate to
   * {@link loadDurableForScope}. It THROWS rather than returning an empty result,
   * because an empty result is indistinguishable from "this tenant has nothing"
   * and would be read as success.
   */
  async loadDurable(): Promise<{ conversations: Conversation[]; messages: Message[]; summaries: Summary[] }> {
    throw new Error(
      'loadDurable() cannot be served under row-level security: a connection with no declared scope sees no rows. ' +
        'Use loadDurableForScope(scope) — returning an empty result here would look like an empty Brain.',
    );
  }

  /* ── memory items + workspaces ─────────────────────────────────────────── */

  async saveMemoryItem(item: MemoryItem, scope?: PersistenceScope): Promise<void> {
    // memory_items runs FORCE RLS; a write with no declared scope is refused by
    // the policy rather than silently stored.
    const declared = scope ?? { owner: (item as { ownerScope?: string }).ownerScope ?? '', workspace: (item as { workspaceScope?: string }).workspaceScope ?? '' };
    await this.inScope(declared, (client) => memoryWorkspaces.saveMemoryItem(client, item));
  }

  /** @deprecated Scope-dependent read; use {@link loadMemoryItemsForScope}. */
  async loadMemoryItems(): Promise<MemoryItem[]> {
    throw new Error(
      'loadMemoryItems() cannot be served under row-level security: an undeclared connection sees no rows. ' +
        'Use loadMemoryItemsForScope(scope).',
    );
  }

  async loadMemoryItemsForScope(scope: PersistenceScope): Promise<MemoryItem[]> {
    return this.inScope(scope, (client) => memoryWorkspaces.loadMemoryItems(client));
  }

  async saveWorkspace(w: PersistedWorkspace): Promise<void> {
    await this.inScope({ owner: w.ownerScope, workspace: w.workspaceScope }, (client) =>
      memoryWorkspaces.saveWorkspace(client, w),
    );
  }

  async deleteWorkspace(id: string, scope: PersistenceScope): Promise<void> {
    await this.inScope(scope, (client) => memoryWorkspaces.deleteWorkspace(client, id));
  }

  /** @deprecated Scope-dependent read; use {@link loadWorkspacesForScope}. */
  async loadWorkspaces(): Promise<PersistedWorkspace[]> {
    throw new Error(
      'loadWorkspaces() cannot be served under row-level security: an undeclared connection sees no rows. ' +
        'Use loadWorkspacesForScope(scope).',
    );
  }

  async loadWorkspacesForScope(scope: PersistenceScope): Promise<PersistedWorkspace[]> {
    return this.inScope(scope, (client) => memoryWorkspaces.loadWorkspaces(client));
  }

  /* ── RAG index ─────────────────────────────────────────────────────────── */

  async saveIndex(rec: PersistedIndexRecord): Promise<void> {
    // The record carries both halves of its own scope, so nothing is inferred.
    const scope = { owner: rec.ownerScope, workspace: rec.workspaceId };
    await this.inScope(scope, (client) => rag.saveIndex(client, rec, scoped(scope)));
  }

  async deleteIndex(id: string, scope: PersistenceScope): Promise<void> {
    await this.inScope(scope, (client) => rag.deleteIndex(client, id));
  }

  async setIndexState(id: string, state: string, updatedAt: number, scope: PersistenceScope): Promise<void> {
    /*
     * THIS IS THE ONE THAT BROKE THE GATE.
     *
     * Unscoped, this UPDATE matched zero rows under FORCE RLS and returned
     * without error, so approving an index persisted NOTHING. The in-memory
     * record said `approved`; the database still said `experimental`; and after
     * a restart the approval was simply gone. A write that changes nothing and
     * reports success is the same lie as a durable write that never committed.
     */
    await this.inScope(scope, (client) => rag.setIndexState(client, id, state, updatedAt));
  }

  async commitSync(
    indexId: string,
    version: number,
    changed: PersistedChunk[],
    changedFiles: string[],
    deletedFiles: string[],
    updatedAt: number,
    scope: PersistenceScope,
  ): Promise<void> {
    // ONE transaction for the whole sync: a half-applied index is a corrupt
    // index, and promotion would then approve content that was never written.
    await this.inScope(scope, (client) =>
      rag.commitSync(client, indexId, version, changed, changedFiles, deletedFiles, updatedAt, scoped(scope)),
    );
  }

  async setApprovedVersion(
    id: string,
    approvedVersion: number | null,
    updatedAt: number,
    scope: PersistenceScope,
  ): Promise<void> {
    await this.inScope(scope, (client) => rag.setApprovedVersion(client, id, approvedVersion, updatedAt));
  }

  /** @deprecated Scope-dependent read; use {@link loadIndexesForScope}. */
  async loadIndexes(): Promise<PersistedIndexRecord[]> {
    throw new Error(
      'loadIndexes() cannot be served under row-level security: an undeclared connection sees no rows. ' +
        'Use loadIndexesForScope(scope).',
    );
  }

  async loadIndexesForScope(scope: PersistenceScope): Promise<PersistedIndexRecord[]> {
    return this.inScope(scope, (client) => rag.loadIndexes(client));
  }

  /**
   * @deprecated Scope-dependent read; use {@link loadChunksForScope}.
   *
   * `index_chunks` runs FORCE row-level security, so an undeclared connection
   * sees zero rows. Returning them would look like an index with no content —
   * the same silent-empty failure as loadDurable, and far harder to notice
   * because an empty index degrades retrieval rather than breaking it.
   */
  async loadChunks(): Promise<PersistedChunk[]> {
    throw new Error(
      'loadChunks() cannot be served under row-level security: an undeclared connection sees no rows. ' +
        'Use loadChunksForScope(scope, indexId, version) — an empty result here would look like an empty index.',
    );
  }

  async loadChunksForScope(
    scope: PersistenceScope,
    indexId: string,
    indexVersion: number,
  ): Promise<PersistedChunk[]> {
    return this.inScope(scope, (client) => rag.loadChunks(client, indexId, indexVersion));
  }

  /**
   * How many chunks the committed version RECORDED, read under the caller's scope.
   *
   * Exists so a caller can tell an index that RESTORED EMPTY apart from one that
   * IS empty. Both report zero loaded chunks, and only one of them makes
   * "no readable content" a true statement about the user's file.
   *
   * Null means "cannot tell" — a pre-M22 version, or a row this scope cannot
   * read — and must never be coerced to zero.
   */
  async recordedChunkCountForScope(
    scope: PersistenceScope, indexId: string, indexVersion: number,
  ): Promise<number | null> {
    return this.inScope(scope, (client) => rag.recordedChunkCount(client, indexId, indexVersion));
  }

  /**
   * Durable readiness for documents read outside a request.
   *
   * Scoped like every other tenant-owned table: an undeclared connection sees no
   * rows, so an empty result means "this scope has no record", never "no such
   * document".
   */
  async recordDocumentReadiness(
    scope: PersistenceScope, readiness: Parameters<typeof docs.recordReadiness>[2], now: number,
  ): Promise<void> {
    await this.inScope(scope, (client) => docs.recordReadiness(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }, readiness, now));
  }

  /*
   * Message feedback. Scoped exactly like every other tenant-owned table, so a
   * vote is visible only to the person who cast it — feedback names a specific
   * answer in a specific conversation, and leaking it across tenants would leak
   * both.
   */
  async putMessageFeedback(
    scope: PersistenceScope, input: Parameters<typeof feedback.putFeedback>[2], now: number,
  ) {
    return this.inScope(scope, (client) => feedback.putFeedback(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }, input, now));
  }

  async removeMessageFeedback(scope: PersistenceScope, conversationId: string, messageId: string) {
    return this.inScope(scope, (client) => feedback.removeFeedback(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }, conversationId, messageId));
  }

  async listMessageFeedback(scope: PersistenceScope, conversationId: string) {
    return this.inScope(scope, (client) => feedback.listFeedbackForConversation(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }, conversationId));
  }

  async readDocumentReadiness(scope: PersistenceScope, fileName: string) {
    return this.inScope(scope, (client) => docs.readReadiness(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }, fileName));
  }

  async listDocumentReadiness(scope: PersistenceScope) {
    return this.inScope(scope, (client) => docs.listReadiness(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }));
  }

  async findInterruptedDocuments(scope: PersistenceScope) {
    return this.inScope(scope, (client) => docs.findInterrupted(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }));
  }

  async deleteDocumentReadiness(scope: PersistenceScope, fileName: string): Promise<void> {
    await this.inScope(scope, (client) => docs.deleteReadiness(client, {
      ownerScope: scope.owner, workspaceScope: scope.workspace,
    }, fileName));
  }

  /* ── embedding cache ───────────────────────────────────────────────────── */

  async getEmbedding(model: string, version: string, contentHash: string): Promise<number[] | undefined> {
    return this.tx((client) => rag.getEmbedding(client, model, version, contentHash));
  }

  async putEmbedding(model: string, version: string, contentHash: string, vector: number[]): Promise<void> {
    await this.tx((client) => rag.putEmbedding(client, model, version, contentHash, vector));
  }

  async pruneOlderThan(cutoffMs: number): Promise<number> {
    return this.tx((client) => rag.pruneOlderThan(client, cutoffMs));
  }

  /* ── operational ───────────────────────────────────────────────────────── */

  async appendAuditEvent(e: DurableAuditEvent): Promise<void> {
    await this.tx((client) => operational.appendAuditEvent(client, e));
  }

  async recentAuditEvents(limit: number): Promise<DurableAuditEvent[]> {
    return this.tx((client) => operational.recentAuditEvents(client, limit));
  }

  async auditByCorrelation(correlationId: string, limit?: number): Promise<DurableAuditEvent[]> {
    return this.tx((client) => operational.auditByCorrelation(client, correlationId, limit));
  }

  async appendUsageRecord(r: DurableUsageRecord): Promise<void> {
    await this.tx((client) => operational.appendUsageRecord(client, r));
  }

  async recentUsageRecords(limit: number): Promise<DurableUsageRecord[]> {
    return this.tx((client) => operational.recentUsageRecords(client, limit));
  }

  async upsertIncident(i: DurableIncident): Promise<void> {
    await this.tx((client) => operational.upsertIncident(client, i));
  }

  async listIncidents(limit: number): Promise<DurableIncident[]> {
    return this.tx((client) => operational.listIncidents(client, limit));
  }

  async appendRecoveryEvent(e: DurableRecoveryEvent): Promise<void> {
    await this.tx((client) => operational.appendRecoveryEvent(client, e));
  }

  async saveBudgetScope(s: DurableBudgetScope): Promise<void> {
    await this.tx((client) => operational.saveBudgetScope(client, s));
  }

  async loadBudgetScopes(): Promise<DurableBudgetScope[]> {
    return this.tx((client) => operational.loadBudgetScopes(client));
  }

  async saveReservation(r: DurableReservation): Promise<void> {
    await this.tx((client) => operational.saveReservation(client, r));
  }

  async removeReservation(reservationId: string): Promise<void> {
    await this.tx((client) => operational.removeReservation(client, reservationId));
  }

  async loadReservations(): Promise<DurableReservation[]> {
    return this.tx((client) => operational.loadReservations(client));
  }

  async pruneOperational(cutoffs: {
    auditBefore: number;
    usageBefore: number;
    incidentsBefore: number;
    recoveryBefore: number;
  }): Promise<{ audit: number; usage: number; incidents: number; recovery: number }> {
    return this.tx((client) => operational.pruneOperational(client, cutoffs));
  }

  async operationalCounts(): Promise<OperationalCounts> {
    return this.tx((client) => operational.operationalCounts(client));
  }

  /* ── agent-run journal ─────────────────────────────────────────────────── */

  async insertAgentRun(run: DurableAgentRun, createdEvent: DurableAgentRunEvent): Promise<void> {
    // Run and its CREATED event are one fact: a run with no opening event has no
    // readable history, and the journal's sequence starts at that event.
    await this.tx((client) => agentRuns.insertAgentRun(client, run, createdEvent));
  }

  async appendAgentRunEvent(event: Omit<DurableAgentRunEvent, 'seq'>): Promise<void> {
    // The interface omits `seq` because the JOURNAL allocates it — the caller
    // must not choose a sequence number, or two writers pick the same one.
    // appendAgentRunEventNext does the allocation inside the transaction.
    await this.tx((client) => agentRuns.appendAgentRunEventNext(client, event));
  }

  async appendAgentRunEventUnderFence(
    input: AgentRunFencedEventInput,
  ): Promise<AgentRunReconciliationClaim | undefined> {
    return this.tx((client) => agentRuns.appendAgentRunEventUnderFence(client, input));
  }

  async transitionAgentRun(input: AgentRunTransitionInput): Promise<boolean> {
    return this.tx((client) => agentRuns.transitionAgentRun(client, input));
  }

  async reproposeAgentRun(input: AgentRunReproposalInput): Promise<AgentRunReproposalResult> {
    return this.tx((client) => agentRuns.reproposeAgentRun(client, input));
  }

  async loadAgentRuns(limit?: number): Promise<DurableAgentRun[]> {
    return this.tx((client) => agentRuns.loadAgentRuns(client, limit));
  }

  async loadAgentRun(runId: string): Promise<DurableAgentRun | undefined> {
    return this.tx((client) => agentRuns.loadAgentRun(client, runId));
  }

  async loadAgentRunEvents(runId: string, limit?: number): Promise<DurableAgentRunEvent[]> {
    return this.tx((client) => agentRuns.loadAgentRunEvents(client, runId, limit));
  }

  async claimAgentRunReconciliation(
    runId: string,
    owner: string,
    leaseUntil: number,
    now: number,
  ): Promise<AgentRunReconciliationClaim | undefined> {
    return this.tx((client) => agentRuns.claimAgentRunReconciliation(client, runId, owner, leaseUntil, now));
  }

  async renewAgentRunReconciliation(
    runId: string,
    owner: string,
    fence: number,
    leaseUntil: number,
    now: number,
  ): Promise<AgentRunReconciliationClaim | undefined> {
    return this.tx((client) => agentRuns.renewAgentRunReconciliation(client, runId, owner, fence, leaseUntil, now));
  }

  async pruneAgentRuns(cutoff: number, batchSize: number, now: number): Promise<{ runs: number; events: number }> {
    return this.tx((client) => agentRuns.pruneAgentRuns(client, cutoff, batchSize, now));
  }

  async loadAgentRunTombstones(limit?: number): Promise<DurableAgentRunTombstone[]> {
    return this.tx((client) => agentRuns.loadAgentRunTombstones(client, limit));
  }
  /* ── agent-run children ────────────────────────────────────────────────── */

  async insertAgentRunChild(child: DurableAgentRunChild): Promise<AgentRunChildWriteResult> {
    return this.tx((client) => agentRunChildren.insertAgentRunChild(client, child));
  }

  async transitionAgentRunChild(input: AgentRunChildTransitionInput): Promise<AgentRunChildWriteResult> {
    return this.tx((client) => agentRunChildren.transitionAgentRunChild(client, input));
  }

  async loadAgentRunChildren(runId: string): Promise<DurableAgentRunChild[]> {
    return this.tx((client) => agentRunChildren.loadAgentRunChildren(client, runId));
  }

  async loadAgentRunChild(childId: string): Promise<DurableAgentRunChild | undefined> {
    return this.tx((client) => agentRunChildren.loadAgentRunChild(client, childId));
  }

  /* ── anonymous chat quota ──────────────────────────────────────────────
   *
   * An anonymous visitor's owner scope IS their identity (`anon:<opaque>`),
   * minted and signed server-side. The workspace half is the same value: a
   * signed-out visitor has exactly one workspace, and inventing a second
   * dimension would be a distinction the product does not make.
   */

  private anonScope(anonymousSessionId: string, ownerScope: string): PersistenceScope {
    return { owner: ownerScope, workspace: ownerScope };
  }

  /** Read for RENDERING. Never the authority for whether a turn may run. */
  async getAnonymousQuota(
    anonymousSessionId: string, ownerScope: string,
  ): Promise<quota.QuotaRow | undefined> {
    return this.inScope(this.anonScope(anonymousSessionId, ownerScope), (client) =>
      quota.getQuota(client, anonymousSessionId));
  }

  /**
   * Take one turn's allowance, atomically, in ONE transaction.
   *
   * ensure → expire → lock → count → insert must share a transaction. Split
   * across calls, the `FOR UPDATE` is released before the insert runs and two
   * concurrent turns both succeed — the exact race the ledger exists to close.
   */
  async reserveAnonymousTurn(input: {
    anonymousSessionId: string;
    ownerScope: string;
    turnLimit: number;
    reservationId: string;
    holdMs: number;
    now: number;
    conversationId?: string;
  }): Promise<quota.ReserveResult> {
    return this.inScope(this.anonScope(input.anonymousSessionId, input.ownerScope), (client) =>
      quota.reserveTurn(client, input));
  }

  /** The turn produced output. Raises if the hold is not there to spend. */
  async consumeAnonymousReservation(
    reservationId: string, ownerScope: string, now: number,
  ): Promise<void> {
    await this.inScope({ owner: ownerScope, workspace: ownerScope }, (client) =>
      quota.consumeReservation(client, reservationId, now));
  }

  /** Infrastructure failed before output. Returns false if already gone. */
  async releaseAnonymousReservation(
    reservationId: string, ownerScope: string,
  ): Promise<boolean> {
    return this.inScope({ owner: ownerScope, workspace: ownerScope }, (client) =>
      quota.releaseReservation(client, reservationId));
  }

  /** Record that this anonymous session was claimed by a signed-in account. */
  async markAnonymousClaimed(
    anonymousSessionId: string, ownerScope: string, claimedBy: string, now: number,
  ): Promise<void> {
    await this.inScope(this.anonScope(anonymousSessionId, ownerScope), (client) =>
      quota.markClaimed(client, anonymousSessionId, claimedBy, now));
  }


  /**
   * Move an anonymous conversation into the account that just signed in.
   *
   * ONE transaction, and deliberately NOT wrapped in `inScope`: the move spans
   * two scopes, declaring each only while it operates in it. That is why it can
   * happen at all — row-level security's WITH CHECK refuses to let a row be
   * rewritten into a scope other than the declared one, which is exactly what
   * stops "make this conversation mine" being something a request can ask for.
   *
   * The quota row is marked claimed in the SAME transaction. If the mark failed
   * after the move committed, the same cookie could be presented again for a
   * second free allowance.
   */
  async claimAnonymousConversation(input: {
    conversationId: string;
    anonymousSessionId: string;
    anonymousOwner: string;
    accountOwner: string;
    accountWorkspace: string;
    now: number;
  }): Promise<claim.ClaimOutcome> {
    return this.connection.transaction(async (client) => {
      const outcome = await claim.claimConversation(
        client,
        input.conversationId,
        {
          anonymousOwner: input.anonymousOwner,
          accountOwner: input.accountOwner,
          accountWorkspace: input.accountWorkspace,
        },
        input.now,
      );

      // Back to the anonymous scope to retire its allowance.
      await client.query(`SELECT set_config('migrapilot.owner_scope', $1, true)`, [input.anonymousOwner]);
      await client.query(`SELECT set_config('migrapilot.workspace_scope', $1, true)`, [input.anonymousOwner]);
      await quota.markClaimed(client, input.anonymousSessionId, input.accountOwner, input.now);

      return outcome;
    });
  }


  /* ── MigraPilot preferences ────────────────────────────────────────────
   *
   * Scoped like everything else. Identity stays in MigraAuth: nothing here
   * stores a name, an email, an avatar or a provider link.
   */

  /** Read, or report defaults. Never creates a row — a page view is not a write. */
  async getUserPreferences(scope: PersistenceScope): Promise<prefs.PreferencesRow> {
    return this.inScope(scope, (client) => prefs.getPreferences(client, scope.owner));
  }

  /**
   * Apply a partial update and record the audited keys, in ONE transaction.
   *
   * `inScope` already runs its callback inside one transaction with the scope
   * declared, which is what makes the audit trail trustworthy: a preference
   * change that committed without its event, or an event without its change, is
   * a log that disagrees with the product.
   */
  async patchUserPreferences(input: {
    scope: PersistenceScope;
    patch: unknown;
    now: number;
    eventId: string;
    auditedKeys: readonly string[];
  }): Promise<prefs.PatchResult> {
    return this.inScope(input.scope, async (client) => {
      const result = await prefs.patchPreferences(client, {
        ownerScope: input.scope.owner,
        workspaceScope: input.scope.workspace,
        patch: input.patch,
        now: input.now,
      });

      const audited = result.changed.filter((key) => input.auditedKeys.includes(key));
      await prefs.recordPreferenceEvent(client, {
        id: input.eventId,
        ownerScope: input.scope.owner,
        changedKeys: audited,
        now: input.now,
      });

      return result;
    });
  }

  async listPreferenceEvents(scope: PersistenceScope, limit?: number): Promise<prefs.PreferenceEvent[]> {
    return this.inScope(scope, (client) => prefs.listPreferenceEvents(client, scope.owner, limit));
  }

  async deleteUserPreferences(scope: PersistenceScope): Promise<{ preferences: number; events: number }> {
    return this.inScope(scope, (client) => prefs.deletePreferences(client, scope.owner));
  }
}
