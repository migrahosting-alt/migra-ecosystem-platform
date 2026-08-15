/**
 * MigraAI Engine — the governed coding run service.
 *
 * Everything a route needs, and nothing a route may decide. Routes validate
 * transport input and map outcomes to status codes; every workflow transition
 * lives here, so there is exactly one place where a run can change state and
 * exactly one set of rules governing it.
 *
 * ── The registry is not the truth ───────────────────────────────────────────
 *
 * An in-process registry tracks which runs THIS process is currently executing,
 * so cancellation has something to signal. It is not authority. After a restart
 * the registry is empty while the journal still holds runs that were mid-flight —
 * and "absent from the registry" must never be read as "finished". The journal
 * says what durably happened; the registry only says who is holding the handle
 * right now.
 *
 * ── Detached work is still accountable ──────────────────────────────────────
 *
 * Planning and resumption continue after the HTTP response returns. Every such
 * task has its rejection caught and persisted as a truthful workflow failure. An
 * unhandled rejection would leave a run permanently `planning` with nothing
 * explaining why, which is the exact state this project keeps eliminating.
 *
 * © MigraTeck LLC.
 */

import { randomUUID } from 'node:crypto';
import type { AgentModeCommandPreview } from '@migrapilot/protocol';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { auditHash, auditStore, type AuditEventType } from '../auditLog.js';

/** The coding events this service may emit. Narrowed from AuditEventType so a
 * typo cannot silently become an unaudited mutation. */
type CodingAuditType = Extract<AuditEventType, `coding.${string}`>;
import {
  AgentRunJournal,
  readDomainPayload,
  serializeDomainPayload,
  type AgentRunJournalConfig,
} from '../agentRunJournal.js';
import type { DurableAgentRun, DurableAgentRunState } from '../persistence/types.js';
import { JournaledCodingRun, type CodingDiagnosticSink, type CodingRunStore } from './journaledCodingRun.js';
import { codingCompletionEligibility } from './codingChildren.js';
import {
  CODING_DOMAIN_KIND,
  CODING_PAYLOAD_SCHEMA_VERSION,
  initialCodingPayload,
  parseCodingPayload,
  type CodingRunPayloadV1,
} from './codingRunPayload.js';

// ── Result vocabulary ────────────────────────────────────────────────────────

export type CodingConflictReason =
  | 'stale_revision'
  | 'scope_hash_mismatch'
  | 'approval_expired'
  | 'approval_invalidated'
  | 'approval_already_consumed'
  | 'invalid_state'
  | 'cancellation_requested';

export interface CodingRunConflictBody {
  error: 'coding_run_conflict';
  reason: CodingConflictReason;
  currentRevision: number;
  currentState: string;
  currentPhase: string;
}

/** The durable record exists but cannot be safely interpreted. Deliberately NOT
 * a 404: "we cannot read this run" and "this run does not exist" are different
 * facts, and collapsing them would hide corruption behind a missing resource. */
export interface CodingRunCorruption {
  error: 'coding_run_unreadable';
  runId: string;
  reason: 'payload_malformed' | 'payload_unsupported_version' | 'payload_absent';
  currentRevision: number;
  currentState: string;
  recoverable: boolean;
  detail: string;
}

export type CodingServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'not_found' }
  | { ok: false; kind: 'conflict'; body: CodingRunConflictBody }
  | { ok: false; kind: 'invalid'; message: string }
  | { ok: false; kind: 'forbidden'; message: string }
  | { ok: false; kind: 'unreadable'; body: CodingRunCorruption };

// ── Snapshot ─────────────────────────────────────────────────────────────────

