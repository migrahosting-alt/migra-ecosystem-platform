// Changeset engine (Slice 3B) — first-class approval-backed workspace mutation:
// file create / replace / patch / delete / mkdir.
//
// Two phases, two tools:
//   fs.proposeChangeset (READ-ONLY): validate + preview + capture pre-state +
//     compute an immutable proposal hash. Zero writes. New files render as
//     ADDITIONS (before=null, after=content), not failed line-range edits.
//   fs.applyChangeset (MUTATING, APPROVAL-REQUIRED): re-validate every path,
//     detect a stale source (current sha ≠ the proposal's expectedSha), apply
//     ALL-OR-NOTHING with atomic writes, and preserve reverse material. A
//     partial failure rolls back and is reported — never a silent mixed state.
//
// Containment reuses the shared `containedPath` chokepoint (absolute / traversal
// / symlink-escape all refused). delete is refused unless allowDelete is set.

import { createHash } from 'node:crypto';
import { containedPath } from '@migrapilot/workspace-tools';
import type { WorkspaceFs } from '@migrapilot/workspace-tools';
import {
  ChangesetRequestSchema,
  ApplyChangesetRequestSchema,
  type ChangesetRequest,
  type ChangeOp,
  type ProposeChangesetResponse,
  type ApplyChangesetResponse,
} from '@migrapilot/protocol';
import { StoreHealth, shortId, safeSink, NOOP_TELEMETRY, type TelemetrySink, type StoreHealthSnapshot } from '../engine/storeTelemetry.js';

// Proposal-size guardrails (owner threat checklist). A proposal exceeding any of
// these is refused at propose time — before it can be stored or approved.
const MAX_OPS = 200;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
// INVARIANT (fail-closed): the proposal TTL MUST be >= the approval-store TTL
// (ToolApprovalStore DEFAULT_TTL_MS = 5 min) so an approval can never outlive
// its authoritative proposal — there is no window where a valid approval exists
// but the proposal it binds has expired. Keep this comfortably larger.
const PROPOSAL_TTL_MS = 30 * 60_000;
const MAX_STORED_PROPOSALS = 512;

/** Bounded, non-sensitive metadata about a changeset for telemetry. */
function changesetMeta(cs: ChangesetRequest): { opCount: number; totalBytes: number; opTypes: Record<string, number> } {
  const opTypes: Record<string, number> = {};
  let totalBytes = 0;
  for (const op of cs.ops) {
    opTypes[op.op] = (opTypes[op.op] ?? 0) + 1;
    if (op.op === 'create' || op.op === 'replace') totalBytes += Buffer.byteLength(op.content, 'utf8');
    else if (op.op === 'patch') totalBytes += Buffer.byteLength(op.replacement, 'utf8');
  }
  return { opCount: cs.ops.length, totalBytes, opTypes };
}

/** Server-side proposal store: the AUTHORITATIVE changeset body lives here,
 * keyed by its SHA-256 proposal hash. Apply looks the proposal up by hash — the
 * client never resubmits the body, so it cannot substitute a weaker changeset.
 *
 * Instrumented (Slice 2): every lifecycle transition emits ONE metadata-only
 * telemetry event, and health() returns a truthful snapshot. Eviction is never
 * silent and prefers expired entries before evicting an active proposal. */
export class ChangesetProposalStore {
  private readonly byHash = new Map<string, { changeset: ChangesetRequest; rootPath: string; createdAt: number; expiresAt: number }>();
  private readonly telemetry: TelemetrySink;
  private readonly healthTracker = new StoreHealth('proposal', MAX_STORED_PROPOSALS, () => this.now());

  constructor(private readonly now: () => number = () => Date.now(), telemetry: TelemetrySink = NOOP_TELEMETRY) {
    this.telemetry = safeSink(telemetry);
  }

