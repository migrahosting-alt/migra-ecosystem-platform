import { createHash, createHmac, randomBytes } from 'node:crypto';
import type {
  AgentModeCommandPreview,
  AgentModeCommandResult,
  AgentModeRunHistoryDetail,
  AgentModeRunHistoryEvent,
  AgentModeRunHistoryExport,
  AgentModeRunHistoryExportRequest,
  AgentModeRunHistoryList,
  AgentModeRunHistoryQuery,
  AgentModeRunHistorySummary,
  AgentModeRunRecoveryStatus,
} from '@migrapilot/protocol';
import { AGENT_TERMINAL_STATES, AgentRunJournal } from './agentRunJournal.js';
import type { AgentModeRequestContext } from './agentModeCommandService.js';
import { validateRecoverySourceProvenance } from './recoverySourceProvenance.js';
import { redactValue } from './redaction.js';
import type { DurableAgentRun, DurableAgentRunEvent, DurableAgentRunTombstone } from './persistence/types.js';

export type AgentRunHistoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'UNKNOWN_RUN' | 'INVALID_CONTEXT' | 'INVALID_INPUT'; message: string };

interface CursorPayload {
  workspaceIdentity: string;
  sort: AgentModeRunHistoryQuery['sort'];
  value: number;
  runId: string;
  expiresAt: number;
}

const CURSOR_TTL_MS = 15 * 60_000;
const MAX_SCAN = 5_000;

export class AgentRunHistoryService {
  private readonly cursorKey: Buffer;

  constructor(
    private readonly journal: AgentRunJournal,
    private readonly recoveryStatus: (run: DurableAgentRun, context: AgentModeRequestContext, events?: DurableAgentRunEvent[]) => AgentModeRunRecoveryStatus | Promise<AgentModeRunRecoveryStatus>,
    private readonly now: () => number = () => Date.now(),
    cursorKey: Buffer = randomBytes(32),
  ) {
    this.cursorKey = Buffer.from(cursorKey);
  }

  async list(query: AgentModeRunHistoryQuery, context: AgentModeRequestContext): Promise<AgentRunHistoryResult<AgentModeRunHistoryList>> {
    if (!validContext(context)) return denied();
    const cursor = query.cursor ? this.decodeCursor(query.cursor, context.workspaceIdentity, query.sort) : undefined;
    if (query.cursor && !cursor) return { ok: false, code: 'INVALID_INPUT', message: 'The Agent run history cursor is invalid or expired.' };
    const all = await this.filteredRuns(query, context);
    const after = cursor ? all.filter((run) => afterCursor(run, query.sort, cursor)) : all;
    const page = after.slice(0, query.limit);
    const next = after.length > query.limit ? page.at(-1) : undefined;
    return {
      ok: true,
      value: {
        runs: await Promise.all(page.map(async (run) => this.summary(run, context, await this.journal.events(run.runId)))),
        nextCursor: next ? this.encodeCursor(context.workspaceIdentity, query.sort, sortValue(next, query.sort), next.runId) : undefined,
        query,
        retention: {
          terminalRetentionMs: this.journal.config.terminalRetentionMs,
          retentionBatchSize: this.journal.config.retentionBatchSize,
          tombstoneCount: (await this.journal.tombstones(500)).length,
          governance: 'READ_ONLY',
        },
      },
    };
  }

  async detail(runId: string, context: AgentModeRequestContext): Promise<AgentRunHistoryResult<AgentModeRunHistoryDetail>> {
    const run = await this.visibleRun(runId, context);
    if (!run) return { ok: false, code: 'UNKNOWN_RUN', message: 'Unknown Agent Mode run.' };
    return { ok: true, value: await this.detailForRun(run, context) };
  }

  async export(runId: string, request: AgentModeRunHistoryExportRequest, context: AgentModeRequestContext): Promise<AgentRunHistoryResult<AgentModeRunHistoryExport>> {
    const run = await this.visibleRun(runId, context);
    if (!run) return { ok: false, code: 'UNKNOWN_RUN', message: 'Unknown Agent Mode run.' };
    const detail = await this.detailForRun(run, context);
    const body: AgentModeRunHistoryDetail = {
      ...detail,
      preview: request.includePreview ? detail.preview : undefined,
      result: request.includeResultSummary ? detail.result : undefined,
      timeline: request.includeTimeline ? detail.timeline : [],
    };
    const canonical = canonicalJson(body);
    return {
      ok: true,
      value: {
        runId,
        generatedAt: this.now(),
        mediaType: 'application/vnd.migrapilot.agent-run-evidence+json;v=1',
        manifest: {
          digest: createHash('sha256').update(canonical).digest('hex'),
          algorithm: 'sha256',
          canonicalBytes: Buffer.byteLength(canonical),
          schemaVersion: 1,
          redaction: 'sanitized-history-only',
        },
        body,
      },
    };
  }