export interface CodingRunSnapshot {
  runId: string;
  revision: number;
  state: string;
  phase: string;
  issueSummary?: string;
  scope?: {
    proposedPaths: string[];
    pathSetHash: string;
    approvalState: string;
    approvalExpiresAt: string;
    proposedAt: string;
    approvedAt?: string;
    /** Counts and line ranges only — never file contents. */
    evidence: Array<{ path: string; spans: Array<{ startLine: number; endLine: number; excerptHash: string }> }>;
    rationales: Array<{ path: string; rationale: string }>;
    excluded: Array<{ path: string; reason: string }>;
  };
  children: Array<{
    childId: string;
    kind: string;
    attempt: number;
    state: string;
    required: boolean;
    terminalCategory?: string;
  }>;
  cancellation?: { requestedAt: string; confirmedAt?: string; status: 'cancelling' | 'cancelled' };
  latestValidation?: {
    commandRunId: string;
    command: string[];
    exitCode: number | null;
    timedOut: boolean;
    passed: boolean;
    /** Bounded head only. Full streams stay out of the API surface. */
    outputHead: string;
  };
  blockers: string[];
  finalReport?: {
    stopReason: string;
    complete: boolean;
    changedFiles: string[];
    approvedPaths: string[];
    refusedPaths: string[];
    unusedScope: string[];
    unresolvedRisks: string[];
  };
  statusUrl: string;
}

const OUTPUT_HEAD_CHARS = 400;

// ── Workspace containment ────────────────────────────────────────────────────

export interface WorkspaceBoundary {
  /** Canonical absolute roots a coding run may operate under. */
  allowedRoots: readonly string[];
}

/**
 * Resolve a caller-supplied workspace root, or refuse it.
 *
 * A path in a request body is a REQUEST, not an entitlement. It is required to be
 * absolute, canonicalised through `realpath` (so a symlink cannot point outside
 * after the check), and contained within a configured boundary compared on path
 * SEGMENTS — a prefix string compare would accept `/srv/work-evil` for a boundary
 * of `/srv/work`.
 */
export async function resolveWorkspaceRoot(
  raw: string,
  boundary: WorkspaceBoundary,
): Promise<{ ok: true; canonical: string } | { ok: false; message: string }> {
  const candidate = (raw ?? '').trim();
  if (!candidate) return { ok: false, message: 'workspaceRoot is required.' };
  // UNC and Windows network paths are not a supported containment domain.
  if (candidate.startsWith('\\\\') || candidate.startsWith('//')) {
    return { ok: false, message: 'Network (UNC) workspace roots are not supported.' };
  }
  if (!isAbsolute(candidate)) return { ok: false, message: 'workspaceRoot must be an absolute path.' };
  if (candidate.split(/[/\\]/).includes('..')) return { ok: false, message: 'workspaceRoot must not contain traversal segments.' };

  const canonical = await realpath(resolve(candidate)).catch(() => undefined);
  if (!canonical) return { ok: false, message: 'workspaceRoot does not exist.' };
  const info = await stat(canonical).catch(() => undefined);
  if (!info?.isDirectory()) return { ok: false, message: 'workspaceRoot is not a directory.' };

  if (!boundary.allowedRoots.length) return { ok: false, message: 'No workspace boundary is configured; refusing to operate.' };
  const contained = boundary.allowedRoots.some((root) => isWithin(canonical, root));
  if (!contained) return { ok: false, message: 'workspaceRoot is outside the allowed workspace boundary.' };
  return { ok: true, canonical };
}

/** Segment-aware containment. `/srv/work-evil` is NOT inside `/srv/work`. */
function isWithin(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(normalizedRoot);
}

// ── Workflow driver ──────────────────────────────────────────────────────────

export interface CodingWorkflowContext {
  run: JournaledCodingRun;
  runId: string;
  workspaceRoot: string;
  issueText: string;
  signal: AbortSignal;
}

/**
 * The domain work, injected.
 *
 * Keeps model providers and the mutation engine out of the service (and far out
 * of the routes), and lets the packaged-VSIX acceptance drive a scripted provider
 * through the identical code path a real model takes.
 */
export interface CodingWorkflowDriver {
  /** Plan, then park at the approval boundary. Must not mutate. */
  plan(ctx: CodingWorkflowContext): Promise<void>;
  /** Apply, validate, repair, reconcile, finalize. Only after a consumed approval. */
  resume(ctx: CodingWorkflowContext): Promise<void>;
}

