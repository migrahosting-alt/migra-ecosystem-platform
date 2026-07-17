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
  type ChangesetRequest,
  type ChangeOp,
  type ProposeChangesetResponse,
  type ApplyChangesetResponse,
} from '@migrapilot/protocol';

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
    readonly code: 'INVALID_INPUT' | 'DELETE_NOT_ALLOWED' | 'ALREADY_EXISTS' | 'NOT_FOUND' | 'STALE' | 'PARTIAL_WRITE',
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

/** PROPOSE: read-only. Zero writes; fills expectedSha; computes proposal hash. */
export function proposeChangeset(input: unknown, fs: ChangesetFs): ProposeChangesetResponse {
  const cs = ChangesetRequestSchema.parse(input);
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
  // Hash covers the canonical ops (incl. expectedSha) — NOT the root — so the
  // proposal identity is stable and any op edit changes the hash.
  const proposalHash = sha(JSON.stringify(echoOps));

  return {
    tool: 'fs.proposeChangeset',
    proposalHash,
    fileCount: touched.size,
    totalBytes,
    changeset,
    ops: previewOps,
  };
}

/** APPLY: mutating. Re-validate, stale-check, then all-or-nothing atomic apply
 * with rollback. Reports every created/modified/deleted file + reverse material. */
export function applyChangeset(input: unknown, fs: ChangesetFs): ApplyChangesetResponse {
  const cs = ChangesetRequestSchema.parse(input);
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
