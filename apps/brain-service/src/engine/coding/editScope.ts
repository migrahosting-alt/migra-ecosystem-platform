/**
 * MigraAI Engine — the approved edit scope.
 *
 * GOVERNANCE CHANGE (owner, 2026-08-01). The engineer loop was preview-only since
 * 2026-07-16: it proposed, it never wrote. That made a repair loop impossible —
 * an agent cannot fix what it cannot apply, and cannot learn from a test run it
 * never triggered. The replacement is not "the loop may now write". It is:
 *
 *   the loop may write ONLY inside a file scope that was declared before any
 *   mutation, justified by retrieved evidence, and approved as a whole.
 *
 * That trade is deliberate. Per-edit approval keeps a human in every repair round
 * and makes autonomy impossible; unrestricted write authority makes the blast
 * radius unknowable. Approving a SCOPE bounds the blast radius exactly once, up
 * front, in terms the operator can read — a list of paths — and every subsequent
 * write is checked against it.
 *
 * Three properties make that safe, and each is a test:
 *
 *  1. FROZEN. The path set is fixed at approval. Widening it needs a NEW approval,
 *     because a scope that can grow after the fact is not a scope.
 *  2. EVIDENCED. A file cannot enter a scope without claim-level provenance — the
 *     spans that justify touching it. "Evidence-governed" has to mean the write
 *     authority is derived from evidence, not merely adjacent to it.
 *  3. EXPIRING. Approval has a TTL, so an abandoned run cannot be resumed hours
 *     later against a tree that has moved on.
 *
 * PURE: no fs, no fetch. Enforcement is a decision about paths, and it is tested
 * without touching a disk. © MigraTeck LLC.
 */

import { createHash, randomUUID } from 'node:crypto';
import { normalizePath } from '../grounding/evidenceLedger.js';
import type { ClaimSource } from '../grounding/claimVerifier.js';

/** Why one file belongs in the scope, and what evidence says so. */
export interface ScopedFile {
  path: string;
  /** Operator-readable reason. Shown at approval time. */
  reason: string;
  /**
   * The spans that justify editing this file.
   *
   * Required. A file nobody can point at evidence for is a file nobody has
   * established a reason to change, and approving it would make the scope a
   * formality rather than a boundary.
   */
  sources: ClaimSource[];
}

export interface EditScopeRequest {
  runId: string;
  /** What the whole change is for, grounded in the issue and the evidence. */
  rationale: string;
  files: ScopedFile[];
}

export type ScopeRejection =
  | 'no-files'
  | 'file-without-evidence'
  | 'duplicate-path'
  | 'absolute-or-escaping-path'
  | 'too-many-files';

export class EditScopeError extends Error {
  constructor(
    readonly code: ScopeRejection | 'scope-violation' | 'scope-expired' | 'approval-mismatch' | 'scope-frozen',
    message: string,
  ) {
    super(message);
    this.name = 'EditScopeError';
  }
}

/** A scope that has been declared but not yet approved. */
export interface ProposedEditScope {
  scopeId: string;
  runId: string;
  rationale: string;
  files: readonly ScopedFile[];
  /** Hash of the exact path set — an approval binds to THIS set, not to the id. */
  scopeHash: string;
  proposedAt: number;
}

/** A scope an operator has approved. Writes are checked against it. */
export interface ApprovedEditScope extends ProposedEditScope {
  approvalToken: string;
  approvedAt: number;
  expiresAt: number;
}

/** One write attempt, allowed or refused. The report is built from these. */
export interface ScopedEditRecord {
  path: string;
  outcome: 'applied' | 'refused';
  reason?: string;
  at: number;
}

/** Ceiling on a single approval. A scope of unbounded size is not a boundary. */
export const MAX_SCOPE_FILES = 12;

/** Matches the tool-approval store's window, so neither outlives the other. */
export const SCOPE_TTL_MS = 5 * 60 * 1000;

/** Binds an approval to an exact path set. EXPORTED so restart re-verification
 * recomputes the same hash from the same function — a parallel implementation
 * could drift, and a drifted hash would silently invalidate valid approvals (or,
 * far worse, validate changed ones). */
export function hashPaths(paths: readonly string[]): string {
  return createHash('sha256').update([...paths].sort().join('\n'), 'utf8').digest('hex').slice(0, 16);
}

/**
 * Declare the file scope BEFORE any mutation.
 *
 * Rejects rather than normalises a bad request: an absolute path or a `..` in a
 * scope declaration is a caller defect, and silently rewriting it would hide the
 * fact that the plan pointed outside the workspace.
 */