// ── The store binding ────────────────────────────────────────────────────────

/**
 * Binds a JournaledCodingRun to the durable journal.
 *
 * Async because the canonical run state is loaded ONCE, here. Every later read
 * is served from that cache; only writes touch the journal. See CodingRunStore
 * for the full contract and the single-writer assumption it states.
 */
export async function journalCodingStore(
  journal: AgentRunJournal,
  runId: string,
  maxPayloadBytes: number,
  now: () => number,
): Promise<CodingRunStore> {
  const parse = (run: DurableAgentRun): CodingRunPayloadV1 => {
    const read = readDomainPayload<unknown>(run, { kind: CODING_DOMAIN_KIND, maxSchemaVersion: CODING_PAYLOAD_SCHEMA_VERSION });
    if (!read.ok) throw new Error(`coding payload unreadable: ${read.code}`);
    const parsed = parseCodingPayload(read.payload);
    if (!parsed.ok) throw new Error(`coding payload invalid: ${parsed.fault}`);
    return parsed.payload;
  };

  const fetch = async (): Promise<{ state: DurableAgentRunState; payload: CodingRunPayloadV1; version: number }> => {
    const run = await journal.loadRun(runId);
    if (!run) throw new Error(`unknown coding run ${runId}`);
    return { state: run.state, payload: parse(run), version: run.version };
  };

  // The canonical cache. Populated once at construction so the synchronous
  // readers below can never be the thing that discovers the run is missing.
  let cache = await fetch();

  return {
    readPayload(): CodingRunPayloadV1 {
      return cache.payload;
    },
    parentState(): DurableAgentRunState {
      return cache.state;
    },
    revision(): number {
      return cache.version;
    },
    async reload(): Promise<void> {
      cache = await fetch();
    },
    async writePayload(payload: CodingRunPayloadV1, note: string): Promise<boolean> {
      const written = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: CODING_PAYLOAD_SCHEMA_VERSION, payload }, maxPayloadBytes);
      if (!written.ok) return false;
      // Same-state transition: the payload write IS a durable parent revision, so
      // every payload change is versioned and audited like any other.
      //
      // `expectedState` comes from the CACHE, which is what makes this a real CAS
      // rather than last-write-wins: if anything moved the run since this store
      // loaded, the journal refuses and the cache stays untouched.
      const ok = await journal.transition({
        runId,
        expectedState: cache.state as never,
        nextState: cache.state as never,
        at: now(),
        eventType: `coding.${note}`,
        source: 'API',
        domainKind: written.kind,
        domainSchemaVersion: written.schemaVersion,
        domainPayloadJson: written.json,
      });
      // Cache updates ONLY after the journal accepted the write.
      if (ok) cache = { ...cache, payload, version: cache.version + 1 };
      return ok;
    },
    async transitionParent(next: DurableAgentRunState, note: string, payload?: CodingRunPayloadV1): Promise<boolean> {
      if (cache.state === next && !payload) return true;
      let domain: { domainKind: string; domainSchemaVersion: number; domainPayloadJson: string } | undefined;
      if (payload) {
        const written = serializeDomainPayload({ kind: CODING_DOMAIN_KIND, schemaVersion: CODING_PAYLOAD_SCHEMA_VERSION, payload }, maxPayloadBytes);
        // A payload that cannot be stored must not be silently dropped while the
        // state moves on without it.
        if (!written.ok) return false;
        domain = { domainKind: written.kind, domainSchemaVersion: written.schemaVersion, domainPayloadJson: written.json };
      }
      const ok = await journal.transition({
        runId,
        expectedState: cache.state as never,
        nextState: next as never,
        at: now(),
        eventType: `coding.${note}`,
        source: 'API',
        ...(domain ?? {}),
        ...(next === 'COMPLETED' || next === 'FAILED' || next === 'CANCELLED' || next === 'REJECTED' ? { terminalAt: now() } : {}),
      });
      // State and payload move together or not at all — the same all-or-nothing
      // the durable revision itself has.
      if (ok) {
        cache = {
          state: next,
          payload: payload ?? cache.payload,
          version: cache.version + 1,
        };
      }
      return ok;
    },
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface StartCodingRunInput {
  issueText: string;
  workspaceRoot: string;
  expectedRepository?: { headSha?: string; dirtyFingerprint?: string };
}

