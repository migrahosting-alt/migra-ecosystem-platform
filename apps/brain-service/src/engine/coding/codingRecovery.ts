/**
 * MigraAI Engine — restart recovery for governed coding runs.
 *
 * Deliberately SEPARATE from command-run recovery, because the two bind their
 * authority to different things.
 *
 * A command approval is bound to a snapshot manifest and an executable digest.
 * After a restart those cannot be cheaply re-established, so command policy fails
 * closed: `AWAITING_APPROVAL → EXPIRED`, authority lost. That is correct there.
 *
 * A coding scope approval is bound to a `pathSetHash` and a per-span
 * `excerptHash` — and both are RE-VERIFIABLE by reading the files again. So a
 * pending coding approval is not expired on sight; it is re-checked. If every
 * cited span still hashes to what the operator was shown, the approval still
 * describes reality and remains valid. If ANY span moved, the operator would
 * otherwise be approving a scope whose evidence no longer exists, so it is
 * invalidated and replanning is required.
 *
 * Applying command policy here would destroy a still-valid approval; applying
 * this policy to commands would resurrect authority nobody can verify. Neither
 * is a superset of the other, which is why they are separate modules.
 *
 * NOTHING IS EVER REPLAYED. An apply that was live at process death may have
 * written files; recovery inspects durable evidence and the working tree, and
 * reports ambiguity rather than guessing. © MigraTeck LLC.
 */

import type { DurableAgentRunChild } from '../persistence/types.js';
import { hashExcerpt, normalizePath } from '../grounding/evidenceLedger.js';
import { hashPaths } from './editScope.js';
import type { CodingRunPayloadV1 } from './codingRunPayload.js';
import { CODING_MUTATING_CHILD_KINDS, type CodingChildKind } from './codingRunPayload.js';

/** Reads a span as it exists NOW. Returns undefined when the file is gone. */
export type SpanReader = (path: string, startLine: number, endLine: number) => Promise<string | undefined>;

export type ScopeRecoveryOutcome =
  /** Every binding still holds; the operator may still be asked to approve. */
  | 'still_valid'
  | 'expired'
  /** A cited span no longer hashes to what was shown. */
  | 'source_changed'
  /** A scoped file is gone, or the span no longer exists in it. */
  | 'source_missing'
  /** The path set no longer hashes to the approved hash. */
  | 'scope_mismatch'
  /** Outside the repository root — never re-present an approval we cannot contain. */
  | 'containment_failed'
  /** Cancellation was requested; the approval must not be presented again. */
  | 'cancellation_pending';

export interface ScopeRecoveryFinding {
  path: string;
  startLine: number;
  endLine: number;
  expectedHash: string;
  actualHash?: string;
}

export interface ScopeRecoveryResult {
  outcome: ScopeRecoveryOutcome;
  /** What the approval lifecycle must become. `undefined` = leave it alone. */
  approvalLifecycle?: 'EXPIRED' | 'INVALIDATED';
  detail: string;
  findings: ScopeRecoveryFinding[];
  /** Spans that were successfully re-verified. Reported so a partial check is
   * never mistaken for a complete one. */
  verifiedSpans: number;
}

const CONTAINMENT_VIOLATION = /(^\/)|(^[A-Za-z]:)|(^\.\.(\/|\\|$))|(\/\.\.(\/|$))/;

/**
 * Re-verify a pending scope approval after a restart.
 *
 * Order matters and is not an accident: cancellation first (an operator who
 * pressed stop must never be shown the approval again), then expiry (cheap, and
 * an expired approval needs no file IO), then containment (refuse before
 * touching the filesystem), then the path-set hash, and only then the spans.
 */
export async function recoverPendingScope(input: {
  payload: CodingRunPayloadV1;
  readSpan: SpanReader;
  now: number;
}): Promise<ScopeRecoveryResult> {
  const { payload } = input;
  const none: ScopeRecoveryFinding[] = [];

  if (payload.cancellation) {
    return { outcome: 'cancellation_pending', approvalLifecycle: 'INVALIDATED', detail: 'Cancellation was requested before the restart; this approval will not be presented again.', findings: none, verifiedSpans: 0 };
  }
  const scope = payload.scope;
  if (!scope) {
    return { outcome: 'source_missing', approvalLifecycle: 'INVALIDATED', detail: 'The run was awaiting approval but carries no proposed scope.', findings: none, verifiedSpans: 0 };
  }

  const expiresAt = Date.parse(scope.approvalExpiresAt);
  if (!Number.isFinite(expiresAt)) {
    return { outcome: 'expired', approvalLifecycle: 'EXPIRED', detail: 'The approval expiry is unreadable; the approval cannot be shown to be live.', findings: none, verifiedSpans: 0 };
  }
  if (expiresAt <= input.now) {
    return { outcome: 'expired', approvalLifecycle: 'EXPIRED', detail: `The scope approval expired at ${scope.approvalExpiresAt}.`, findings: none, verifiedSpans: 0 };
  }

  for (const path of scope.proposedPaths) {
    if (CONTAINMENT_VIOLATION.test(path)) {
      return { outcome: 'containment_failed', approvalLifecycle: 'INVALIDATED', detail: `Scoped path ${path} escapes the repository root.`, findings: none, verifiedSpans: 0 };
    }
  }

  // Recompute from the SAME function that produced the stored hash.
  const recomputed = hashPaths(scope.proposedPaths.map(normalizePath));
  if (recomputed !== scope.pathSetHash) {
    return { outcome: 'scope_mismatch', approvalLifecycle: 'INVALIDATED', detail: `The stored path set hashes to ${recomputed}, not the approved ${scope.pathSetHash}.`, findings: none, verifiedSpans: 0 };
  }

  // Re-read every cited span. Checking only the files, or only some spans, would
  // let a changed region inside an unchanged file pass.
  const findings: ScopeRecoveryFinding[] = [];
  let verified = 0;
  let missing = false;
  for (const path of scope.proposedPaths) {
    for (const source of scope.sourcesByPath[path] ?? []) {
      const text = await input.readSpan(source.path, source.startLine, source.endLine);
      if (text === undefined) {
        missing = true;
        findings.push({ path: source.path, startLine: source.startLine, endLine: source.endLine, expectedHash: source.excerptHash });
        continue;
      }
      const actual = hashExcerpt(text);
      if (actual !== source.excerptHash) {
        findings.push({ path: source.path, startLine: source.startLine, endLine: source.endLine, expectedHash: source.excerptHash, actualHash: actual });
        continue;
      }
      verified += 1;
    }
  }

  if (findings.length) {
    return {
      outcome: missing ? 'source_missing' : 'source_changed',
      approvalLifecycle: 'INVALIDATED',
      detail: missing
        ? `${findings.length} cited span(s) no longer exist; the scope must be replanned.`
        : `${findings.length} cited span(s) changed since the proposal; the scope must be replanned.`,
      findings,
      verifiedSpans: verified,
    };
  }

  return { outcome: 'still_valid', detail: `All ${verified} cited span(s) still match the proposal; the approval remains live.`, findings: [], verifiedSpans: verified };
}