  private async filteredRuns(query: AgentModeRunHistoryQuery, context: AgentModeRequestContext): Promise<DurableAgentRun[]> {
    const q = query.q?.toLowerCase();
    return (await this.journal.loadRuns())
      .filter((run) => run.workspaceIdentity === context.workspaceIdentity)
      .filter((run) => context.allowedRecipes.includes(run.recipeId as never))
      .filter((run) => !query.state || run.state === query.state)
      .filter((run) => !query.recipe || run.recipeId === query.recipe)
      .filter((run) => !query.recoveryClass || run.recoveryClass === query.recoveryClass)
      .filter((run) => query.recoveryEligible === undefined || run.recoveryEligible === query.recoveryEligible)
      .filter((run) => query.from === undefined || sortValue(run, query.sort) >= query.from!)
      .filter((run) => query.to === undefined || sortValue(run, query.sort) <= query.to!)
      .filter((run) => !q || [run.runId, run.correlationId, run.recipeId, run.state, run.recoveryReason, run.failureCode, run.snapshotId].some((value) => value?.toLowerCase().includes(q)))
      .sort((left, right) => sortValue(right, query.sort) - sortValue(left, query.sort) || right.runId.localeCompare(left.runId))
      .slice(0, MAX_SCAN);
  }

  private async visibleRun(runId: string, context: AgentModeRequestContext): Promise<DurableAgentRun | undefined> {
    if (!validContext(context)) return undefined;
    const run = await this.journal.loadRun(runId);
    if (!run || run.workspaceIdentity !== context.workspaceIdentity) return undefined;
    if (!context.allowedRecipes.includes(run.recipeId as never)) return undefined;
    return run;
  }

  private async detailForRun(run: DurableAgentRun, context: AgentModeRequestContext): Promise<AgentModeRunHistoryDetail> {
    const events = await this.journal.events(run.runId);
    const summary = await this.summary(run, context, events);
    const tombstone = (await this.journal.tombstones(500)).find((entry) => entry.runId === run.runId);
    return {
      summary,
      preview: safePreview(run.previewJson, run),
      result: safeResult(run.resultJson),
      error: safeJson<{ code: string; message: string }>(run.errorJson),
      timeline: events.map((event) => historyEvent(event, run.proposalFingerprint)),
      lineage: {
        sourceRunId: run.recoverySourceRunId,
        successorRunId: run.successorRunId,
        source: run.recoverySourceRunId ? await this.optionalSummary(run.recoverySourceRunId, context) : undefined,
        successor: run.successorRunId ? await this.optionalSummary(run.successorRunId, context) : undefined,
      },
      recovery: AGENT_TERMINAL_STATES.has(run.state as never) ? await this.recoveryStatus(run, context, events) : undefined,
      retention: {
        eligibleForDeletion: retentionEligible(run, this.now() - this.journal.config.terminalRetentionMs, this.now()),
        reason: retentionReason(run, this.now() - this.journal.config.terminalRetentionMs, this.now()),
        tombstone: tombstone ? tombstoneView(tombstone) : undefined,
      },
    };
  }

  private async optionalSummary(runId: string, context: AgentModeRequestContext): Promise<AgentModeRunHistorySummary | undefined> {
    const run = await this.visibleRun(runId, context);
    return run ? this.summary(run, context, await this.journal.events(run.runId)) : undefined;
  }