export interface StartCodingRunResult {
  runId: string;
  revision: number;
  state: string;
  phase: string;
  statusUrl: string;
}

interface ExecutorHandle {
  controller: AbortController;
  task: Promise<void>;
}

export interface CodingRunServiceOptions {
  journal: AgentRunJournal;
  driver: CodingWorkflowDriver;
  boundary: WorkspaceBoundary;
  config: Pick<AgentRunJournalConfig, 'maxDomainPayloadBytes'>;
  now?: () => number;
  newRunId?: () => string;
  /** Boundary trace for the dispatch invariant. Non-secret facts only. */
  diagnostic?: CodingDiagnosticSink;
  /** Approval window. Matches the edit-scope TTL so neither outlives the other. */
  approvalTtlMs?: number;
}

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;

export class CodingRunService {
  /** Runs THIS process is executing. Never consulted for durable truth. */
  private readonly executors = new Map<string, ExecutorHandle>();
  private readonly now: () => number;
  private readonly newRunId: () => string;
  private readonly approvalTtlMs: number;

  constructor(private readonly opts: CodingRunServiceOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.newRunId = opts.newRunId ?? (() => `codingrun_${randomUUID()}`);
    this.approvalTtlMs = opts.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  /** Whether this process currently holds an executor. NOT a completion signal. */
  hasExecutor(runId: string): boolean {
    return this.executors.has(runId);
  }

  private async runFor(runId: string): Promise<JournaledCodingRun> {
    return new JournaledCodingRun(
      this.opts.journal,
      runId,
      await journalCodingStore(this.opts.journal, runId, this.opts.config.maxDomainPayloadBytes, this.now),
      this.now,
      undefined,
      (event) => this.opts.diagnostic?.(event),
    );
  }

  // ── 1. start ───────────────────────────────────────────────────────────────

  async start(input: StartCodingRunInput): Promise<CodingServiceResult<StartCodingRunResult>> {
    const issueText = (input.issueText ?? '').trim();
    if (!issueText) return { ok: false, kind: 'invalid', message: 'issueText is required.' };

    const workspace = await resolveWorkspaceRoot(input.workspaceRoot ?? '', this.opts.boundary);
    if (!workspace.ok) return { ok: false, kind: 'forbidden', message: workspace.message };

    const runId = this.newRunId();
    const at = this.now();
    const payload = initialCodingPayload(issueText);
    const written = serializeDomainPayload(
      { kind: CODING_DOMAIN_KIND, schemaVersion: CODING_PAYLOAD_SCHEMA_VERSION, payload },
      this.opts.config.maxDomainPayloadBytes,
    );
    if (!written.ok) return { ok: false, kind: 'invalid', message: `The issue could not be stored durably (${written.code}).` };

    await this.opts.journal.create({
      runId,
      correlationId: runId,
      activationId: runId,
      workspaceRoot: workspace.canonical,
      workspaceIdentity: auditHash(workspace.canonical),
      // A domain identifier, NOT a shell-command recipe. See codingRunPayload.
      recipeId: CODING_DOMAIN_KIND,
      recipePolicyVersion: `coding-v${CODING_PAYLOAD_SCHEMA_VERSION}`,
      proposalFingerprint: auditHash(`${runId}:${issueText}`),
      proposalHash: auditHash(issueText),
      snapshotId: input.expectedRepository?.headSha ?? 'unpinned',
      snapshotManifestDigest: input.expectedRepository?.dirtyFingerprint ?? 'unpinned',
      executableDigest: 'governed-coding',
      requestedAt: at,
      proposalAt: at,
      expiresAt: at + this.approvalTtlMs,
      timeoutMs: this.approvalTtlMs,
      outputLimitBytes: this.opts.config.maxDomainPayloadBytes,
      mutationClassification: 'workspace-write-possible',
      networkPolicy: 'not-enforced',
      expectedEffects: ['plans a governed multi-file change', 'requires operator scope approval before any write'],
      preview: codingPreview(runId, issueText, at + this.approvalTtlMs),
      domainKind: written.kind,
      domainSchemaVersion: written.schemaVersion,
      domainPayloadJson: written.json,
    });

    // `create` opens every run in AWAITING_APPROVAL, which is the command-recipe
    // default. A coding run has nothing to approve yet — it is planning — so the
    // state is corrected immediately rather than left describing a proposal that
    // does not exist.
    await this.opts.journal.transition({
      runId, expectedState: 'AWAITING_APPROVAL', nextState: 'PLANNING', at,
      eventType: 'coding.planning_started', source: 'API', reason: 'PLANNING_STARTED',
    });
    await this.audit(runId, 'coding.run_started', 'started', { workspace: auditHash(workspace.canonical), issue: auditHash(issueText) });

    // Planning continues after this returns — hence 202 at the route.
    this.dispatch(runId, workspace.canonical, issueText, (ctx) => this.opts.driver.plan(ctx));

    const current = await this.opts.journal.loadRun(runId);
    return {
      ok: true,
      value: { runId, revision: current?.version ?? 1, state: current?.state ?? 'PLANNING', phase: 'planning', statusUrl: statusUrl(runId) },
    };
  }

  // ── 2. read ────────────────────────────────────────────────────────────────

  async read(runId: string): Promise<CodingServiceResult<CodingRunSnapshot>> {
    return await this.snapshotOrFault(runId);
  }

  // ── 3. scope decision ──────────────────────────────────────────────────────

  async scopeDecision(runId: string, input: { expectedRevision: number; pathSetHash: string; decision: 'approve' | 'reject' }): Promise<CodingServiceResult<CodingRunSnapshot>> {
    const loaded = await this.load(runId);
    if (!loaded.ok) return loaded;
    const { run, payload } = loaded.value;

    // The order below is deliberate and is asserted by the tests: a mismatched
    // scope hash must never surface as a generic lifecycle error, because the two
    // tell an operator completely different things about what to do next.
    if (run.version !== input.expectedRevision) return this.conflict(run, payload, 'stale_revision');
    if (payload.phase !== 'awaiting_scope_approval') return this.conflict(run, payload, 'invalid_state');
    const scope = payload.scope;
    if (!scope) return this.conflict(run, payload, 'invalid_state');
    if (scope.pathSetHash !== input.pathSetHash) return this.conflict(run, payload, 'scope_hash_mismatch');
    if (payload.cancellation) return this.conflict(run, payload, 'cancellation_requested');
    if (scope.approvalState === 'invalidated') return this.conflict(run, payload, 'approval_invalidated');
    if (scope.approvalState === 'expired' || Date.parse(scope.approvalExpiresAt) <= this.now()) {
      return this.conflict(run, payload, 'approval_expired');
    }
    if (scope.approvalState === 'approved' || scope.approvalState === 'consumed') {
      return this.conflict(run, payload, 'approval_already_consumed');
    }

    const journaled = await this.runFor(runId);
    if (input.decision === 'reject') {
      // The proposal and its evidence stay in the payload; only the decision is
      // added. A rejected scope must remain inspectable afterwards.
      await journaled.rejectScope();
      await this.audit(runId, 'coding.scope_rejected', 'rejected', { scope: scope.pathSetHash, paths: scope.proposedPaths.length });
      return await this.snapshotOrFault(runId);
    }

    const consumed = await journaled.consumeApproval({ pathSetHash: input.pathSetHash, at: new Date(this.now()).toISOString() });
    if (!consumed.ok) {
      const fresh = await this.load(runId);
      const reason: CodingConflictReason = consumed.code === 'already-consumed' ? 'approval_already_consumed'
        : consumed.code === 'scope-mismatch' ? 'scope_hash_mismatch' : 'invalid_state';
      return fresh.ok ? this.conflict(fresh.value.run, fresh.value.payload, reason) : fresh;
    }
    await this.audit(runId, 'coding.scope_approved', 'approved', { scope: scope.pathSetHash, paths: scope.proposedPaths.length });

    // Resumption is detached; the response carries the new durable revision.
    const workspaceRoot = await this.workspaceRootFor(runId);
    this.dispatch(runId, workspaceRoot, payload.issueText, (ctx) => this.opts.driver.resume(ctx));
    return await this.snapshotOrFault(runId);
  }

  // ── 4. cancel ──────────────────────────────────────────────────────────────

  async cancel(runId: string, input: { expectedRevision: number }): Promise<CodingServiceResult<CodingRunSnapshot>> {
    const loaded = await this.load(runId);
    if (!loaded.ok) return loaded;
    const { run, payload } = loaded.value;
    if (run.version !== input.expectedRevision) return this.conflict(run, payload, 'stale_revision');
    // A finished run cannot be cancelled. Answering 200 here would report the
    // request as accepted while the durable write silently failed — a terminal
    // parent refuses further writes — leaving a caller believing it had stopped
    // something that had already ended.
    if (payload.phase === 'terminal') return this.conflict(run, payload, 'invalid_state');

    const journaled = await this.runFor(runId);
    // Idempotent: an already-requested cancellation records nothing new, so a
    // repeat cannot produce duplicate children or contradictory audit events.
    if (!payload.cancellation) {
      await journaled.requestCancellation(new Date(this.now()).toISOString());
      await this.audit(runId, 'coding.cancellation_requested', 'requested', {});
    }

    // Signal this process's executor, if it holds one. Absence is not completion.
    this.executors.get(runId)?.controller.abort();

    // Reconciliation is asynchronous, and the response says `cancelling` until a
    // confirmation is durable — never `cancelled` merely because we asked.
    return await this.snapshotOrFault(runId);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Canonical roots bound at creation. The driver receives the root through the
   * dispatch closure, so no later request can re-point a run at another tree. */
  private readonly boundRoots = new Map<string, string>();

  private async workspaceRootFor(runId: string): Promise<string> {
    return this.boundRoots.get(runId) ?? '';
  }

  /**
   * Run detached work with its rejection captured.
   *
   * An unhandled rejection here would leave a run stuck in its current phase with
   * nothing explaining why. Failure is persisted as a truthful workflow failure
   * instead.
   */
  private dispatch(runId: string, workspaceRoot: string, issueText: string, work: (ctx: CodingWorkflowContext) => Promise<void>): void {
    this.boundRoots.set(runId, workspaceRoot);
    const controller = new AbortController();
    const task = (async () => {
      // Constructed inside the detached task: `dispatch` stays synchronous so
      // the HTTP response is not held open while the run store loads its
      // canonical state. The task already owns its own failure reporting.
      const run = await this.runFor(runId);
      try {
        await work({ run, runId, workspaceRoot, issueText, signal: controller.signal });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.audit(runId, 'coding.workflow_failed', 'failed', { detail: auditHash(message) });
        try {
          await run.patchPayload({ phase: 'terminal' }, 'workflow.failed');
        } catch { /* the payload may itself be unreadable; the transition below still records the failure */ }
        await this.opts.journal.transition({
          runId,
          nextState: 'FAILED',
          at: this.now(),
          eventType: 'coding.workflow_failed',
          source: 'EXECUTION',
          reason: 'WORKFLOW_THREW',
          failureCode: 'WORKFLOW_THREW',
          terminalAt: this.now(),
          error: { code: 'WORKFLOW_THREW', message },
        });
      } finally {
        this.executors.delete(runId);
      }
    })();
    // Registered BEFORE anyone can await it, and the promise itself never escapes
    // unhandled — `task` already has its catch inside.
    this.executors.set(runId, { controller, task });
  }

  /** Await detached work. Tests only — production never blocks on this. */
  async settle(runId: string): Promise<void> {
    await this.executors.get(runId)?.task;
  }

  private async load(runId: string): Promise<CodingServiceResult<{ run: DurableAgentRun; payload: CodingRunPayloadV1 }>> {
    const run = await this.opts.journal.loadRun(runId);
    if (!run) return { ok: false, kind: 'not_found' };
    const read = readDomainPayload<unknown>(run, { kind: CODING_DOMAIN_KIND, maxSchemaVersion: CODING_PAYLOAD_SCHEMA_VERSION });
    if (!read.ok) {
      return {
        ok: false,
        kind: 'unreadable',
        body: {
          error: 'coding_run_unreadable',
          runId,
          reason: read.code === 'UNSUPPORTED_SCHEMA_VERSION' ? 'payload_unsupported_version' : read.code === 'ABSENT' || read.code === 'KIND_MISMATCH' ? 'payload_absent' : 'payload_malformed',
          currentRevision: run.version,
          currentState: run.state,
          // A future-version payload becomes readable again under a newer build;
          // a corrupt one does not.
          recoverable: read.code === 'UNSUPPORTED_SCHEMA_VERSION',
          detail: `The durable coding payload could not be interpreted (${read.code}). The run record exists and was not modified.`,
        },
      };
    }
    const parsed = parseCodingPayload(read.payload);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: 'unreadable',
        body: {
          error: 'coding_run_unreadable',
          runId,
          reason: 'payload_malformed',
          currentRevision: run.version,
          currentState: run.state,
          recoverable: false,
          detail: `The durable coding payload failed validation (${parsed.fault}: ${parsed.detail}).`,
        },
      };
    }
    return { ok: true, value: { run, payload: parsed.payload } };
  }