export function proposeEditScope(req: EditScopeRequest, now = Date.now()): ProposedEditScope {
  if (!req.files.length) throw new EditScopeError('no-files', 'An edit scope must name at least one file.');
  if (req.files.length > MAX_SCOPE_FILES) {
    throw new EditScopeError('too-many-files', `An edit scope may cover at most ${MAX_SCOPE_FILES} files; got ${req.files.length}.`);
  }
  const seen = new Set<string>();
  const files: ScopedFile[] = [];
  for (const file of req.files) {
    // Validate the RAW path, before normalisation. `normalizePath` strips a
    // leading slash, so checking afterwards turned `/etc/passwd` into the
    // perfectly innocent-looking `etc/passwd` and admitted it — silently
    // rewriting an out-of-workspace path into an in-workspace one is precisely
    // the hiding this check exists to prevent.
    const raw = (file.path ?? '').trim();
    if (!raw || /^[/\\]/.test(raw) || /^[A-Za-z]:[/\\]/.test(raw) || raw.replace(/\\/g, '/').split('/').includes('..')) {
      throw new EditScopeError('absolute-or-escaping-path', `Scope path must be workspace-relative and contained: ${file.path}`);
    }
    const path = normalizePath(raw);
    if (!path) throw new EditScopeError('absolute-or-escaping-path', `Scope path is empty after normalisation: ${file.path}`);
    if (seen.has(path)) throw new EditScopeError('duplicate-path', `Scope names ${path} twice.`);
    if (!file.sources.length) {
      throw new EditScopeError('file-without-evidence', `No evidence was offered for editing ${path}; a scope entry must cite the spans that justify it.`);
    }
    seen.add(path);
    files.push({ ...file, path });
  }
  return {
    scopeId: `scope_${randomUUID()}`,
    runId: req.runId,
    rationale: req.rationale,
    files: Object.freeze(files),
    scopeHash: hashPaths(files.map((f) => f.path)),
    proposedAt: now,
  };
}

/**
 * Approve a proposed scope.
 *
 * The token binds to the SCOPE HASH, not the id, so a proposal that is re-issued
 * with different paths cannot be applied under an approval granted for the old
 * set — the id would still match, and only the hash catches it.
 */
export function approveEditScope(proposed: ProposedEditScope, now = Date.now(), ttlMs = SCOPE_TTL_MS): ApprovedEditScope {
  return {
    ...proposed,
    approvalToken: `scopeapv_${proposed.scopeHash}_${randomUUID().slice(0, 8)}`,
    approvedAt: now,
    expiresAt: now + ttlMs,
  };
}

/** Does this approval actually belong to this scope? */
export function approvalMatches(scope: ApprovedEditScope, token: string): boolean {
  return token === scope.approvalToken && token.includes(scope.scopeHash);
}

/**
 * The single gate every governed write passes through.
 *
 * Throws rather than returning false: a caller that forgets to check a boolean
 * still writes, whereas a caller that forgets to catch does not.
 */
export function assertWithinScope(scope: ApprovedEditScope, rawPath: string, token: string, now = Date.now()): void {
  if (!approvalMatches(scope, token)) {
    throw new EditScopeError('approval-mismatch', 'The approval token does not match this edit scope.');
  }
  if (now >= scope.expiresAt) {
    throw new EditScopeError('scope-expired', `The edit scope expired at ${new Date(scope.expiresAt).toISOString()}; re-plan and seek approval again.`);
  }
  const path = normalizePath(rawPath);
  if (!scope.files.some((f) => f.path === path)) {
    throw new EditScopeError(
      'scope-violation',
      `${path} is outside the approved edit scope (${scope.files.map((f) => f.path).join(', ')}). Widening the scope requires a new approval.`,
    );
  }
}

/**
 * Records every write attempt against a scope, allowed or refused.
 *
 * A refusal is kept, not discarded. "The agent tried to edit a file it had no
 * authority for and was stopped" is exactly what a truthful final report has to
 * be able to say, and it cannot say it from a log that only remembers successes.
 */
export class ScopedEditLedger {
  private readonly records: ScopedEditRecord[] = [];

  constructor(
    readonly scope: ApprovedEditScope,
    private readonly token: string,
  ) {}

  /** Attempt a write. Returns true when the caller may proceed. */
  admit(path: string, now = Date.now()): boolean {
    try {
      assertWithinScope(this.scope, path, this.token, now);
      this.records.push({ path: normalizePath(path), outcome: 'applied', at: now });
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.records.push({ path: normalizePath(path), outcome: 'refused', reason, at: now });
      return false;
    }
  }

  get applied(): string[] {
    return [...new Set(this.records.filter((r) => r.outcome === 'applied').map((r) => r.path))];
  }

  get refused(): ScopedEditRecord[] {
    return this.records.filter((r) => r.outcome === 'refused');
  }

  /** Scope entries that were approved but never written — an honest plan/act gap. */
  get unusedScope(): string[] {
    const applied = new Set(this.applied);
    return this.scope.files.map((f) => f.path).filter((p) => !applied.has(p));
  }

  get history(): readonly ScopedEditRecord[] {
    return this.records;
  }
}

/** Operator-readable summary of the boundary, for the approval prompt and report. */
export function describeScope(scope: ProposedEditScope): string {
  const lines = [`Edit scope ${scope.scopeId} — ${scope.files.length} file(s)`, ``, scope.rationale, ``];
  for (const file of scope.files) {
    const cites = file.sources.map((s) => `${s.path}:${s.startLine}-${s.endLine}`).slice(0, 3).join(', ');
    lines.push(`- ${file.path}`);
    lines.push(`    why: ${file.reason}`);
    lines.push(`    evidence: ${cites || '(none)'}`);
  }
  lines.push('', 'No file outside this list may be written under this approval.');
  return lines.join('\n');
}