  /**
   * `events` is REQUIRED. It used to default to a journal read, which under an
   * async journal would be a hidden refresh at an unpredictable point. Callers
   * pass the authoritative events they already loaded.
   */
  private async summary(run: DurableAgentRun, context: AgentModeRequestContext, events: DurableAgentRunEvent[]): Promise<AgentModeRunHistorySummary> {
    const integrity = historyIntegrity(run, events, context, this.now());
    // Recovery classification is DERIVED from the authoritative contract, not
    // read back from the stored columns. Rows written before the policy was
    // corrected — including any still carrying a stale recovery_eligible=1 —
    // therefore normalize on read without a destructive migration.
    const derived = AGENT_TERMINAL_STATES.has(run.state as never)
      ? validateRecoverySourceProvenance({ run, events, workspaceIdentity: context.workspaceIdentity, allowedRecipes: context.allowedRecipes, now: this.now() })
      : undefined;
    return {
      runId: run.runId,
      requestId: run.correlationId,
      state: run.state as AgentModeRunHistorySummary['state'],
      recipe: run.recipeId as AgentModeRunHistorySummary['recipe'],
      requestedAt: run.requestedAt,
      updatedAt: run.updatedAt,
      terminalAt: run.terminalAt,
      approvalLifecycle: run.approvalLifecycle,
      recoveryClass: derived ? derived.recoveryClass : run.recoveryClass,
      recoveryEligible: derived ? derived.eligible : run.recoveryEligible,
      recoveryReason: run.recoveryReason,
      recoverySourceRunId: run.recoverySourceRunId,
      successorRunId: run.successorRunId,
      snapshotId: run.snapshotId,
      mutationClassification: run.mutationClassification,
      networkPolicy: run.networkPolicy,
      eventCount: events.length,
      integrity: integrity.level,
      integrityIssues: integrity.issues,
    };
  }

  private encodeCursor(workspaceIdentity: string, sort: AgentModeRunHistoryQuery['sort'], value: number, runId: string): string {
    const payload: CursorPayload = { workspaceIdentity, sort, value, runId, expiresAt: this.now() + CURSOR_TTL_MS };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.cursorKey).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  private decodeCursor(raw: string, workspaceIdentity: string, sort: AgentModeRunHistoryQuery['sort']): CursorPayload | undefined {
    const [body, mac] = raw.split('.');
    if (!body || !mac) return undefined;
    const expected = createHmac('sha256', this.cursorKey).update(body).digest('base64url');
    if (expected !== mac) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
      if (payload.workspaceIdentity !== workspaceIdentity || payload.sort !== sort || payload.expiresAt <= this.now()) return undefined;
      return payload;
    } catch {
      return undefined;
    }
  }
}

/** Integrity describes whether the durable record is coherent — nothing else.
 *
 * It is deliberately independent of recovery eligibility: a run that policy will
 * not let you recover from (completed, superseded by a successor) has perfectly
 * intact history and must read TRUSTED. Stored eligibility is never compared
 * against policy here, because a stale stored flag is a normalization concern,
 * not evidence of tampering. */
function historyIntegrity(run: DurableAgentRun, events: DurableAgentRunEvent[], context: AgentModeRequestContext, now: number): { level: 'TRUSTED' | 'WARNING' | 'UNTRUSTED'; issues: string[] } {
  const issues: string[] = [];
  const untrusted: string[] = [];
  if (run.workspaceIdentity !== context.workspaceIdentity) untrusted.push('workspace mismatch');
  if (!context.allowedRecipes.includes(run.recipeId as never)) issues.push('recipe unavailable');
  if (events.length !== run.auditSeq) untrusted.push('event count does not match audit sequence');
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.seq !== index + 1) untrusted.push('event sequence gap');
  }
  if (AGENT_TERMINAL_STATES.has(run.state as never)) {
    const provenance = validateRecoverySourceProvenance({ run, events, workspaceIdentity: context.workspaceIdentity, allowedRecipes: context.allowedRecipes, now });
    // provenance.trusted is false only for real incoherence; policy and lineage
    // outcomes report trusted with eligible=false.
    if (!provenance.trusted) untrusted.push(`durable history failed provenance validation (${provenance.code})`);
  }
  return { level: untrusted.length > 0 ? 'UNTRUSTED' : issues.length > 0 ? 'WARNING' : 'TRUSTED', issues: [...untrusted, ...issues] };
}

function historyEvent(event: DurableAgentRunEvent, proposalFingerprint?: string): AgentModeRunHistoryEvent {
  return {
    eventId: event.eventId,
    seq: event.seq,
    at: event.at,
    type: event.type,
    priorState: event.priorState as AgentModeRunHistoryEvent['priorState'],
    nextState: event.nextState as AgentModeRunHistoryEvent['nextState'],
    // approval.displayed carries the proposal fingerprint as its reason. Replace
    // it by exact match so unrelated reasons stay legible.
    reason: proposalFingerprint && event.reason === proposalFingerprint ? REDACTED_AUTHORITY_BINDING : event.reason,
    source: event.source,
  };
}