  private conflict(run: DurableAgentRun, payload: CodingRunPayloadV1, reason: CodingConflictReason): CodingServiceResult<never> {
    return {
      ok: false,
      kind: 'conflict',
      body: { error: 'coding_run_conflict', reason, currentRevision: run.version, currentState: run.state, currentPhase: payload.phase },
    };
  }

  private async snapshotOrFault(runId: string): Promise<CodingServiceResult<CodingRunSnapshot>> {
    const loaded = await this.load(runId);
    if (!loaded.ok) return loaded;
    const { run, payload } = loaded.value;
    const children = await this.opts.journal.children(runId);
    const eligibility = codingCompletionEligibility(payload, children);
    return { ok: true, value: buildSnapshot(run, payload, children, eligibility.blockers.map(describeBlocker)) };
  }

  /** Awaited by its callers: `coding.scope_approved` / `scope_rejected` record an
   * operator authorization decision, and all callers are already async. */
  private async audit(runId: string, type: CodingAuditType, outcome: string, fields: Record<string, unknown>): Promise<void> {
    await auditStore.append({ correlationId: runId, type, component: 'coding-run', outcome, fields });
  }
}

function describeBlocker(blocker: { kind: string; childId?: string; detail?: string; state?: string; category?: string }): string {
  if (blocker.detail) return `${blocker.kind}: ${blocker.detail}`;
  if (blocker.childId) return `${blocker.kind}: ${blocker.childId}${blocker.state ? ` (${blocker.state})` : ''}${blocker.category ? ` (${blocker.category})` : ''}`;
  return blocker.kind;
}

