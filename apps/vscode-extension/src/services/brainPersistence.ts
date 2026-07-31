// MigraPilot — durable execution authority.
//
// Two records, deliberately separate documents:
//
//   connection.json          Brain availability. A health poll writes ONLY this.
//   operations/<id>.json     One requested action each.
//
// A routine health poll must never be able to rewrite a completed run, so the two
// cannot share a mutable document. That separation is enforced by the API here: the
// connection store exposes no way to reach an operation file.
//
// Nothing is optimistically closed on restart. An operation that was in flight when the
// process died did not complete, and is recovered as interrupted with explicit evidence.

import type { ExecutionState, FailureCategory } from './executionState.js';
import type { ConnectionReadiness } from './brainConnection.js';

export const SCHEMA_VERSION = 1 as const;

export type OperationKind = 'consequential' | 'idempotent_read' | 'health' | 'diagnostic';

/** Attempt statuses. `superseded` is deliberately absent: retries are strictly
 * sequential, so an earlier attempt is a historical TERMINAL attempt, never an
 * unresolved competitor. */
export type AttemptStatus =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'retry_scheduled'
  | 'retry_exhausted';

export interface PersistedTransportAttempt {
  attemptId: string;
  attemptNumber: number;
  startedAt: string;
  endedAt?: string;
  status: AttemptStatus;
  category?: FailureCategory;
  retryReason?: string;
  retryDelayMs?: number;
  followedByAnotherAttempt: boolean;
  producedAuthoritativeResult: boolean;
  /** Non-sensitive summary only. Response bodies are never persisted. */
  diagnostic?: string;
}

export interface PersistedBrainOperation {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  operationId: string;
  requestedAction: string;
  operationKind: OperationKind;
  currentState: ExecutionState;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  transitions: Array<{ from: string; to: string; at: string; reason: string; rejected?: true }>;
  invariantViolations: string[];
  endpointIdentity?: string;
  brainProcessIdentity?: string;
  precondition: { required: boolean; requestedAt?: string; confirmedAt?: string; failedAt?: string };
  transportAttempts: PersistedTransportAttempt[];
  cancellation?: { requestedAt: string; acknowledgedAt?: string; confirmed: boolean; reason?: string };
  terminalEvidence?: {
    observedAt: string;
    outcome: 'success' | 'failure';
    evidenceType: string;
    authoritativeAttemptId?: string;
  };
  commands: string[];
  changedFiles: string[];
  tests: string[];
  failures: string[];
  remainingWork: string[];
  /** Set by recovery; absent on a live record. */
  recovery?: { evidence: RecoveryEvidence; recoveredAt: string };
}

export type RecoveryEvidence =
  | 'extension_restart'
  | 'transport_lost_on_restart'
  | 'operation_interrupted'
  | 'cancellation_acknowledgment_missing';

export interface PersistedBrainConnection {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  endpointIdentity: string;
  readiness: ConnectionReadiness;
  updatedAt: string;
  lastSuccessfulHealthAt?: string;
  lastFailureAt?: string;
  lastFailureCategory?: FailureCategory;
  consecutiveFailures: number;
  reconnectAttempts: number;
  observedProcessIdentity?: string;
}

// ── sensitive-data scrubbing ────────────────────────────────────────────────

const SENSITIVE_KEY = /authorization|cookie|token|secret|api[-_]?key|bearer|password|private[-_]?key/i;

/** Token-shaped values, matched on SHAPE so unknown credential formats are still caught. */
const TOKEN_SHAPED: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\bsk_(live|test)_[A-Za-z0-9]{8,}/,
  /\bAKIA[A-Z0-9]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /\b[a-f0-9]{40,}\b/i, // long hex secrets
  /:\/\/[^:/@\s]+:[^@\s]+@/, // credentialed URL
];

export const REDACTED = '[redacted]';

/**
 * Recursively scrub. Operates over UNKNOWN nested structures, not just known top-level
 * fields — a diagnostic blob is exactly where an unexpected credential shows up.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === 'string') {
    return TOKEN_SHAPED.some((re) => re.test(value)) ? REDACTED : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ── storage ─────────────────────────────────────────────────────────────────

/** Minimal filesystem surface, injected so persistence is testable without real IO. */
export interface StorageFs {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

export class StaleRevisionError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`stale write rejected: expected revision ${expected}, found ${actual}`);
    this.name = 'StaleRevisionError';
  }
}