// ── Interrupted execution ────────────────────────────────────────────────────

export type ExecutionRecoveryAction =
  /** No mutation was in flight and no approval was consumed — continue. */
  | 'safe_to_continue'
  /** A mutating child was live at process death. State is ambiguous. */
  | 'requires_mutation_reconciliation'
  /** Validation was interrupted; a NEW validation child is required. */
  | 'requires_new_validation'
  /** Nothing outstanding. */
  | 'nothing_to_recover';

export interface ExecutionRecoveryResult {
  action: ExecutionRecoveryAction;
  /** Children that were live at process death, now marked interrupted. */
  interruptedChildren: Array<{ childId: string; kind: string; mutating: boolean }>;
  /** True when durable evidence cannot say whether files were written. */
  mutationAmbiguous: boolean;
  detail: string;
  /** Explicit instruction for the caller. Never "retry" for a mutating child. */
  blockedOperations: string[];
}

/**
 * Classify an interrupted coding run from its durable children.
 *
 * The critical rule: a mutating child (`initial_apply`, `repair_apply`) that was
 * active at process death is NEVER replayed. Re-running an apply whose outcome is
 * unknown can double-write, or write over a partially-applied tree, and the
 * durable record would then describe neither the before nor the after state. The
 * caller must reconcile against the working-tree diff first — which is what the
 * existing `reconcile()` in codingRun.ts already does, using git as authoritative.
 */
export function classifyInterruptedExecution(input: {
  children: readonly DurableAgentRunChild[];
  /** Children observed as non-terminal BEFORE `markInterruptedChildren` ran. */
  interrupted: readonly DurableAgentRunChild[];
}): ExecutionRecoveryResult {
  const interruptedChildren = input.interrupted.map((c) => ({
    childId: c.childId,
    kind: c.kind,
    mutating: CODING_MUTATING_CHILD_KINDS.has(c.kind as CodingChildKind),
  }));

  const mutating = interruptedChildren.filter((c) => c.mutating);
  const validation = interruptedChildren.filter((c) => c.kind === 'validation' || c.kind === 'final_validation');

  if (mutating.length) {
    // An apply that never left `created` provably wrote nothing; anything past
    // that is ambiguous.
    const dispatched = input.interrupted.filter(
      (c) => CODING_MUTATING_CHILD_KINDS.has(c.kind as CodingChildKind) && c.terminalCategory !== 'orphaned_before_dispatch',
    );
    return {
      action: 'requires_mutation_reconciliation',
      interruptedChildren,
      mutationAmbiguous: dispatched.length > 0,
      detail: dispatched.length
        ? `${dispatched.length} apply operation(s) were in flight at process loss; whether files were written is unknown from the record alone.`
        : 'Apply operations were registered but never dispatched; no files were written.',
      blockedOperations: dispatched.map((c) => `${c.kind} ${c.childId} must not be replayed; reconcile against the working-tree diff first`),
    };
  }

  if (validation.length) {
    return {
      action: 'requires_new_validation',
      interruptedChildren,
      mutationAmbiguous: false,
      detail: 'Validation was interrupted. Its result was never observed, so a NEW validation child is required — the interrupted one is never rewritten as completed.',
      blockedOperations: validation.map((c) => `${c.childId} stays interrupted; record a new validation child instead`),
    };
  }

  if (interruptedChildren.length) {
    return {
      action: 'safe_to_continue',
      interruptedChildren,
      mutationAmbiguous: false,
      detail: 'Only non-mutating operations were interrupted; they may be re-attempted as new children.',
      blockedOperations: [],
    };
  }

  return { action: 'nothing_to_recover', interruptedChildren: [], mutationAmbiguous: false, detail: 'No child was in flight at process loss.', blockedOperations: [] };
}