export function statusUrl(runId: string): string {
  return `/api/ai/coding/runs/${runId}`;
}

function buildSnapshot(
  run: DurableAgentRun,
  payload: CodingRunPayloadV1,
  children: Awaited<ReturnType<AgentRunJournal['children']>>,
  blockers: string[],
): CodingRunSnapshot {
  const scope = payload.scope;
  const validation = payload.latestValidation;
  return {
    runId: run.runId,
    revision: run.version,
    state: run.state,
    phase: payload.phase,
    ...(payload.plan?.issueSummary ? { issueSummary: payload.plan.issueSummary } : {}),
    ...(scope
      ? {
          scope: {
            proposedPaths: [...scope.proposedPaths],
            pathSetHash: scope.pathSetHash,
            approvalState: scope.approvalState,
            approvalExpiresAt: scope.approvalExpiresAt,
            proposedAt: scope.proposedAt,
            ...(scope.approvedAt ? { approvedAt: scope.approvedAt } : {}),
            // Line ranges and hashes only — the API never returns file contents.
            evidence: scope.proposedPaths.map((path) => ({
              path,
              spans: (scope.sourcesByPath[path] ?? []).map((s) => ({ startLine: s.startLine, endLine: s.endLine, excerptHash: s.excerptHash })),
            })),
            rationales: (payload.plan?.proposedScope ?? []).map((s) => ({ path: s.path, rationale: s.rationale })),
            excluded: (payload.plan?.excludedCandidates ?? []).map((e) => ({ path: e.path, reason: e.reason })),
          },
        }
      : {}),
    children: children.map((c) => ({
      childId: c.childId, kind: c.kind, attempt: c.attempt, state: c.state, required: c.required,
      ...(c.terminalCategory ? { terminalCategory: c.terminalCategory } : {}),
    })),
    ...(payload.cancellation
      ? {
          cancellation: {
            requestedAt: payload.cancellation.requestedAt,
            ...(payload.cancellation.confirmedAt ? { confirmedAt: payload.cancellation.confirmedAt } : {}),
            // `cancelled` requires a CONFIRMATION, never merely a request.
            status: payload.cancellation.confirmedAt ? 'cancelled' : 'cancelling',
          },
        }
      : {}),
    ...(validation
      ? {
          latestValidation: {
            commandRunId: validation.id,
            command: [...validation.command],
            exitCode: validation.exitCode,
            timedOut: validation.timedOut,
            passed: validation.passed,
            outputHead: `${validation.stdout}\n${validation.stderr}`.slice(0, OUTPUT_HEAD_CHARS),
          },
        }
      : {}),
    blockers,
    ...(payload.finalReport
      ? {
          finalReport: {
            stopReason: payload.finalReport.stopReason,
            complete: payload.finalReport.complete,
            changedFiles: [...payload.finalReport.reconciliation.diffPaths],
            approvedPaths: [...payload.finalReport.reconciliation.approved],
            refusedPaths: [...payload.finalReport.reconciliation.refused],
            unusedScope: [...payload.finalReport.reconciliation.unusedScope],
            unresolvedRisks: [...payload.finalReport.unresolvedRisks],
          },
        }
      : {}),
    statusUrl: statusUrl(run.runId),
  };
}

