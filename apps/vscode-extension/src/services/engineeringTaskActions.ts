// Pure EngineeringTask approve/reject logic, extracted so the double-apply guard
// and the "reject mutates nothing" contract are testable without a real webview.
//
// The guard against a second apply (double-click / replayed action) is
// structural, not a flag: the caller (shellProvider) reassigns its held task to
// the `applying` state SYNCHRONOUSLY, before awaiting `result` below. A second
// call arriving before that await resumes sees a task whose approvalState has
// already left 'pending' and is refused here.

import type { EngineeringTask } from '@migrapilot/shared-types';
import type { ChangesetProposal } from './proposedChangeset.js';

export type ApplyChangesetFn = (rootPath: string, changeset: ChangesetProposal) => Promise<boolean>;

/** Reject: state transition only. Never calls apply, never touches disk. */
export function rejectEngineeringTask(task: EngineeringTask): EngineeringTask | undefined {
  if (!task.proposal || task.proposal.approvalState !== 'pending') return undefined;
  return {
    ...task,
    stage: 'repair_needed',
    checkpoint: 'The operator rejected the changeset. No workspace files were changed.',
    completion: 'blocked',
    proposal: { ...task.proposal, approvalState: 'rejected' },
  };
}

export interface ApproveOutcome {
  /** The task to show immediately (synchronously), with approvalState already
   * moved off 'pending' so a second concurrent approve call is refused. */
  applying: EngineeringTask;
  /** Resolves once the (single) apply call through the Brain boundary settles. */
  result: Promise<EngineeringTask>;
}

/** Approve: refuses anything but a pending proposal, then applies through the
 * SAME single-use Brain handshake exactly once. Never claims verification —
 * the resolved task always lands on `testing` (applied) or `repair_needed`
 * (refused), never `verified`. */
export function approveEngineeringTask(task: EngineeringTask, apply: ApplyChangesetFn): ApproveOutcome | undefined {
  const proposal = task.proposal;
  if (!proposal || proposal.approvalState !== 'pending') return undefined;
  const changeset: ChangesetProposal = {
    proposalHash: proposal.proposalHash,
    ops: proposal.operations.map((operation) => ({
      kind: operation.operation,
      path: operation.path,
      ...(operation.before !== undefined ? { before: operation.before } : {}),
      ...(operation.after !== undefined ? { after: operation.after } : {}),
    })),
    fileCount: proposal.operations.length,
  };
  const applying: EngineeringTask = {
    ...task,
    stage: 'applying',
    checkpoint: 'The approved changeset is being applied through the Brain approval boundary.',
    proposal: { ...proposal, approvalState: 'approved' },
  };
  const result = apply(task.workspaceRoot, changeset).then((applied) => ({
    ...applying,
    stage: applied ? ('testing' as const) : ('repair_needed' as const),
    checkpoint: applied
      ? 'Applied exactly once. No verification command has run yet.'
      : 'The Brain refused or could not apply the approved changeset.',
    completion: applied ? ('in_progress' as const) : ('blocked' as const),
    proposal: { ...applying.proposal!, approvalState: applied ? ('applied' as const) : ('stale' as const) },
  }));
  return { applying, result };
}