  private emit(event: Parameters<TelemetrySink>[0]['event'], fields: Record<string, unknown>, correlationId?: string): void {
    this.telemetry({ event, at: this.now(), correlationId, fields });
  }

  put(proposalHash: string, changeset: ChangesetRequest, correlationId?: string): void {
    if (this.byHash.size >= MAX_STORED_PROPOSALS) this.evictForCapacity(correlationId);
    const createdAt = this.now();
    this.byHash.set(proposalHash, { changeset, rootPath: changeset.rootPath, createdAt, expiresAt: createdAt + PROPOSAL_TTL_MS });
    this.healthTracker.onCreated();
    const meta = changesetMeta(changeset);
    this.emit(
      'proposal.created',
      {
        proposal: shortId(proposalHash),
        workspace: shortId(changeset.rootPath),
        opCount: meta.opCount,
        totalBytes: meta.totalBytes,
        opTypes: meta.opTypes,
        createdAt,
        expiresAt: createdAt + PROPOSAL_TTL_MS,
        storeSize: this.byHash.size,
        capacity: MAX_STORED_PROPOSALS,
      },
      correlationId,
    );
  }

  /** Fetch a live proposal; expired entries are treated as absent (and evicted). */
  get(proposalHash: string, correlationId?: string): ChangesetRequest | undefined {
    const started = this.now();
    const rec = this.byHash.get(proposalHash);
    if (!rec) {
      this.emit('proposal.unknown', { proposal: shortId(proposalHash), latencyMs: this.now() - started }, correlationId);
      return undefined;
    }
    if (rec.expiresAt <= this.now()) {
      this.byHash.delete(proposalHash);
      this.healthTracker.onExpired();
      this.emit('proposal.expired', { proposal: shortId(proposalHash), ageMs: this.now() - rec.createdAt, storeSize: this.byHash.size }, correlationId);
      return undefined;
    }
    this.emit('proposal.looked_up', { proposal: shortId(proposalHash), latencyMs: this.now() - started }, correlationId);
    return rec.changeset;
  }

  /** Consume (remove) a proposal — a proposal is single-use at application. */
  take(proposalHash: string, correlationId?: string): ChangesetRequest | undefined {
    const rec = this.byHash.get(proposalHash);
    if (!rec) {
      this.emit('proposal.unknown', { proposal: shortId(proposalHash) }, correlationId);
      return undefined;
    }
    if (rec.expiresAt <= this.now()) {
      this.byHash.delete(proposalHash);
      this.healthTracker.onExpired();
      this.emit('proposal.expired', { proposal: shortId(proposalHash), ageMs: this.now() - rec.createdAt, storeSize: this.byHash.size }, correlationId);
      return undefined;
    }
    this.byHash.delete(proposalHash);
    this.healthTracker.onConsumed();
    this.emit('proposal.consumed', { proposal: shortId(proposalHash), ageMs: this.now() - rec.createdAt, storeSize: this.byHash.size }, correlationId);
    return rec.changeset;
  }

  /** Deterministic capacity policy: sweep EXPIRED first (reason=ttl); only if
   * still full, evict the single oldest ACTIVE proposal (reason=capacity) — an
   * explicit, auditable policy, never a silent overwrite. */
  private evictForCapacity(correlationId?: string): void {
    const started = this.now();
    const nowT = this.now();
    const expiredKeys = [...this.byHash.entries()].filter(([, v]) => v.expiresAt <= nowT).map(([k]) => k);
    if (expiredKeys.length) {
      for (const k of expiredKeys) this.byHash.delete(k);
      this.healthTracker.onExpired(expiredKeys.length);
      this.healthTracker.onEvicted(expiredKeys.length);
      this.emit('proposal.evicted', { reason: 'ttl', removed: expiredKeys.length, storeSize: this.byHash.size, capacity: MAX_STORED_PROPOSALS }, correlationId);
    }
    if (this.byHash.size >= MAX_STORED_PROPOSALS) {
      const oldest = [...this.byHash.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) {
        this.byHash.delete(oldest[0]);
        this.healthTracker.onEvicted(1);
        this.emit('proposal.evicted', { reason: 'capacity', removed: 1, storeSize: this.byHash.size, capacity: MAX_STORED_PROPOSALS }, correlationId);
      }
    }
    this.healthTracker.onCleanup(this.now() - started);
  }