/** The journal requires a command preview. A coding run has no shell command, so
 * this describes the governed operation honestly rather than fabricating one. */
function codingPreview(runId: string, issueText: string, expiresAt: number): AgentModeCommandPreview {
  return {
    // The preview schema types `recipe` as a shell-command recipe id. A coding run
    // is not one, so the domain kind is carried here rather than a fabricated
    // command — see CODING_DOMAIN_KIND for why it is not in that enum.
    recipe: CODING_DOMAIN_KIND as AgentModeCommandPreview['recipe'],
    policyVersion: `coding-v${CODING_PAYLOAD_SCHEMA_VERSION}`,
    executionIdentity: 'governed-coding',
    environmentPolicy: 'engine-owned',
    workspaceMaterialFingerprint: 'unpinned',
    snapshotId: 'unpinned',
    sourceWorkspace: '[REDACTED PATH]',
    executable: '(no shell command — governed multi-file edit)',
    arguments: [],
    cwd: '[REDACTED PATH]',
    timeoutMs: 1,
    outputLimitBytes: 1,
    mutationClassification: 'workspace-write-possible',
    networkPolicy: 'not-enforced',
    expectedEffects: ['governed multi-file edit under an approved scope'],
    reason: `governed coding run ${runId}`,
    requestId: runId,
    fingerprint: auditHash(issueText),
    expiresAt,
    warnings: [],
    environment: [],
    canModifyFiles: true,
  };
}
