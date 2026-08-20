/**
 * The lightweight edit lane — a small, bounded change without a governed coding run.
 *
 * WHY THIS IS NOT AGENT MODE / GOVERNED CODING
 * --------------------------------------------
 *   Quick edit lane                      Governed coding run / Agent Mode
 *   ----------------------------------   -----------------------------------------
 *   a few files, bounded byte budget     unbounded scope within its recipe
 *   one propose -> one apply             plan, children, validation, repair loop
 *   user confirms the exact diff         checkpoint/scope-decision state machine
 *   no autonomous follow-up              autonomous multi-stage execution
 *
 * NO SECOND MUTATION PATH. Every write goes through the engine's existing changeset
 * machinery — `fs.proposeChangeset` (read-only, hashes the proposal, captures pre-state)
 * then `fs.applyChangeset` (approval-required, all-or-nothing, atomic, rollback on partial
 * failure). The extension never touches the filesystem: a "quick" lane that wrote files
 * directly would bypass containment, staleness detection and rollback in one step, which is
 * precisely the machinery that makes a small edit safe to accept.
 *
 * NO NEW APPROVAL. The engine already marks `fs.applyChangeset` approvalRequired, and the
 * existing mint -> consume handshake is reused unchanged. This lane adds no second gate and
 * removes none.
 *
 * The bounds below are what makes it "lightweight": they are refusal thresholds, not
 * suggestions. A change that outgrows them belongs in a governed run, and saying so is more
 * useful than silently accepting a large edit through a lane designed for small ones.
 */

/** A quick edit stays small. Beyond these, use a governed coding run. */
export const QUICK_EDIT_MAX_FILES = 5;
export const QUICK_EDIT_MAX_TOTAL_BYTES = 64 * 1024;

/** A NUL byte means there is no reviewable diff to confirm honestly. */
const NUL = '\u0000';

export interface QuickEditOp {
  op?: string;
  kind?: string;
  path?: string;
  before?: string | null;
  after?: string | null;
}

export interface QuickEditProposal {
  proposalHash?: string;
  ops: QuickEditOp[];
  fileCount?: number;
}

export type QuickEditOutcome =
  | { status: 'applied'; files: string[] }
  | { status: 'declined' }
  | { status: 'nothing-proposed' }
  | { status: 'refused'; reason: string };

export interface QuickEditUi {
  /** Show the diff and ask. Returning false means the user declined. */
  confirm(summary: string, ops: QuickEditOp[]): Promise<boolean>;
  showRefusal(reason: string): Promise<void>;
  showApplied(files: string[]): Promise<void>;
}

/** The engine's answer to an apply, including WHY when it refused. */
export interface QuickEditApplyResult {
  applied: boolean;
  /** Stable machine-readable reason, e.g. STALE_CONTENT. Absent on older engines. */
  reason?: string;
  /** Engine-vetted, user-safe message. Absent on older engines. */
  message?: string;
}

export interface QuickEditEngine {
  /** Ask the engine for a propose-only changeset. Never writes. */
  propose(instruction: string, rootPath: string): Promise<QuickEditProposal | undefined>;
  /** Apply a stored proposal by hash through the approval handshake. */
  apply(rootPath: string, proposalHash: string): Promise<QuickEditApplyResult>;
}

/** File-touching ops only; `mkdir` is structural and does not count toward the bound. */
export function fileOpsOf(ops: readonly QuickEditOp[]): QuickEditOp[] {
  return ops.filter(
    (o) => (o.kind ?? o.op) !== 'mkdir' && typeof o.path === 'string' && o.path.length > 0,
  );
}

/** Bytes this proposal would write. `after` is the post-state the engine computed. */
export function proposedBytes(ops: readonly QuickEditOp[]): number {
  return fileOpsOf(ops).reduce((total, op) => total + Buffer.byteLength(op.after ?? '', 'utf8'), 0);
}

