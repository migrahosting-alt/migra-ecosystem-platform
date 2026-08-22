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

import type { Pool, PoolClient } from 'pg';
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
  constructor(
    private readonly pool: Pool,
    /** Owns migrate()/readiness; the aggregate does not re-implement them. */
    private readonly connection: PostgresConnection,
  ) {}

  /* ── connection + transaction boundary ─────────────────────────────────── */

  /**
   * One transaction, one method. Rolls back on any throw and always releases the
   * client — a leaked client is a pool exhaustion that surfaces much later as an
   * unrelated timeout.
   */
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // A failed ROLLBACK must not mask the original error — that is the one the
      // caller needs in order to know what was not stored.
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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
      const client = await this.pool.connect();
      try {
        const v = await client.query<{ version: string }>('SELECT version FROM schema_meta LIMIT 1');
        schemaVersion = Number(v.rows[0]?.version ?? 0);
        readable = true;

        // A transaction that is rolled back: it proves write permission without
        // leaving anything behind.
        await client.query('BEGIN');
        await client.query('CREATE TEMP TABLE migrapilot_write_probe(x int) ON COMMIT DROP');
        await client.query('ROLLBACK');
        writable = true;
      } finally {
        client.release();
      }
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
    await this.pool.end();
  }

  /* ── conversations ─────────────────────────────────────────────────────── */

  async saveConversation(c: Conversation): Promise<void> {
    // The conversation carries its own scope, so nothing has to be passed in.
    await this.inScope({ owner: c.ownerScope, workspace: c.workspaceScope }, (client) =>
      conversations.saveConversation(client, c),
    );
  }

  async deleteConversation(id: string): Promise<void> {
    // Deletion is scope-checked by RLS: a conversation outside the declared
    // scope is simply not visible to the statement.
    await this.tx((client) => conversations.deleteConversation(client, id));
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

  async saveMemoryItem(item: MemoryItem): Promise<void> {
    await this.tx((client) => memoryWorkspaces.saveMemoryItem(client, item));
  }

  async loadMemoryItems(): Promise<MemoryItem[]> {
    return this.tx((client) => memoryWorkspaces.loadMemoryItems(client));
  }

  async saveWorkspace(w: PersistedWorkspace): Promise<void> {
    await this.tx((client) => memoryWorkspaces.saveWorkspace(client, w));
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.tx((client) => memoryWorkspaces.deleteWorkspace(client, id));
  }

  async loadWorkspaces(): Promise<PersistedWorkspace[]> {
    return this.tx((client) => memoryWorkspaces.loadWorkspaces(client));
  }

  /* ── RAG index ─────────────────────────────────────────────────────────── */

  async saveIndex(rec: PersistedIndexRecord): Promise<void> {
    // The record carries both halves of its own scope, so nothing is inferred.
    const scope = { owner: rec.ownerScope, workspace: rec.workspaceId };
    await this.inScope(scope, (client) => rag.saveIndex(client, rec, scoped(scope)));
  }

  async deleteIndex(id: string): Promise<void> {
    await this.tx((client) => rag.deleteIndex(client, id));
  }

  async setIndexState(id: string, state: string, updatedAt: number): Promise<void> {
    await this.tx((client) => rag.setIndexState(client, id, state, updatedAt));
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

  async setApprovedVersion(id: string, approvedVersion: number | null, updatedAt: number): Promise<void> {
    await this.tx((client) => rag.setApprovedVersion(client, id, approvedVersion, updatedAt));
  }

  async loadIndexes(): Promise<PersistedIndexRecord[]> {
    return this.tx((client) => rag.loadIndexes(client));
  }

  async loadChunks(indexId: string, indexVersion: number): Promise<PersistedChunk[]> {
    return this.tx((client) => rag.loadChunks(client, indexId, indexVersion));
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
}