export interface QuarantineNote {
  sourceFile: string;
  failure: 'malformed_json' | 'unsupported_schema_version' | 'shape_invalid';
  destination: string;
}

export class BrainStore {
  constructor(
    private readonly root: string,
    private readonly fs: StorageFs,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private get opsDir() { return `${this.root}/operations`; }
  private get tmpDir() { return `${this.root}/tmp`; }
  private get quarantineDir() { return `${this.root}/quarantine`; }
  private opPath(id: string) { return `${this.opsDir}/${id}.json`; }
  private get connPath() { return `${this.root}/connection.json`; }

  async init(): Promise<void> {
    for (const d of [this.root, this.opsDir, this.tmpDir, this.quarantineDir]) {
      await this.fs.mkdir(d);
    }
  }

  /**
   * Atomic write: scrub → temp file in the SAME filesystem → rename over destination.
   * The prior valid record is never deleted before the replacement succeeds, so an
   * interrupted write leaves the previous record intact.
   *
   * NOTE: directory fsync is not available through this abstraction, so durability is
   * "atomic replacement" rather than "guaranteed flushed to disk on power loss". Stated
   * rather than overclaimed.
   */
  private async atomicWrite(dest: string, record: unknown): Promise<void> {
    const scrubbed = scrub(record);
    const serialised = JSON.stringify(scrubbed, null, 2);
    const tmp = `${this.tmpDir}/${dest.split('/').pop()}.${Date.now().toString(36)}.tmp`;
    await this.fs.writeFile(tmp, serialised);
    await this.fs.rename(tmp, dest);
  }

  /** Reject a write whose expected revision no longer matches what is on disk. */
  async saveOperation(record: PersistedBrainOperation): Promise<PersistedBrainOperation> {
    const path = this.opPath(record.operationId);
    if (await this.fs.exists(path)) {
      const current = await this.readJson(path);
      const currentRev = (current as PersistedBrainOperation | undefined)?.revision;
      if (typeof currentRev === 'number' && currentRev >= record.revision) {
        throw new StaleRevisionError(record.revision, currentRev);
      }
    }
    const next = { ...record, updatedAt: this.now() };
    await this.atomicWrite(path, next);
    return next;
  }

  async saveConnection(record: PersistedBrainConnection): Promise<PersistedBrainConnection> {
    if (await this.fs.exists(this.connPath)) {
      const current = (await this.readJson(this.connPath)) as PersistedBrainConnection | undefined;
      if (typeof current?.revision === 'number' && current.revision >= record.revision) {
        throw new StaleRevisionError(record.revision, current.revision);
      }
    }
    const next = { ...record, updatedAt: this.now() };
    await this.atomicWrite(this.connPath, next);
    return next;
  }

  private async readJson(path: string): Promise<unknown> {
    try {
      return JSON.parse(await this.fs.readFile(path));
    } catch {
      return undefined;
    }
  }

  /** Move a bad record aside. Never deleted, never reinterpreted as completed. */
  async quarantine(fileName: string, failure: QuarantineNote['failure']): Promise<QuarantineNote> {
    const destination = `${this.quarantineDir}/${fileName}.${Date.now().toString(36)}.invalid.json`;
    await this.fs.rename(`${this.opsDir}/${fileName}`, destination);
    return { sourceFile: fileName, failure, destination };
  }

  /**
   * Load every operation, validating and recovering. Returns records plus quarantine
   * notes — a malformed file becomes a note, never an authoritative record.
   */
  async loadOperations(): Promise<{
    operations: PersistedBrainOperation[];
    quarantined: QuarantineNote[];
  }> {
    const operations: PersistedBrainOperation[] = [];
    const quarantined: QuarantineNote[] = [];
    const files = (await this.fs.readdir(this.opsDir)).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const raw = await this.readJson(`${this.opsDir}/${file}`);
      if (raw === undefined) {
        quarantined.push(await this.quarantine(file, 'malformed_json'));
        continue;
      }
      const rec = raw as Partial<PersistedBrainOperation>;
      if (rec.schemaVersion !== SCHEMA_VERSION) {
        quarantined.push(await this.quarantine(file, 'unsupported_schema_version'));
        continue;
      }
      if (typeof rec.operationId !== 'string' || typeof rec.currentState !== 'string') {
        quarantined.push(await this.quarantine(file, 'shape_invalid'));
        continue;
      }
      operations.push(recoverOperation(rec as PersistedBrainOperation, this.now()));
    }
    return { operations, quarantined };
  }
}