/**
 * Refuse anything the lane is not sized for, BEFORE asking the user to approve it.
 * Returns null when the proposal is within bounds.
 */
export function boundsRefusal(ops: readonly QuickEditOp[]): string | null {
  const files = fileOpsOf(ops);
  if (files.length === 0) return null;
  if (files.length > QUICK_EDIT_MAX_FILES) {
    return `this change touches ${files.length} files; the quick edit lane is bounded to ${QUICK_EDIT_MAX_FILES}. Use a governed coding run.`;
  }
  const bytes = proposedBytes(ops);
  if (bytes > QUICK_EDIT_MAX_TOTAL_BYTES) {
    return `this change writes ${Math.round(bytes / 1024)} KiB; the quick edit lane is bounded to ${
      QUICK_EDIT_MAX_TOTAL_BYTES / 1024
    } KiB. Use a governed coding run.`;
  }
  const binary = files.find((o) => typeof o.after === 'string' && o.after.includes(NUL));
  if (binary) {
    return `"${binary.path}" looks binary; the quick edit lane only changes reviewable text.`;
  }
  return null;
}

export function summarize(ops: readonly QuickEditOp[]): string {
  const names = fileOpsOf(ops).map((o) => o.path as string);
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

export async function runQuickEditFlow(input: {
  instruction: string;
  rootPath: string | undefined;
  engine: QuickEditEngine;
  ui: QuickEditUi;
}): Promise<QuickEditOutcome> {
  if (input.rootPath === undefined || input.rootPath.length === 0) {
    const reason = 'Open a workspace folder first — an edit needs a resolved root.';
    await input.ui.showRefusal(reason);
    return { status: 'refused', reason };
  }
  if (input.instruction.trim().length === 0) {
    const reason = 'No edit described.';
    await input.ui.showRefusal(reason);
    return { status: 'refused', reason };
  }

  let proposal: QuickEditProposal | undefined;
  try {
    proposal = await input.engine.propose(input.instruction, input.rootPath);
  } catch (error) {
    // FAIL CLOSED. The engine owns every write; unreachable means nothing changed.
    const reason = `the Brain Service is unavailable, so nothing was changed (${
      error instanceof Error ? error.message : String(error)
    }).`;
    await input.ui.showRefusal(reason);
    return { status: 'refused', reason };
  }

  const ops = proposal?.ops ?? [];
  if (!proposal?.proposalHash || fileOpsOf(ops).length === 0) {
    await input.ui.showRefusal('The engine proposed no file changes.');
    return { status: 'nothing-proposed' };
  }

  const refusal = boundsRefusal(ops);
  if (refusal !== null) {
    await input.ui.showRefusal(refusal);
    return { status: 'refused', reason: refusal };
  }

  const confirmed = await input.ui.confirm(summarize(ops), fileOpsOf(ops));
  if (!confirmed) return { status: 'declined' };

  let result: QuickEditApplyResult;
  try {
    result = await input.engine.apply(input.rootPath, proposal.proposalHash);
  } catch (error) {
    // A refusal at apply time — stale content, containment, a rollback — is reported as
    // itself. The engine is all-or-nothing, so "not applied" means the workspace is
    // exactly as it was.
    const reason = `the change was NOT applied (${error instanceof Error ? error.message : String(error)}).`;
    await input.ui.showRefusal(reason);
    return { status: 'refused', reason };
  }
  if (!result.applied) {
    // Prefer the ENGINE's vetted message: it names the actual rule that refused (stale
    // content, containment, a rollback). Only fall back to the generic sentence when the
    // engine sent nothing — never guess a cause on the engine's behalf.
    const reason = result.message ?? 'the engine did not apply the change; the workspace is unchanged.';
    await input.ui.showRefusal(result.reason ? `${reason} [${result.reason}]` : reason);
    return { status: 'refused', reason };
  }
  const files = fileOpsOf(ops).map((o) => o.path as string);
  await input.ui.showApplied(files);
  return { status: 'applied', files };
}