function tombstoneView(tombstone: DurableAgentRunTombstone): NonNullable<AgentModeRunHistoryDetail['retention']['tombstone']> {
  return {
    runId: tombstone.runId,
    finalState: tombstone.finalState as never,
    terminalAt: tombstone.terminalAt,
    deletedAt: tombstone.deletedAt,
    deletionReason: tombstone.deletionReason,
    finalAuditSeq: tombstone.finalAuditSeq,
    eventCount: tombstone.eventCount,
  };
}

function sortValue(run: DurableAgentRun, sort: AgentModeRunHistoryQuery['sort']): number {
  if (sort === 'requestedAt.desc') return run.requestedAt;
  if (sort === 'terminalAt.desc') return run.terminalAt ?? 0;
  return run.updatedAt;
}

function afterCursor(run: DurableAgentRun, sort: AgentModeRunHistoryQuery['sort'], cursor: CursorPayload): boolean {
  const value = sortValue(run, sort);
  return value < cursor.value || (value === cursor.value && run.runId.localeCompare(cursor.runId) < 0);
}

function retentionEligible(run: DurableAgentRun, cutoff: number, now: number): boolean {
  return run.terminalAt !== undefined
    && run.terminalAt < cutoff
    && AGENT_TERMINAL_STATES.has(run.state as never)
    && (!run.reconciliationOwner || (run.reconciliationLeaseUntil ?? 0) < now);
}

function retentionReason(run: DurableAgentRun, cutoff: number, now: number): string {
  if (run.terminalAt === undefined || !AGENT_TERMINAL_STATES.has(run.state as never)) return 'Run is not terminal.';
  if (run.terminalAt >= cutoff) return 'Terminal run is inside the configured retention window.';
  if (run.reconciliationOwner && (run.reconciliationLeaseUntil ?? 0) >= now) return 'Run has an active reconciliation lease.';
  return 'Terminal run is outside the retention window and may be deleted by retention cleanup.';
}

function safeJson<T>(json: string | undefined): T | undefined {
  if (!json) return undefined;
  try {
    return redactValue(JSON.parse(json)) as T;
  } catch {
    return undefined;
  }
}

/** Marker for values that participate in an authorization-binding comparison.
 * The durable record keeps them; sanitized evidence must not carry them. */
export const REDACTED_AUTHORITY_BINDING = '[REDACTED_AUTHORITY_BINDING]';

function safePreview(json: string | undefined, run: DurableAgentRun): AgentModeCommandPreview | undefined {
  const preview = safeJson<AgentModeCommandPreview>(json);
  if (!preview) return undefined;
  return {
    ...preview,
    // The stored preview was scrubbed by the generic high-entropy redactor at
    // write time, which also caught this schema-defined field. Re-project it
    // from the authoritative column so the canonical snapshot identifier is
    // consistent with summary.snapshotId. This is field-specific and
    // schema-bound: arbitrary high-entropy values stay redacted.
    snapshotId: run.snapshotId,
    // Inert once terminal, but it is compared during approval binding and is not
    // needed to understand the exported history.
    fingerprint: REDACTED_AUTHORITY_BINDING,
    sourceWorkspace: '[REDACTED PATH]',
    executable: '[REDACTED PATH]',
    cwd: '[REDACTED PATH]',
    arguments: preview.arguments.map((arg) => pathLike(arg) ? '[REDACTED PATH]' : arg),
    environment: preview.environment.map((entry) => ({ ...entry, value: '[SERVER CONTROLLED]', redacted: true })),
  };
}

function safeResult(json: string | undefined): AgentModeCommandResult | undefined {
  const result = safeJson<AgentModeCommandResult>(json);
  if (!result) return undefined;
  return {
    ...result,
    stdout: result.stdout ? '[REDACTED OUTPUT]' : '',
    stderr: result.stderr ? '[REDACTED OUTPUT]' : '',
    redacted: true,
  };
}

function pathLike(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validContext(context: AgentModeRequestContext): boolean {
  return Boolean(context.activationId && context.workspaceRoot && context.workspaceIdentity && context.allowedRecipes.length > 0);
}

function denied<T>(): AgentRunHistoryResult<T> {
  return { ok: false, code: 'INVALID_CONTEXT', message: 'The Agent Mode session or workspace context is invalid.' };
}
