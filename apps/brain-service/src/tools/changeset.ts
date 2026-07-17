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

// Proposal-size guardrails (owner threat checklist). A proposal exceeding any of
// these is refused at propose time — before it can be stored or approved.
const MAX_OPS = 200;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PROPOSAL_TTL_MS = 30 * 60_000;
const MAX_STORED_PROPOSALS = 512;

/** Server-side proposal store: the AUTHORITATIVE changeset body lives here,
 * keyed by its SHA-256 proposal hash. Apply looks the proposal up by hash — the
 * client never resubmits the body, so it cannot substitute a weaker changeset. */
export class ChangesetProposalStore {
  private readonly byHash = new Map<string, { changeset: ChangesetRequest; rootPath: string; expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  put(proposalHash: string, changeset: ChangesetRequest): void {
    if (this.byHash.size >= MAX_STORED_PROPOSALS) {
      // Evict the oldest to bound memory (a local single-process engine).
      const oldest = [...this.byHash.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) this.byHash.delete(oldest[0]);
    }
    this.byHash.set(proposalHash, { changeset, rootPath: changeset.rootPath, expiresAt: this.now() + PROPOSAL_TTL_MS });
  }

  /** Fetch a live proposal; expired entries are treated as absent (and evicted). */
  get(proposalHash: string): ChangesetRequest | undefined {
    const rec = this.byHash.get(proposalHash);
    if (!rec) return undefined;
    if (rec.expiresAt <= this.now()) {
      this.byHash.delete(proposalHash);
      return undefined;
    }
    return rec.changeset;
  }

  /** Consume (remove) a proposal — a proposal is single-use at application. */
  take(proposalHash: string): ChangesetRequest | undefined {
    const cs = this.get(proposalHash);
    if (cs) this.byHash.delete(proposalHash);
    return cs;
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
      | 'CONFLICT'
      | 'TOO_LARGE'
      | 'UNKNOWN_PROPOSAL',
    message: string,
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

/** SHA-256 over ALL security-relevant context (owner review): version, root,
 * allowDelete, and the ordered normalized ops (op / path / expectedSha /
 * content / patch coords). Any edit to any of these changes the hash. */
function proposalHashOf(cs: ChangesetRequest): string {
  const canonical = {
    v: 1,
    rootPath: cs.rootPath,
    allowDelete: Boolean(cs.allowDelete),
    ops: cs.ops,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
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
export function proposeChangeset(input: unknown, fs: ChangesetFs, store: ChangesetProposalStore): ProposeChangesetResponse {
  const cs = ChangesetRequestSchema.parse(input);
  const proposal = computeProposal(cs, fs);
  store.put(proposal.proposalHash, proposal.changeset);
  return proposal;
}

/** APPLY-PREVIEW: look up the stored proposal by hash and render it WITHOUT
 * consuming — the executor's approval-required preview for fs.applyChangeset. */
export function previewStoredChangeset(input: unknown, fs: ChangesetFs, store: ChangesetProposalStore): ProposeChangesetResponse {
  const req = ApplyChangesetRequestSchema.parse(input);
  const cs = store.get(req.proposalHash);
  if (!cs) throw new ChangesetError('UNKNOWN_PROPOSAL', 'no live proposal for that hash (unknown or expired)');
  if (cs.rootPath !== req.rootPath) throw new ChangesetError('INVALID_INPUT', 'rootPath does not match the stored proposal');
  return computeProposal(cs, fs);
}

/** APPLY: mutating. Consumes the SERVER-STORED proposal by hash (the client only
 * names {rootPath, proposalHash} — it cannot substitute the body), re-validates
 * + stale-checks, then applies all-or-nothing with atomic writes + rollback.
 * `consume: false` (preview path) looks up without removing. */
export function applyChangeset(input: unknown, fs: ChangesetFs, store: ChangesetProposalStore): ApplyChangesetResponse {
  const req = ApplyChangesetRequestSchema.parse(input);
  const cs = store.take(req.proposalHash); // single-use: consumed on apply
  if (!cs) {
    throw new ChangesetError('UNKNOWN_PROPOSAL', 'no live proposal for that hash (unknown, expired, or already applied)');
  }
  if (cs.rootPath !== req.rootPath) {
    throw new ChangesetError('INVALID_INPUT', 'rootPath does not match the stored proposal');
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
    undo();
    const detail = err instanceof Error ? err.message : String(err);
    throw new ChangesetError('PARTIAL_WRITE', `apply failed and was rolled back: ${detail}`);
  }

  return { tool: 'fs.applyChangeset', created, modified, deleted, rolledBack: false, rollback };
}