  /** Truthful health snapshot (sweeps expired first so counts are accurate). */
  health(): StoreHealthSnapshot {
    const started = this.now();
    const nowT = this.now();
    let sweptExpired = 0;
    for (const [k, v] of [...this.byHash.entries()]) {
      if (v.expiresAt <= nowT) {
        this.byHash.delete(k);
        sweptExpired += 1;
      }
    }
    if (sweptExpired) {
      this.healthTracker.onExpired(sweptExpired);
      this.emit('proposal.expired', { reason: 'sweep', removed: sweptExpired, storeSize: this.byHash.size });
    }
    this.healthTracker.onCleanup(this.now() - started);
    let oldestAge: number | null = null;
    let nextExp: number | null = null;
    for (const v of this.byHash.values()) {
      oldestAge = oldestAge === null ? nowT - v.createdAt : Math.max(oldestAge, nowT - v.createdAt);
      nextExp = nextExp === null ? v.expiresAt - nowT : Math.min(nextExp, v.expiresAt - nowT);
    }
    return this.healthTracker.snapshot(this.byHash.size, oldestAge, nextExp);
  }
}

/** fs port for the changeset engine — WorkspaceFs plus the create/delete/dir
 * operations mutation needs. Hosts inject node fs; tests inject an in-memory fs. */
export interface ChangesetFs extends WorkspaceFs {
  mkdirp(absPath: string): void;
  removeFile(absPath: string): void;
  /** Remove a directory only if it is empty (rollback of a created dir). */
  removeDirIfEmpty(absPath: string): void;
}

export class ChangesetError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'DELETE_NOT_ALLOWED'
      | 'ALREADY_EXISTS'
      | 'NOT_FOUND'
      | 'STALE'
      | 'PARTIAL_WRITE'
      | 'INCONSISTENT_STATE'
      | 'CONFLICT'
      | 'TOO_LARGE'
      | 'UNKNOWN_PROPOSAL',
    message: string,
    /** Safe, bounded counts for audit/incident (never paths or content). */
    readonly details?: { appliedFileCount: number; affectedPathCount: number; rollbackFailureCount: number; failureStage: string },
    /** Server-side ONLY reverse material for recovery (path + prior content).
     * NEVER audited/logged; used solely to build an approval-gated restoration. */
    readonly reverseMaterial?: Array<{ path: string; previousContent: string | null }>,
  ) {
    super(message);
    this.name = 'ChangesetError';
  }
}

