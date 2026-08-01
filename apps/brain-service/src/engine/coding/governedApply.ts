/**
 * MigraAI Engine — the governed apply gate.
 *
 * Every mutation the coding loop makes passes through here:
 *
 *   approved scope  →  ScopedEditLedger  →  applyChangeset
 *
 * The gate adds authority checking. It does NOT reimplement writing: readback
 * verification, all-or-nothing rollback, single-use proposals and root-identity
 * canonicalisation already live in `applyChangeset` and are left exactly as they
 * are. A second write path would be a second, unaudited one — the shape of defect
 * `check-brain-transport.mjs` exists to prevent for the Brain.
 *
 * ONE UNAUTHORISED PATH REJECTS THE WHOLE CHANGESET, before any mutation. Applying
 * the in-scope subset of an overbroad changeset would be worse than refusing: the
 * caller asked for a set of edits that only make sense together, and a partial
 * application leaves the tree in a state nobody planned and nobody approved.
 *
 * The gate is also honest about refusals. An out-of-scope attempt is recorded, not
 * discarded, because a final report has to be able to say "it tried to edit a file
 * it had no authority for and was stopped". © MigraTeck LLC.
 */

import type { ApplyChangesetResponse, ChangesetRequest, ProposeChangesetResponse } from '@migrapilot/protocol';
import { applyChangeset, proposeChangeset, type ChangesetFs, type ChangesetProposalStore } from '../../tools/changeset.js';
import { normalizePath } from '../grounding/evidenceLedger.js';
import {
  assertWithinScope,
  approvalMatches,
  EditScopeError,
  type ApprovedEditScope,
  type ScopedEditLedger,
} from './editScope.js';

/** Why a changeset was refused before it could touch the filesystem. */
export type ApplyRefusal =
  | 'approval-mismatch'
  | 'scope-expired'
  | 'scope-violation'
  | 'evidence-missing'
  | 'empty-changeset'
  | 'root-mismatch'
  /** The mutation engine refused or failed. Authority was fine; the write was not. */
  | 'apply-failed';

export interface GovernedApplyRefused {
  ok: false;
  refusal: ApplyRefusal;
  message: string;
  /** The specific paths that caused the refusal, for the report. */
  offendingPaths: string[];
  /**
   * Whether the workspace may have been left partially modified.
   *
   * `false` for every authority refusal — those happen before a byte is written.
   * `true` only when the engine reported INCONSISTENT_STATE, meaning its own
   * rollback failed. That is not something to swallow: an unresolved partial state
   * must reach the report and block completion.
   */
  mutated: false | 'partial';
  /** The engine's error code, when the failure came from the mutation engine. */
  engineCode?: string;
}

export interface GovernedApplyApplied {
  ok: true;
  mutated: true;
  proposalHash: string;
  result: ApplyChangesetResponse;
  paths: string[];
}

export type GovernedApplyResult = GovernedApplyApplied | GovernedApplyRefused;

export interface GovernedApplyDeps {
  fs: ChangesetFs;
  store: ChangesetProposalStore;
  scope: ApprovedEditScope;
  approvalToken: string;
  ledger: ScopedEditLedger;
  correlationId?: string;
  now?: () => number;
}

/** Every path a changeset would touch, normalised. */
export function changesetPaths(changeset: ChangesetRequest): string[] {
  return [...new Set(changeset.ops.map((op) => normalizePath(op.path)))];
}

/**
 * Apply a changeset under an approved scope.
 *
 * Checks run in a deliberate order — cheapest and most fundamental first — so a
 * forged token is refused before any path analysis, and every path is judged
 * before any of them is written.
 */
export async function governedApply(changeset: ChangesetRequest, deps: GovernedApplyDeps): Promise<GovernedApplyResult> {
  const now = deps.now?.() ?? Date.now();
  const { scope, approvalToken, ledger } = deps;

  const refuse = (refusal: ApplyRefusal, message: string, offendingPaths: string[] = []): GovernedApplyRefused => {
    // Recorded, not discarded: the report must be able to say what was attempted.
    for (const path of offendingPaths) ledger.admit(path, now);
    return { ok: false, refusal, message, offendingPaths, mutated: false };
  };

  // 1. The approval must belong to THIS scope — and to this path set, since the
  //    token binds to the scope hash rather than the id.
  if (!approvalMatches(scope, approvalToken)) {
    return refuse('approval-mismatch', 'The approval token does not match this edit scope.');
  }
  // 2. An approval that has run out is not an approval.
  if (now >= scope.expiresAt) {
    return refuse('scope-expired', `The edit scope expired at ${new Date(scope.expiresAt).toISOString()}.`);
  }

  const paths = changesetPaths(changeset);
  if (!paths.length) return refuse('empty-changeset', 'A changeset must contain at least one operation.');

  // 3. Root identity: the changeset must target the tree the scope was approved
  //    against. `applyChangeset` canonicalises roots too; this catches the
  //    mismatch before a proposal is even created.
  if (!changeset.rootPath) return refuse('root-mismatch', 'A changeset must name its rootPath.');

  // 4-5. EVERY path is judged before ANY is written. An overbroad changeset is
  //      rejected whole: the in-scope subset of a plan is not the plan.
  const outOfScope: string[] = [];
  const unevidenced: string[] = [];
  for (const path of paths) {
    try {
      assertWithinScope(scope, path, approvalToken, now);
    } catch (err) {
      if (err instanceof EditScopeError && err.code === 'scope-violation') outOfScope.push(path);
      else throw err;
      continue;
    }
    // The scope entry must STILL carry the evidence that justified it. Scope
    // membership without provenance would let an approved list outlive the reason
    // it was approved.
    const entry = scope.files.find((f) => f.path === path);
    if (!entry || entry.sources.length === 0) unevidenced.push(path);
  }
  if (outOfScope.length) {
    return refuse(
      'scope-violation',
      `Changeset rejected in full: ${outOfScope.join(', ')} outside the approved scope (${scope.files.map((f) => f.path).join(', ')}). No file was written.`,
      outOfScope,
    );
  }
  if (unevidenced.length) {
    return refuse('evidence-missing', `Changeset rejected in full: no supporting evidence remains for ${unevidenced.join(', ')}.`, unevidenced);
  }

  // 6. Authority established. Record the admitted writes, then hand off to the
  //    existing mutation engine untouched.
  for (const path of paths) ledger.admit(path, now);

  // The mutation engine owns writing, readback and rollback. Its FAILURES are
  // results too: an escaped exception would crash the run instead of reporting
  // that the tree may be partial, which is exactly the state an operator most
  // needs told about.
  try {
    const proposal: ProposeChangesetResponse = proposeChangeset(changeset, deps.fs, deps.store, deps.correlationId);
    const result = applyChangeset(
      { rootPath: changeset.rootPath, proposalHash: proposal.proposalHash },
      deps.fs,
      deps.store,
      deps.correlationId,
    );
    return { ok: true, mutated: true, proposalHash: proposal.proposalHash, result, paths };
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'APPLY_FAILED';
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      refusal: 'apply-failed',
      message,
      offendingPaths: paths,
      engineCode: code,
      // Only INCONSISTENT_STATE means the engine could not undo its own writes.
      mutated: code === 'INCONSISTENT_STATE' ? 'partial' : false,
    };
  }
}