/**
 * Restart recovery. Terminal stays terminal; anything in flight becomes an explicit
 * interrupted failure with evidence. Nothing is replayed, and nothing becomes
 * successful because the process restarted.
 */
export function recoverOperation(
  record: PersistedBrainOperation,
  at: string,
): PersistedBrainOperation {
  const terminal: ReadonlySet<ExecutionState> = new Set(['completed', 'failed', 'cancelled']);

  if (record.currentState === 'cancelled' && record.cancellation?.confirmed !== true) {
    return interrupted(record, 'cancellation_acknowledgment_missing', at, 'cancellation_unconfirmed');
  }
  if (terminal.has(record.currentState)) return record;

  switch (record.currentState) {
    case 'cancelling':
      return interrupted(record, 'cancellation_acknowledgment_missing', at, 'cancellation_unconfirmed');
    case 'running':
      return interrupted(record, 'operation_interrupted', at, 'terminal_state_unverified');
    case 'connecting':
      return interrupted(record, 'transport_lost_on_restart', at, 'connection_lost');
    default:
      return interrupted(record, 'extension_restart', at, 'terminal_state_unverified');
  }
}

function interrupted(
  record: PersistedBrainOperation,
  evidence: RecoveryEvidence,
  at: string,
  category: FailureCategory,
): PersistedBrainOperation {
  return {
    ...record,
    currentState: 'failed',
    endedAt: at,
    updatedAt: at,
    revision: record.revision + 1,
    recovery: { evidence, recoveredAt: at },
    failures: [...record.failures, `${category}: ${evidence}`],
    remainingWork: [...record.remainingWork, 'Operation outcome unknown; re-run if still required.'],
    transitions: [
      ...record.transitions,
      { from: record.currentState, to: 'failed', at, reason: `recovered after restart — ${evidence}` },
    ],
  };
}

// ── work-report convergence ─────────────────────────────────────────────────

/**
 * Every derived flag comes from ONE snapshot. `cancelled` is no longer an independent
 * boolean anybody can set — it is a function of the authoritative state.
 */
export interface DerivedReportFlags {
  cancelled: boolean;
  success: boolean;
  failed: boolean;
  interrupted: boolean;
  cancellationRequested: boolean;
  cancellationConfirmed: boolean;
}

export function deriveFlags(record: PersistedBrainOperation): DerivedReportFlags {
  return {
    cancelled: record.currentState === 'cancelled',
    success:
      record.currentState === 'completed' && record.terminalEvidence?.outcome === 'success',
    failed: record.currentState === 'failed',
    interrupted: record.recovery !== undefined,
    cancellationRequested: record.cancellation !== undefined,
    cancellationConfirmed: record.cancellation?.confirmed === true,
  };
}

/** Rendering must name the exact record it came from, so a stale view is detectable. */
export interface RenderStamp {
  operationId: string;
  revision: number;
}

export function isStaleRender(stamp: RenderStamp, current: RenderStamp): boolean {
  return stamp.operationId !== current.operationId || stamp.revision !== current.revision;
}

// ── retention ───────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  maxRecords: number;
  maxAgeMs: number;
}

/**
 * Only TERMINAL records are eligible. `running`, `connecting` and `cancelling` are never
 * pruned regardless of age — an unresolved operation is exactly the thing you must not
 * lose.
 */
export function selectPrunable(
  records: readonly PersistedBrainOperation[],
  policy: RetentionPolicy,
  nowMs: number,
): PersistedBrainOperation[] {
  const NEVER: ReadonlySet<ExecutionState> = new Set(['running', 'connecting', 'cancelling']);
  const eligible = records.filter((r) => !NEVER.has(r.currentState) && r.endedAt !== undefined);
  const tooOld = eligible.filter((r) => nowMs - Date.parse(r.endedAt!) > policy.maxAgeMs);
  const overflow = eligible
    .slice()
    .sort((a, b) => Date.parse(a.endedAt!) - Date.parse(b.endedAt!))
    .slice(0, Math.max(0, eligible.length - policy.maxRecords));
  return [...new Set([...tooOld, ...overflow])];
}