function sha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function byteLen(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** Apply a 1-based inclusive line-range replacement to `before`. */
function applyPatch(before: string, startLine: number, endLine: number, replacement: string): string {
  const lines = before.split('\n');
  if (startLine > lines.length + 1) {
    throw new ChangesetError('INVALID_INPUT', `patch startLine ${startLine} is past end of file (${lines.length} lines)`);
  }
  const end = Math.min(endLine, lines.length);
  const next = [...lines.slice(0, startLine - 1), ...replacement.split('\n'), ...lines.slice(end)];
  return next.join('\n');
}

interface ResolvedOp {
  op: ChangeOp;
  abs: string;
  preExists: boolean;
  before: string | null;
  currentSha: string | null;
}

/** Resolve + contain every op path, capture pre-state. Throws on the FIRST
 * containment / existence violation so a rejected changeset performs no work. */
function resolveOps(cs: ChangesetRequest, fs: ChangesetFs): ResolvedOp[] {
  return cs.ops.map((op) => {
    const abs = containedPath(cs.rootPath, op.path, fs); // ABSOLUTE_PATH / PATH_ESCAPE on violation
    const preExists = fs.exists(abs);
    const before = preExists && op.op !== 'mkdir' ? fs.readFile(abs) : null;
    return { op, abs, preExists, before, currentSha: before === null ? null : sha(before) };
  });
}

/** Reject a changeset whose ops conflict on the same path, or that exceeds the
 * size/count guardrails. Runs before any pre-state read. */
function assertWellFormed(cs: ChangesetRequest): void {
  if (cs.ops.length > MAX_OPS) {
    throw new ChangesetError('TOO_LARGE', `changeset has ${cs.ops.length} ops (max ${MAX_OPS})`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const op of cs.ops) {
    // A path may appear at most once across file ops (mkdir may share a prefix
    // but not the exact same path as a file op).
    const key = op.path;
    if (seen.has(key)) {
      throw new ChangesetError('CONFLICT', `path "${op.path}" appears in more than one operation`);
    }
    seen.add(key);
    if ((op.op === 'create' || op.op === 'replace') && byteLen(op.content) > MAX_FILE_BYTES) {
      throw new ChangesetError('TOO_LARGE', `file "${op.path}" exceeds the ${MAX_FILE_BYTES}-byte limit`);
    }
    if (op.op === 'create' || op.op === 'replace') totalBytes += byteLen(op.content);
    if (op.op === 'patch') totalBytes += byteLen(op.replacement);
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new ChangesetError('TOO_LARGE', `changeset content totals ${totalBytes} bytes (max ${MAX_TOTAL_BYTES})`);
  }
}

/** Deterministic serialization with recursively sorted object keys, so the
 * proposal identity is canonical — key order, and only key order, can never
 * produce two different hashes for the same logical proposal (invariant #1).
 * Op ORDER is preserved (arrays keep order — sequence is semantically relevant). */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

/** SHA-256 over ALL security-relevant context (owner review): version, root,
 * allowDelete, and the ordered normalized ops (op / path / expectedSha /
 * content / patch coords). Canonical serialization → any content change alters
 * the hash; key-order alone never does. */
function proposalHashOf(cs: ChangesetRequest): string {
  const canonical = { v: 1, rootPath: cs.rootPath, allowDelete: Boolean(cs.allowDelete), ops: cs.ops };
  return createHash('sha256').update(canonicalStringify(canonical), 'utf8').digest('hex');
}

/** Pure preview compute (no store side effect): validates + previews a changeset
 * against the CURRENT workspace and fills expectedSha. Shared by propose and the
 * apply-preview path so both render identically and re-check drift. */
function computeProposal(cs: ChangesetRequest, fs: ChangesetFs): ProposeChangesetResponse {
  assertWellFormed(cs);
  const resolved = resolveOps(cs, fs);

  const previewOps: ProposeChangesetResponse['ops'] = [];
  const echoOps: ChangeOp[] = [];
  const touched = new Set<string>();
  let totalBytes = 0;

  for (const r of resolved) {
    const { op, preExists, before, currentSha } = r;
    if (op.op === 'create' && preExists) {
      throw new ChangesetError('ALREADY_EXISTS', `create target already exists: ${op.path}`);
    }
    if ((op.op === 'replace' || op.op === 'patch' || op.op === 'delete') && !preExists) {
      throw new ChangesetError('NOT_FOUND', `${op.op} target does not exist: ${op.path}`);
    }
    if (op.op === 'delete' && !cs.allowDelete) {
      throw new ChangesetError('DELETE_NOT_ALLOWED', `delete requires allowDelete: ${op.path}`);
    }

    let after: string | null = null;
    let kind: 'add' | 'modify' | 'delete' | 'mkdir';
    let echo: ChangeOp = op;
    switch (op.op) {
      case 'create':
        after = op.content;
        kind = 'add';
        touched.add(op.path);
        totalBytes += byteLen(op.content);
        break;
      case 'replace':
        after = op.content;
        kind = 'modify';
        echo = { ...op, expectedSha: currentSha ?? undefined };
        touched.add(op.path);
        totalBytes += byteLen(op.content);
        break;
      case 'patch':
        after = applyPatch(before ?? '', op.startLine, op.endLine, op.replacement);
        kind = 'modify';
        echo = { ...op, expectedSha: currentSha ?? undefined };
        touched.add(op.path);
        totalBytes += byteLen(after);
        break;
      case 'delete':
        after = null;
        kind = 'delete';
        echo = { ...op, expectedSha: currentSha ?? undefined };
        touched.add(op.path);
        break;
      case 'mkdir':
        after = null;
        kind = 'mkdir';
        break;
    }
    echoOps.push(echo);
    previewOps.push({
      op: op.op,
      path: op.path,
      kind,
      preExists,
      expectedSha: currentSha,
      before,
      after,
      bytes: after ? byteLen(after) : 0,
    });
  }

  const changeset: ChangesetRequest = { rootPath: cs.rootPath, ops: echoOps, ...(cs.allowDelete ? { allowDelete: true } : {}) };
  const proposalHash = proposalHashOf(changeset);

  return {
    tool: 'fs.proposeChangeset',
    proposalHash,
    fileCount: touched.size,
    totalBytes,
    changeset,
    ops: previewOps,
  };
}

/** PROPOSE: read-only (zero WORKSPACE writes). Computes the proposal and STORES
 * the authoritative changeset so apply can consume it by hash without trusting a
 * client resubmission. */
export function proposeChangeset(input: unknown, fs: ChangesetFs, store: ChangesetProposalStore, correlationId?: string): ProposeChangesetResponse {
  const cs = ChangesetRequestSchema.parse(input);
  const proposal = computeProposal(cs, fs);
  store.put(proposal.proposalHash, proposal.changeset, correlationId);
  return proposal;
}

/** APPLY-PREVIEW: look up the stored proposal by hash and render it WITHOUT
 * consuming — the executor's approval-required preview for fs.applyChangeset. */
export function previewStoredChangeset(input: unknown, fs: ChangesetFs, store: ChangesetProposalStore, correlationId?: string): ProposeChangesetResponse {
  const req = ApplyChangesetRequestSchema.parse(input);
  const cs = store.get(req.proposalHash, correlationId);
  if (!cs) throw new ChangesetError('UNKNOWN_PROPOSAL', 'no live proposal for that hash (unknown or expired)');
  if (cs.rootPath !== req.rootPath) throw new ChangesetError('INVALID_INPUT', 'rootPath does not match the stored proposal');
  return computeProposal(cs, fs);
}

/** APPLY: mutating. Consumes the SERVER-STORED proposal by hash (the client only
 * names {rootPath, proposalHash} — it cannot substitute the body), re-validates
 * + stale-checks, then applies all-or-nothing with atomic writes + rollback.
 * `consume: false` (preview path) looks up without removing. */
export function applyChangeset(input: unknown, fs: ChangesetFs, store: ChangesetProposalStore, correlationId?: string): ApplyChangesetResponse {
  const req = ApplyChangesetRequestSchema.parse(input);
  const cs = store.take(req.proposalHash, correlationId); // single-use: consumed on apply
  if (!cs) {
    throw new ChangesetError('UNKNOWN_PROPOSAL', 'no live proposal for that hash (unknown, expired, or already applied)');
  }
  // Root identity is not cosmetic (invariant #4): canonicalize BOTH roots via
  // realPath and compare, so the same proposal hash cannot be pointed at a
  // different workspace — while a symlink alias to the SAME real root is accepted.
  const sameRoot = (() => {
    try {
      return fs.realPath(req.rootPath) === fs.realPath(cs.rootPath);
    } catch {
      return false;
    }
  })();
  if (!sameRoot) {
    throw new ChangesetError('INVALID_INPUT', 'rootPath does not resolve to the stored proposal root');
  }
  const resolved = resolveOps(cs, fs); // re-contain every path at apply time

  // Pre-flight: existence + stale + delete-permission. No writes yet.
  for (const { op, preExists, currentSha } of resolved) {
    if (op.op === 'create' && preExists) throw new ChangesetError('ALREADY_EXISTS', `create target already exists: ${op.path}`);
    if ((op.op === 'replace' || op.op === 'patch' || op.op === 'delete') && !preExists) {
      throw new ChangesetError('NOT_FOUND', `${op.op} target does not exist: ${op.path}`);
    }
    if (op.op === 'delete' && !cs.allowDelete) throw new ChangesetError('DELETE_NOT_ALLOWED', `delete requires allowDelete: ${op.path}`);
    if ('expectedSha' in op && op.expectedSha && op.expectedSha !== currentSha) {
      throw new ChangesetError('STALE', `source changed since proposal: ${op.path}`);
    }
  }

  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const rollback: Array<{ path: string; previousContent: string | null }> = [];
  const createdDirs: string[] = [];

  const undo = (): void => {
    // Reverse in the order applied: restore/remove touched files, drop new dirs.
    for (const r of [...rollback].reverse()) {
      const abs = fs.resolve(cs.rootPath, r.path);
      if (r.previousContent === null) {
        if (fs.exists(abs)) fs.removeFile(abs);
      } else {
        fs.writeFile(abs, r.previousContent);
      }
    }
    for (const d of [...createdDirs].reverse()) fs.removeDirIfEmpty(d);
  };

  try {
    for (const { op, abs, before } of resolved) {
      switch (op.op) {
        case 'mkdir':
          fs.mkdirp(abs);
          createdDirs.push(abs);
          break;
        case 'create':
          fs.mkdirp(fs.dirname(abs));
          rollback.push({ path: op.path, previousContent: null });
          fs.writeFile(abs, op.content);
          created.push(op.path);
          break;
        case 'replace':
          rollback.push({ path: op.path, previousContent: before });
          fs.writeFile(abs, op.content);
          modified.push(op.path);
          break;
        case 'patch': {
          rollback.push({ path: op.path, previousContent: before });
          fs.writeFile(abs, applyPatch(before ?? '', op.startLine, op.endLine, op.replacement));
          modified.push(op.path);
          break;
        }
        case 'delete':
          rollback.push({ path: op.path, previousContent: before });
          fs.removeFile(abs);
          deleted.push(op.path);
          break;
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    try {
      undo();
    } catch (undoErr) {
      // Invariant #5: rollback itself failed — this is an INCONSISTENT, mixed
      // state. Surface it as a HIGH-SEVERITY distinct condition; never claim a
      // clean rollback. Report what we attempted so an operator can recover.
      const undoDetail = undoErr instanceof Error ? undoErr.message : String(undoErr);
      const appliedFileCount = created.length + modified.length + deleted.length;
      throw new ChangesetError(
        'INCONSISTENT_STATE',
        `apply failed (${detail}) AND rollback failed (${undoDetail}) — workspace may be in a PARTIAL state; manual recovery required. applied-so-far: created=[${created.join(',')}] modified=[${modified.join(',')}] deleted=[${deleted.join(',')}]`,
        { appliedFileCount, affectedPathCount: rollback.length, rollbackFailureCount: 1, failureStage: 'rollback' },
        rollback.map((r) => ({ path: r.path, previousContent: r.previousContent })),
      );
    }
    throw new ChangesetError('PARTIAL_WRITE', `apply failed and was rolled back cleanly: ${detail}`, {
      appliedFileCount: created.length + modified.length + deleted.length,
      affectedPathCount: rollback.length,
      rollbackFailureCount: 0,
      failureStage: 'apply',
    });
  }

  return { tool: 'fs.applyChangeset', created, modified, deleted, rolledBack: false, rollback };
}
